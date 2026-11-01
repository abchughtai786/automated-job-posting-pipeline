'use strict';

// One pipeline run: collect -> skip seen -> rank -> (dedup -> draft ->
// AI content -> publish -> index) for up to `runCap` jobs,
// never exceeding `dailyTarget` per day. It is designed to be scheduled
// several times a day; each run is independent and resumable because state
// is saved after every candidate.

const { collectAll } = require('./collectors');
const { rankJobs, buildBrandRegex } = require('./ranking/rank');
const { generateJobContent } = require('./content/generator');
const { classifyJobTypes, extractCity } = require('./taxonomy');
const { sanitizeUnicodeText, plainText } = require('./parsing/sanitize');
const { REVIEW_KEY } = require('./screening/screener');
const { mentions } = require('./util/regex');

function localDateKey(offsetHours, now = Date.now()) {
  return new Date(now + offsetHours * 3600 * 1000).toISOString().slice(0, 10);
}

async function runOnce(deps) {
  const { config, store, log, ai, screener, dedup, publisher, indexer } = deps;
  const knownCities = config.site.cities;
  const report = { collected: 0, unseen: 0, published: [], skipped: [], failed: [], stuck: [] };

  const collected = await collectAll({ ...config, ai, screener, log });
  report.collected = collected.length;

  const seen = (await store.getItem('seenUrls')) || {};
  const failureCounts = (await store.getItem('failureCounts')) || {};
  const unseen = collected.filter((j) => !seen[j.url]);
  report.unseen = unseen.length;
  log(`run: collected ${collected.length} jobs, ${unseen.length} not seen before`);

  // Saved after every candidate, so a crash mid-run never republishes a job.
  const saveProgress = async () => {
    await store.setItem('seenUrls', seen);
    await store.setItem('failureCounts', failureCounts);
  };

  const today = localDateKey(config.timezoneOffsetHours);
  let daily = (await store.getItem('dailyPostLog')) || {};
  if (daily.date !== today) daily = { date: today, count: 0, cities: [] };
  const remaining = config.dailyTarget - daily.count;
  if (remaining <= 0) {
    log(`run: daily target (${config.dailyTarget}) already reached`);
    report.screening = { ...screener.stats };
    report.dailyCount = `${daily.count}/${config.dailyTarget}`;
    return report;
  }
  const toAttempt = Math.min(config.runCap, remaining);

  const ranked = rankJobs(unseen, { postedCitiesToday: daily.cities, knownCities, brandRe: buildBrandRegex(config.site.brands) });

  for (const { job: raw, score, reasons } of ranked) {
    if (report.published.length >= toAttempt) break;
    // Text from posts is untrusted: no markup in fields that become titles or meta data.
    const job = { ...raw, title: plainText(sanitizeUnicodeText(raw.title)), company: plainText(sanitizeUnicodeText(raw.company)), location: plainText(raw.location) };

    const dup = await dedup.isRecentDuplicate(job);
    if (dup) {
      seen[job.url] = Date.now(); // so the repost is not re-checked every run
      report.skipped.push({ title: job.title, company: job.company, reason: `duplicate (${dup})` });
      log(`dedup: skipped "${job.title}" (${job.company}) -- ${dup}`);
      await saveProgress();
      continue;
    }

    // Only drafting, content generation and publishing count as a failed
    // attempt; once the job is live it is never retried.
    let content, jobTypes, post;
    try {
      const draft = await publisher.createDraft(job);
      content = await generateJobContent(job, { ai, country: config.country });
      jobTypes = classifyJobTypes(job);
      const category = mentions(job.location, config.country) ? 'local' : 'global';
      post = await publisher.publish(draft.id, { content, jobTypes, category });
    } catch (e) {
      const count = (failureCounts[job.url] || 0) + 1;
      failureCounts[job.url] = count;
      report.failed.push({ title: job.title, company: job.company, error: e.message, attempt: count });
      log(`publish: failed "${job.title}" (${job.company}), attempt ${count}: ${e.message}`);
      if (count >= config.maxFailuresBeforeStuck) {
        seen[job.url] = Date.now();
        const stuck = (await store.getItem('stuckJobs')) || [];
        stuck.unshift({ title: job.title, company: job.company, url: job.url, error: e.message, failedAt: new Date().toISOString() });
        await store.setItem('stuckJobs', stuck);
        report.stuck.push(job.title);
        log(`publish: "${job.title}" failed ${count} times -- moved to the stuck-jobs list for manual review`);
      }
      await saveProgress();
    }

    if (post) {
      // Recorded before anything else, so the job is never published twice.
      seen[job.url] = Date.now();
      delete failureCounts[job.url];
      await saveProgress();
      const city = extractCity(job.location, knownCities);
      daily.count += 1;
      daily.cities.push(city);
      await store.setItem('dailyPostLog', daily);
      await dedup.record(job);

      // An indexing failure is logged; the job stays published.
      let indexed = true;
      try {
        await indexer.submit(post.link);
      } catch (e) {
        indexed = false;
        log(`index: submit failed for ${post.link}: ${e.message} (job stays published)`);
      }

      report.published.push({ title: content.seoTitle, company: job.company, link: post.link, source: job.source, score, reasons, city, jobTypes, indexed, contentBy: content.writtenBy });
      log(`publish: "${content.seoTitle}" -> ${post.link} (score ${score})`);
    }

    // Spacing between candidates protects the website database. Zero in demo mode.
    if (config.interCandidateDelayMs > 0) await new Promise((r) => setTimeout(r, config.interCandidateDelayMs));
  }

  await saveProgress();
  report.screening = { ...screener.stats };
  report.manualReviewQueue = ((await store.getItem(REVIEW_KEY)) || []).map(({ title, company, reason }) => ({ title, company, reason }));
  report.dailyCount = `${daily.count}/${config.dailyTarget}`;
  log(`run: published ${report.published.length} this run, ${daily.count}/${config.dailyTarget} today`);
  return report;
}

module.exports = { runOnce, localDateKey };
