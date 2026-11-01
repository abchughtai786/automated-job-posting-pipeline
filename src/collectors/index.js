'use strict';

const { collectCareerPages } = require('./career-pages');
const { collectRss } = require('./rss');
const { safeLinkUrl } = require('../parsing/sanitize');

// Sources fail independently: one broken source never stops the others.
async function collectAll(ctx) {
  const sources = [
    ['career pages', () => collectCareerPages(ctx)],
    ['job-board RSS', () => collectRss(ctx)],
  ];
  const results = await Promise.allSettled(sources.map(([, fn]) => fn()));
  const jobs = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') jobs.push(...r.value);
    else ctx.log(`collect: ${sources[i][0]} failed: ${r.reason?.message}`);
  });
  // The apply link becomes a clickable link on the site and a state key, so
  // only http(s) and mailto links are accepted, whatever the source.
  return jobs.filter((j) => {
    if (safeLinkUrl(j.url)) return true;
    ctx.log(`collect: dropped "${j.title}" (${j.company}) -- apply link is not an http(s) or mailto link`);
    return false;
  });
}

module.exports = { collectAll };
