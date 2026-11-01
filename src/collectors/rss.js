'use strict';

// Job-board RSS feeds. Minimal RSS 2.0 parsing without dependencies:
// enough for the <item><title><link><description><pubDate> shape.
//
// Open job boards accept postings from anyone, so their items go through the
// AI screener.

const fs = require('fs');
const path = require('path');
const { ENTRY_LEVEL_RE } = require('../taxonomy');
const { sanitizeUnicodeText, safeLinkUrl } = require('../parsing/sanitize');

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

// Feeds come from third parties, so items are found with indexOf (linear
// time, whatever the input) and each field is capped in length.
const MAX_FIELD_CHARS = 20_000;

function parseRss(xml) {
  const items = [];
  let from = 0;
  for (;;) {
    const start = xml.indexOf('<item>', from);
    if (start === -1) break;
    const end = xml.indexOf('</item>', start);
    if (end === -1) break;
    const body = xml.slice(start + 6, end);
    from = end + 7;
    const tag = (name) => {
      const open = body.indexOf(`<${name}>`);
      const close = open === -1 ? -1 : body.indexOf(`</${name}>`, open);
      return close === -1 ? '' : decode(body.slice(open + name.length + 2, close).slice(0, MAX_FIELD_CHARS));
    };
    items.push({ title: tag('title'), link: tag('link'), description: tag('description'), pubDate: tag('pubDate'), company: tag('company'), location: tag('location') });
  }
  return items;
}

function toIsoDate(value) {
  const d = new Date(value);
  return value && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

async function collectRss({ samplesDir, country, screener }) {
  const xml = fs.readFileSync(path.join(samplesDir, 'job-board-feed.xml'), 'utf8');
  const candidates = parseRss(xml)
    // "Fancy" Unicode bold titles are normalised first, so they match the filters.
    .map((i) => ({ ...i, title: sanitizeUnicodeText(i.title) }))
    // Invalid apply links are dropped before screening, so no AI call is spent on them.
    .filter((i) => ENTRY_LEVEL_RE.test(i.title) && safeLinkUrl(i.link))
    .map((i) => ({
      title: i.title,
      company: i.company || 'Unknown',
      location: i.location || country,
      url: i.link,
      description: i.description.replace(/<[^<>]*>/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
      postedAt: toIsoDate(i.pubDate),
      source: 'rss:job-board',
    }));
  const jobs = [];
  for (const job of candidates) if (await screener.check(job)) jobs.push(job);
  return jobs;
}

module.exports = { collectRss, parseRss };
