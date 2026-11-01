'use strict';

// Two-stage screening for listings from open job boards:
//   1. free rule checks (senior titles, obvious scam signs, "apply here" stubs)
//   2. an LLM judgement on five questions (real employer, open to the target
//      country, real details, not cut off, no scam signs)
//
// LLM free tiers are rate-limited, so each job is screened once and the
// verdict cached for 14 days, calls are spaced out, and when the provider
// says "rate limit" the job is HELD BACK and screened on a later run.
//
// Screening FAILS CLOSED: a job is only accepted on a complete, valid verdict
// with all five answers true. Any other AI failure (network error, bad JSON,
// a verdict with missing fields) holds the job back for a retry, and after
// `maxAiFailures` failed attempts it goes to the manual-review queue instead
// of being screened again. Nothing is ever let through without a verdict.

const { SENIOR_RE, SCAM_RE } = require('../taxonomy');
const { RateLimitError } = require('../ai/groq');

const CACHE_KEY = 'eligibilityVerdicts';
const FAILURES_KEY = 'screeningFailures';
const REVIEW_KEY = 'manualReviewQueue';
const VERDICT_KEYS = ['realCompany', 'countryEligible', 'hasJobDetails', 'looksComplete', 'noScamRedFlags'];
const CACHE_MAX = 4000;
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SHORTEN_MARKER = '[...middle shortened by the screener...]';

// Description length without apply links and "send your CV" boilerplate.
function realDescriptionWordCount(description) {
  return (description || '')
    .replace(/apply\s*:?\s*\S+/gi, '')
    .replace(/submit\s+(your\s+)?(resume|cv)[^.]{0,200}\./gi, '')
    .replace(/mailto:\S+/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .split(/\s+/)
    .filter(Boolean).length;
}

// Long descriptions are shortened to save tokens, but the real ending is
// always kept and the cut is marked, so the model does not mistake our own
// trimming for a post that was cut off.
function descriptionForScreening(text) {
  const d = String(text || '').trim();
  if (d.length <= 1400) return d;
  return `${d.slice(0, 1000)} ${SHORTEN_MARKER} ${d.slice(-350)}`;
}

function eligibilityKey(job) {
  return String(job.url || `${job.title}|${job.company}`).slice(0, 300);
}

function isValidVerdict(v) {
  return Boolean(v) && typeof v === 'object' && VERDICT_KEYS.every((k) => typeof v[k] === 'boolean');
}

function createScreener({ ai, store, log, minGapMs = 2000, cooldownMs = 60_000, maxAiFailures = 3, now = Date.now }) {
  let lastCallAt = 0;
  let cooldownUntil = 0;
  const stats = { ruleRejected: 0, aiRejected: 0, aiPassed: 0, cached: 0, heldBack: 0, aiErrors: 0, sentToReview: 0 };

  async function remember(key, pass, extra = {}) {
    const cache = (await store.getItem(CACHE_KEY)) || {};
    cache[key] = { pass, at: now(), ...extra };
    const cutoff = now() - CACHE_TTL_MS;
    let keys = Object.keys(cache).filter((k) => cache[k].at >= cutoff);
    if (keys.length > CACHE_MAX) keys = keys.sort((a, b) => cache[a].at - cache[b].at).slice(-CACHE_MAX);
    await store.setItem(CACHE_KEY, Object.fromEntries(keys.map((k) => [k, cache[k]])));
  }

  async function clearFailures(key) {
    const failures = (await store.getItem(FAILURES_KEY)) || {};
    if (!Object.hasOwn(failures, key)) return;
    delete failures[key];
    await store.setItem(FAILURES_KEY, failures);
  }

  // The screen could not complete: hold the job for a retry, or after too
  // many attempts park it for a human. Always returns false (not accepted).
  async function holdOrEscalate(job, key, reason) {
    const failures = (await store.getItem(FAILURES_KEY)) || {};
    const attempts = (Object.hasOwn(failures, key) ? failures[key] : 0) + 1;
    if (attempts < maxAiFailures) {
      failures[key] = attempts;
      await store.setItem(FAILURES_KEY, failures);
      stats.heldBack += 1;
      log(`screen: AI check failed for "${job.title}" (${job.company}): ${reason} -- held back, retry ${attempts}/${maxAiFailures - 1} next run`);
      return false;
    }
    delete failures[key];
    await store.setItem(FAILURES_KEY, failures);
    const queue = (await store.getItem(REVIEW_KEY)) || [];
    if (!queue.some((q) => q.key === key)) {
      queue.unshift({ key, title: job.title, company: job.company, url: job.url, reason, attempts, queuedAt: new Date(now()).toISOString() });
      await store.setItem(REVIEW_KEY, queue);
    }
    // Cached as "not accepted" so it is not re-screened while awaiting review.
    await remember(key, false, { manualReview: true });
    stats.sentToReview += 1;
    log(`screen: AI check failed ${attempts} times for "${job.title}" (${job.company}) -- moved to the manual-review queue, not published`);
    return false;
  }

  async function checkOne(job) {
    if (SENIOR_RE.test(job.title)) {
      stats.ruleRejected += 1;
      log(`screen: rejected "${job.title}" (${job.company}) -- looks senior-level, not entry/internship`);
      return false;
    }
    if (SCAM_RE.test(`${job.title} ${job.company} ${job.description}`)) {
      stats.ruleRejected += 1;
      log(`screen: rejected "${job.title}" (${job.company}) -- scam signs (fees, bank/ID details or similar)`);
      return false;
    }
    if (realDescriptionWordCount(job.description) < 20) {
      stats.ruleRejected += 1;
      log(`screen: rejected "${job.title}" (${job.company}) -- description is just an apply-contact stub`);
      return false;
    }

    const key = eligibilityKey(job);
    const cache = (await store.getItem(CACHE_KEY)) || {};
    const cached = Object.hasOwn(cache, key) ? cache[key] : undefined;
    if (cached && now() - cached.at < CACHE_TTL_MS) {
      stats.cached += 1;
      return cached.pass;
    }
    if (now() < cooldownUntil) {
      stats.heldBack += 1;
      return false;
    }

    const wait = lastCallAt + minGapMs - now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = now();

    let verdict;
    try {
      verdict = await ai.screenJob(job, descriptionForScreening(job.description));
    } catch (e) {
      if (e instanceof RateLimitError) {
        cooldownUntil = now() + cooldownMs;
        stats.heldBack += 1;
        log('screen: AI rate limit reached -- holding back unscreened jobs for a later run');
        return false;
      }
      stats.aiErrors += 1;
      return holdOrEscalate(job, key, e.message || 'unknown AI error');
    }
    if (!isValidVerdict(verdict)) {
      stats.aiErrors += 1;
      return holdOrEscalate(job, key, 'AI returned an incomplete verdict');
    }

    const pass = VERDICT_KEYS.every((k) => verdict[k] === true);
    if (pass) stats.aiPassed += 1;
    else {
      stats.aiRejected += 1;
      log(`screen: rejected "${job.title}" (${job.company}) -- ${verdict.reason || 'failed eligibility check'}`);
    }
    await clearFailures(key);
    await remember(key, pass);
    return pass;
  }

  // Collectors run in parallel; checks are serialised so cache updates never
  // overwrite each other and AI calls keep their spacing.
  let pending = Promise.resolve();
  function check(job) {
    const result = pending.then(() => checkOne(job));
    pending = result.catch(() => {});
    return result;
  }

  return { check, stats };
}

module.exports = { createScreener, descriptionForScreening, realDescriptionWordCount, isValidVerdict, SHORTEN_MARKER, REVIEW_KEY };
