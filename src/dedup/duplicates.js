'use strict';

// Three layers of duplicate protection:
//   1. seen URLs     -- an apply link is processed once, ever
//   2. fingerprint   -- same company + title + city published in the last 7 days
//   3. fuzzy title   -- same company and >= 60% title-word overlap, which
//                       catches one vacancy reworded across sources
//                       ("Deputy Manager Accounts" vs "Dy. Manager - Accounts")

const { extractCity } = require('../taxonomy');

const FUZZY_TITLE_SIMILARITY_THRESHOLD = 0.6;

function normalizeCompanyName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\b(pvt|ltd|llc|inc|co|company|technologies|technology|solutions|group)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function titleTokens(title) {
  return [...new Set((title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2))];
}

function tokenOverlap(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const overlap = a.filter((t) => setB.has(t)).length;
  return overlap / Math.max(a.length, b.length);
}

function createDuplicateDetector({ store, knownCities, windowDays = 7, now = Date.now }) {
  const windowMs = windowDays * 24 * 3600 * 1000;
  const fingerprint = (job) =>
    `${normalizeCompanyName(job.company)}::${normalizeCompanyName(job.title)}::${normalizeCompanyName(extractCity(job.location, knownCities))}`;

  async function isRecentDuplicate(job) {
    const map = (await store.getItem('jobFingerprints')) || {};
    const exact = map[fingerprint(job)];
    if (exact && now() - exact.ts < windowMs) return 'exact fingerprint';

    const company = normalizeCompanyName(job.company);
    const tokens = titleTokens(job.title);
    if (company && tokens.length) {
      for (const entry of Object.values(map)) {
        if (now() - entry.ts >= windowMs || entry.company !== company) continue;
        if (tokenOverlap(tokens, entry.titleTokens) >= FUZZY_TITLE_SIMILARITY_THRESHOLD) return 'fuzzy title match';
      }
    }
    return null;
  }

  async function record(job) {
    const map = (await store.getItem('jobFingerprints')) || {};
    for (const k of Object.keys(map)) if (now() - map[k].ts >= windowMs) delete map[k];
    map[fingerprint(job)] = { ts: now(), company: normalizeCompanyName(job.company), titleTokens: titleTokens(job.title) };
    await store.setItem('jobFingerprints', map);
  }

  return { isRecentDuplicate, record, fingerprint };
}

module.exports = { createDuplicateDetector, normalizeCompanyName, titleTokens, tokenOverlap, FUZZY_TITLE_SIMILARITY_THRESHOLD };
