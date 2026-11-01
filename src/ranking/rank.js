'use strict';

// Ranks new candidates so each run publishes the most useful ones first.
// Score signals: paid vs unpaid, in-demand fields, well-known employers,
// freshness, and spreading posts across cities before repeating one.

const { extractCity } = require('../taxonomy');
const { escapeRegExp } = require('../util/regex');

const HIGH_DEMAND_RE = /\b(web|developer|software|seo|marketing|ui\/?ux|design(er)?|data)\b/i;

function buildBrandRegex(brands) {
  if (!brands || brands.length === 0) return null;
  return new RegExp(`\\b(${brands.map(escapeRegExp).join('|')})\\b`, 'i');
}

function scoreJob(job, { postedCitiesToday = [], knownCities = [], brandRe = null, now = Date.now() }) {
  let score = 0;
  const reasons = [];
  const add = (n, why) => {
    score += n;
    reasons.push(`${n > 0 ? '+' : ''}${n} ${why}`);
  };
  if (/\bpaid\b/i.test(job.title)) add(3, 'paid');
  if (/\bunpaid\b/i.test(job.title)) add(-2, 'unpaid');
  if (HIGH_DEMAND_RE.test(job.title)) add(2, 'high-demand field');
  if (brandRe && brandRe.test(job.company)) add(5, 'well-known employer');
  if (job.postedAt && (now - new Date(job.postedAt).getTime()) / 3600000 <= 24) add(2, 'posted in last 24h');
  const city = extractCity(job.location, knownCities);
  if (city && !postedCitiesToday.includes(city)) add(3, `no ${city} post yet today`);
  return { score, reasons };
}

function rankJobs(jobs, opts) {
  return jobs
    .map((job) => ({ job, ...scoreJob(job, opts) }))
    .sort((a, b) => b.score - a.score);
}

module.exports = { rankJobs, scoreJob, buildBrandRegex };
