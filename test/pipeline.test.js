'use strict';

// Must be set before any config is loaded: forces demo mode for the whole suite.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildApp } = require('../src/app');
const { runOnce } = require('../src/pipeline');
const { createMockProvider } = require('../src/ai/mock');
const { tempConfig } = require('./helpers');

function fetchSpy() {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('no network in tests');
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}

test('end to end on the sample data: publishes locally and makes no network requests', async () => {
  const spy = fetchSpy();
  const config = tempConfig();
  const app = buildApp(config, { quiet: true });
  try {
    const report = await runOnce(app);
    assert.equal(report.collected, 9);
    assert.equal(report.published.length, 7);
    assert.equal(report.skipped[0].reason, 'duplicate (fuzzy title match)');
    assert.equal(report.failed.length, 1);
    assert.deepEqual(report.screening, { ruleRejected: 2, aiRejected: 3, aiPassed: 5, cached: 0, heldBack: 0, aiErrors: 0, sentToReview: 0 });
    const titles = report.published.map((p) => p.title).join(' | ');
    for (const rejected of ['Data Entry Intern', 'Office Assistant Intern', 'Data Analyst Intern', 'Content Writing Intern', 'Business Development Intern', 'Senior']) {
      assert.ok(!titles.includes(rejected), `${rejected} must not be published`);
    }

    assert.equal(fs.readdirSync(path.join(config.outputDir, 'posts')).filter((f) => f.endsWith('.html')).length, 7);
    assert.equal(app.guard.blocked.length, 0);
    assert.equal(spy.calls.length, 0);
  } finally {
    app.guard.uninstall();
    spy.restore();
  }
});

test('repeat runs: nothing is republished, and a failing job moves to the stuck list on the 3rd failure', async () => {
  const config = tempConfig();
  const app = buildApp(config, { quiet: true });
  try {
    await runOnce(app);
    const second = await runOnce(app);
    assert.equal(second.published.length, 0);
    assert.equal(second.failed[0].attempt, 2);
    const third = await runOnce(app);
    assert.deepEqual(third.stuck, ['Frontend Developer Intern']);
    const fourth = await runOnce(app);
    assert.equal(fourth.unseen, 0);
  } finally {
    app.guard.uninstall();
  }
});

test('run cap and daily target are respected', async () => {
  const config = tempConfig({ JOBS_RUN_CAP: '3', JOBS_DAILY_TARGET: '5' });
  const app = buildApp(config, { quiet: true });
  try {
    assert.equal((await runOnce(app)).published.length, 3);
    assert.equal((await runOnce(app)).published.length, 2);
    assert.equal((await runOnce(app)).published.length, 0);
  } finally {
    app.guard.uninstall();
  }
});

test('jobs held back by an AI rate limit are screened and published on a later run', async () => {
  const config = tempConfig({ AI_COOLDOWN_MS: '0' });
  const limited = buildApp(config, { quiet: true, ai: createMockProvider({ rateLimitAfterCalls: 0 }) });
  let first;
  try {
    first = await runOnce(limited);
  } finally {
    limited.guard.uninstall();
  }
  assert.ok(first.screening.heldBack > 0);
  const feedJobsFirst = first.published.filter((p) => p.source.startsWith('rss:')).length;
  assert.equal(feedJobsFirst, 0);

  const healthy = buildApp(config, { quiet: true });
  try {
    const second = await runOnce(healthy);
    assert.equal(second.published.filter((p) => p.source.startsWith('rss:')).length, 4);
  } finally {
    healthy.guard.uninstall();
  }
});

test('generated pages have structured content, and every published page is submitted for indexing', async () => {
  const config = tempConfig();
  const app = buildApp(config, { quiet: true });
  try {
    const report = await runOnce(app);
    const sales = report.published.find((p) => p.company === 'Riverbend Textiles');
    assert.equal(sales.city, 'City A');

    const slug = sales.link.split('/job/')[1].replace(/\/$/, '');
    const html = fs.readFileSync(path.join(config.outputDir, 'posts', `${slug}.html`), 'utf8');
    assert.match(html, /<title>Sales Trainee at Riverbend Textiles - City A, Country A<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]{40,}">/);
    assert.match(html, /<h3>Responsibilities<\/h3><ul><li>/);
    assert.match(html, /<h3>Requirements<\/h3><ul><li>/);
    assert.match(html, /<a href="https:\/\/jobboard\.example\/jobs\/sales-trainee-riverbend-textiles" rel="nofollow ugc noopener">/);

    const record = JSON.parse(fs.readFileSync(path.join(config.outputDir, 'posts', `${slug}.json`), 'utf8'));
    assert.deepEqual(record.jobTypes, ['entry-level', 'full-time']);
    assert.equal(record.category, 'local');
    const abroad = report.published.find((p) => p.company === 'Harbor Example Engineering');
    const abroadRecord = JSON.parse(fs.readFileSync(path.join(config.outputDir, 'posts', `${abroad.link.split('/job/')[1].replace(/\/$/, '')}.json`), 'utf8'));
    assert.equal(abroadRecord.category, 'global', 'a job outside the target country is tagged global');

    const indexed = JSON.parse(fs.readFileSync(path.join(config.outputDir, 'indexing-requests.json'), 'utf8'));
    assert.deepEqual(indexed.map((r) => r.url).sort(), report.published.map((p) => p.link).sort());
  } finally {
    app.guard.uninstall();
  }
});

test('when the AI screener keeps failing, no screened-source job is published and they end up in manual review', async () => {
  const config = tempConfig();
  const brokenAi = { ...createMockProvider(), name: 'broken', async screenJob() { throw new Error('upstream 500'); } };
  const app = buildApp(config, { quiet: true, ai: brokenAi });
  try {
    for (let run = 1; run <= 3; run++) {
      const report = await runOnce(app);
      const screened = report.published.filter((p) => !p.source.startsWith('career-page:'));
      assert.equal(screened.length, 0, `run ${run}: nothing from the job board without a verdict`);
    }
    const queue = (await app.store.getItem('manualReviewQueue')).map((q) => q.title);
    assert.ok(queue.includes('Sales Trainee'), 'a normal listing waits for a human');
    assert.ok(queue.includes('Data Analyst Intern'));
    assert.ok(!queue.includes('Data Entry Intern (Work From Home)'), 'scam signs are rejected by rule, without the AI');
    assert.ok(!queue.includes('Office Assistant Intern'), 'rule rejections never reach the AI');
  } finally {
    app.guard.uninstall();
  }
});

test('an indexing failure after publishing does not mark the job failed or republish it', async () => {
  const config = tempConfig({ JOBS_RUN_CAP: '2' });
  const app = buildApp(config, { quiet: true });
  app.indexer = { name: 'broken', async submit() { throw new Error('quota exceeded'); } };
  try {
    const first = await runOnce(app);
    assert.equal(first.published.length, 2);
    assert.ok(first.published.every((p) => p.indexed === false));
    assert.equal(first.failed.length, 0);
    const second = await runOnce(app);
    const firstLinks = new Set(first.published.map((p) => p.link));
    assert.ok(second.published.every((p) => !firstLinks.has(p.link)));
  } finally {
    app.guard.uninstall();
  }
});

test('progress is saved per job: if the process dies mid-run, published jobs are already marked seen', async () => {
  const config = tempConfig();
  // Models a process killed while indexing the 3rd job: the run never finishes.
  const dying = buildApp(config, { quiet: true });
  const realSubmit = dying.indexer.submit;
  let submits = 0;
  const killedLink = new Promise((resolve) => {
    dying.indexer.submit = async (url) => {
      if (++submits < 3) return realSubmit(url);
      resolve(url);
      return new Promise(() => {});
    };
  });
  runOnce(dying);
  const link = await killedLink;
  dying.guard.uninstall();

  const restarted = buildApp(config, { quiet: true });
  try {
    const seen = await restarted.store.getItem('seenUrls');
    assert.equal(Object.keys(seen).length, 3, 'the 3 jobs published before the crash are saved as seen');
    const report = await runOnce(restarted);
    assert.ok(report.published.every((p) => p.link !== link), 'the job being indexed at the crash is not republished');
    assert.equal(report.published.length + 3, 7);
  } finally {
    restarted.guard.uninstall();
  }
});
