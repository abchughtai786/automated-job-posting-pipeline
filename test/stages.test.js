'use strict';

// Must be set before any config is loaded: forces demo mode for the whole suite.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeUnicodeText, sanitizeHtml } = require('../src/parsing/sanitize');
const { createScreener, descriptionForScreening, isValidVerdict, SHORTEN_MARKER, REVIEW_KEY } = require('../src/screening/screener');
const { createDuplicateDetector } = require('../src/dedup/duplicates');
const { rankJobs, buildBrandRegex } = require('../src/ranking/rank');
const { classifyJobTypes } = require('../src/taxonomy');
const { createMockProvider } = require('../src/ai/mock');
const { RateLimitError } = require('../src/ai/groq');
const { createMockPublisher } = require('../src/publish/mock-wordpress');
const { collectRss } = require('../src/collectors/rss');
const { memoryStore } = require('./helpers');

const goodDescription =
  'We are hiring interns to support the analytics team. You will clean data, build weekly dashboards, and present results to managers. Students with Excel and SQL skills are welcome to apply.';

test('parses RSS items and normalises "fancy" Unicode titles before filtering', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-'));
  fs.writeFileSync(
    path.join(dir, 'job-board-feed.xml'),
    '<rss><item><title>𝗗𝗮𝘁𝗮 𝗜𝗻𝘁𝗲𝗿𝗻</title><company>Meadow &amp; Co</company><location>City C, Country A</location><link>https://x.example/1</link><description><![CDATA[<p>Hi</p>]]></description></item><item><title>Senior Analyst</title><link>https://x.example/2</link></item></rss>'
  );
  const jobs = await collectRss({ samplesDir: dir, country: 'Country A', screener: { check: async () => true } });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Data Intern');
  assert.equal(jobs[0].company, 'Meadow & Co');
  assert.equal(jobs[0].description, 'Hi');
});

test('maps "fancy" Unicode bold letters back to ASCII', () => {
  assert.equal(sanitizeUnicodeText('𝗦𝗼𝗳𝘁𝘄𝗮𝗿𝗲 𝗜𝗻𝘁𝗲𝗿𝗻 🚀'), 'Software Intern');
});

test('sanitizeHtml keeps safe structure and removes scripts and attributes', () => {
  const out = sanitizeHtml('<p class="x" onclick="evil()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>');
  assert.equal(out, '<p>Hi</p><a>x</a>');
});

test('long descriptions keep their real ending and mark the cut', () => {
  const long = 'a'.repeat(2000) + ' THE END.';
  const out = descriptionForScreening(long);
  assert.ok(out.includes(SHORTEN_MARKER));
  assert.ok(out.endsWith('THE END.'));
});

test('screener: rules reject senior roles and stubs before any AI call', async () => {
  const ai = createMockProvider();
  const s = createScreener({ ai, store: memoryStore(), log: () => {}, minGapMs: 0 });
  assert.equal(await s.check({ title: 'Deputy Manager Finance', company: 'A', description: goodDescription, url: 'u1' }), false);
  assert.equal(await s.check({ title: 'Intern', company: 'A', description: 'Apply: x@y.example', url: 'u2' }), false);
  assert.equal(ai.screeningCalls, 0);
  assert.equal(s.stats.ruleRejected, 2);
});

test('screener: verdicts are cached, so a job is screened once', async () => {
  const ai = createMockProvider();
  const s = createScreener({ ai, store: memoryStore(), log: () => {}, minGapMs: 0 });
  const job = { title: 'Data Intern', company: 'Meadow', location: 'City B', description: goodDescription, url: 'u3' };
  assert.equal(await s.check(job), true);
  assert.equal(await s.check(job), true);
  assert.equal(ai.screeningCalls, 1);
  assert.equal(s.stats.cached, 1);
});

test('screener: on a rate limit the job is held back, not let through', async () => {
  let t = 0;
  const ai = { async screenJob() { throw new RateLimitError('429'); } };
  const s = createScreener({ ai, store: memoryStore(), log: () => {}, minGapMs: 0, cooldownMs: 60_000, now: () => t });
  const job = (url) => ({ title: 'Data Intern', company: 'M', location: 'City B', description: goodDescription, url });
  assert.equal(await s.check(job('a')), false);
  assert.equal(await s.check(job('b')), false, 'still in cooldown, no call made');
  assert.equal(s.stats.heldBack, 2);
});

test('screener: other AI failures fail closed -- held back, never let through', async () => {
  const ai = { async screenJob() { throw new Error('bad JSON'); } };
  const store = memoryStore();
  const s = createScreener({ ai, store, log: () => {}, minGapMs: 0 });
  assert.equal(await s.check({ title: 'Data Intern', company: 'M', description: goodDescription, url: 'x' }), false);
  assert.equal(s.stats.aiErrors, 1);
  assert.equal(s.stats.heldBack, 1);
  assert.equal((await store.getItem('eligibilityVerdicts'))?.x, undefined, 'a failed screen is not cached as a verdict');
});

test('screener: a suspicious post is not accepted when the AI call throws, and goes to manual review after 3 failures', async () => {
  let calls = 0;
  const ai = { async screenJob() { calls += 1; throw new Error('network down'); } };
  const store = memoryStore();
  const s = createScreener({ ai, store, log: () => {}, minGapMs: 0, maxAiFailures: 3 });
  // Vague recruiter post with no rule-detectable scam phrase: only the AI could judge it.
  const scam = { title: 'Typing Intern', company: 'Q', url: 'scam', description: `${goodDescription} DM for details, our client pays weekly.` };
  for (let run = 1; run <= 3; run++) assert.equal(await s.check(scam), false, `attempt ${run}`);
  assert.equal(s.stats.heldBack, 2);
  assert.equal(s.stats.sentToReview, 1);
  const queue = await store.getItem(REVIEW_KEY);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].url, 'scam');
  assert.equal(queue[0].reason, 'network down');
  // Once queued it is not re-screened (no more AI calls) and still not accepted.
  assert.equal(await s.check(scam), false);
  assert.equal(calls, 3);
});

test('screener: an incomplete or malformed verdict is not accepted', async () => {
  for (const verdict of [null, 'yes', {}, { realCompany: true, countryEligible: true, hasJobDetails: true, looksComplete: true }, { realCompany: true, countryEligible: true, hasJobDetails: true, looksComplete: true, noScamRedFlags: 'true' }]) {
    const s = createScreener({ ai: { async screenJob() { return verdict; } }, store: memoryStore(), log: () => {}, minGapMs: 0 });
    assert.equal(await s.check({ title: 'Data Intern', company: 'M', description: goodDescription, url: 'v' }), false, JSON.stringify(verdict));
    assert.equal(s.stats.aiErrors, 1);
  }
  assert.equal(isValidVerdict({ realCompany: true, countryEligible: false, hasJobDetails: true, looksComplete: true, noScamRedFlags: true }), true);
});

test('screener: a later successful screen clears earlier AI failures', async () => {
  let fail = true;
  const ai = createMockProvider();
  const flaky = { async screenJob(...a) { if (fail) throw new Error('timeout'); return ai.screenJob(...a); } };
  const store = memoryStore();
  const s = createScreener({ ai: flaky, store, log: () => {}, minGapMs: 0 });
  const job = { title: 'Data Intern', company: 'Meadow', location: 'City B', description: goodDescription, url: 'f' };
  assert.equal(await s.check(job), false);
  fail = false;
  assert.equal(await s.check(job), true);
  assert.deepEqual(await store.getItem('screeningFailures'), {});
});

test('screener: parallel checks are serialised, so no cached verdict is lost', async () => {
  const store = memoryStore();
  // A store with an async gap between read and write, like a real database.
  const tick = () => new Promise((r) => setImmediate(r));
  const slowStore = { async getItem(k) { await tick(); return store.getItem(k); }, async setItem(k, v) { await tick(); return store.setItem(k, v); } };
  const s = createScreener({ ai: createMockProvider(), store: slowStore, log: () => {}, minGapMs: 0 });
  const jobs = Array.from({ length: 6 }, (_, i) => ({ title: 'Data Intern', company: 'M', location: 'City B', description: goodDescription, url: `p${i}` }));
  await Promise.all(jobs.map((j) => s.check(j)));
  assert.equal(Object.keys(await store.getItem('eligibilityVerdicts')).length, 6);
});

test('mock screener flags scams, restrictions and cut-off text', async () => {
  const ai = createMockProvider();
  const scam = await ai.screenJob({ company: 'X' }, `${goodDescription} A registration fee of 1500 applies.`);
  assert.equal(scam.noScamRedFlags, false);
  const uk = await ai.screenJob({ company: 'X' }, `${goodDescription} Applicants must be based in the UK.`);
  assert.equal(uk.countryEligible, false);
  const cut = await ai.screenJob({ company: 'X' }, `${goodDescription} About the role We are`);
  assert.equal(cut.looksComplete, false);
});

test('dedup: exact fingerprint, fuzzy title, and the 7-day window', async () => {
  let t = 0;
  const d = createDuplicateDetector({ store: memoryStore(), knownCities: ['City A'], now: () => t });
  await d.record({ company: 'Northwind Telecom', title: 'Graduate Trainee - Network Operations', location: 'City A, Country A' });
  assert.equal(await d.isRecentDuplicate({ company: 'Northwind Telecom', title: 'Graduate Trainee - Network Operations', location: 'City A, Country A' }), 'exact fingerprint');
  assert.equal(await d.isRecentDuplicate({ company: 'Northwind Telecom Pvt Ltd', title: 'Graduate Trainee Network Operations City A', location: 'City A' }), 'fuzzy title match');
  assert.equal(await d.isRecentDuplicate({ company: 'Northwind Telecom', title: 'Finance Intern', location: 'City A' }), null);
  t = 8 * 24 * 3600 * 1000;
  assert.equal(await d.isRecentDuplicate({ company: 'Northwind Telecom', title: 'Graduate Trainee - Network Operations', location: 'City A, Country A' }), null);
});

test('ranking favours paid, in-demand, well-known and new-city jobs', () => {
  const ranked = rankJobs(
    [
      { title: 'Office Intern', company: 'Small Co', location: 'City A, Country A' },
      { title: 'Software Intern (Paid)', company: 'Kitebrook Bank', location: 'City B, Country A' },
    ],
    { postedCitiesToday: ['City A'], knownCities: ['City A', 'City B'], brandRe: buildBrandRegex(['Kitebrook Bank']) }
  );
  assert.equal(ranked[0].job.company, 'Kitebrook Bank');
  assert.equal(ranked[0].score, 3 + 2 + 5 + 3);
});

test('job types: entry level is withheld from senior roles', () => {
  assert.deepEqual(classifyJobTypes({ title: 'Management Trainee Officer', description: '' }), ['entry-level', 'executive', 'full-time']);
  assert.ok(!classifyJobTypes({ title: 'Sales Lead', description: '' }).includes('entry-level'));
});

test('mock publisher never overwrites an existing page with the same slug', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posts-'));
  const pub = createMockPublisher({ outputDir: dir, siteUrl: 'https://jobs.example.com' });
  const content = { seoTitle: 'Sales Trainee at Riverbend Textiles', metaDescription: 'm', descriptionHtml: '<p>x</p>' };
  const job = { title: 'Sales Trainee', company: 'Riverbend Textiles', description: 'x', url: 'u' };
  const a = await pub.publish((await pub.createDraft(job)).id, { content, jobTypes: [], category: 'local' });
  const b = await pub.publish((await pub.createDraft(job)).id, { content, jobTypes: [], category: 'local' });
  assert.notEqual(a.link, b.link);
  assert.equal(fs.readdirSync(path.join(dir, 'posts')).filter((f) => f.endsWith('.html')).length, 2);
});
