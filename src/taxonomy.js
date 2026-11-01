'use strict';

// Tagging rules: which city a job belongs to and which job-type terms it
// gets on the website.

const { escapeRegExp } = require('./util/regex');

const SENIOR_RE = /\b(senior|sr\.?|lead|principal|manager|head of|director|chief|vp|vice president)\b|\b\d+\+\s*years?\b/i;
const ENTRY_LEVEL_RE = /\bintern(ship)?s?\b|\btrainee\b|\bgraduate\b|\bentry.level\b|\bfresh(er)?\b|\bmanagement trainee\b/i;
const EXECUTIVE_RE = /\b(trainee officer|management trainee|officer|executive)\b/i;
const PART_TIME_RE = /\bpart.?time\b/i;
// Unambiguous scam signs. Checked by a rule before any AI call, so text in a
// post cannot talk an AI screener out of rejecting them.
const SCAM_RE = /\b(registration fee|security deposit|processing fee|pay .{0,20}to apply|monitoring software|earn \$?\d+.{0,10}(per|a) day|bank (account )?details|id card copy upfront)\b/i;

// Scans the whole location string, because listings write things like
// "District 4, City A, Country A" where the city is not the first segment.
function extractCity(location, knownCities = []) {
  const loc = location || '';
  for (const city of knownCities) {
    if (new RegExp(`\\b${escapeRegExp(city)}\\b`, 'i').test(loc)) return city;
  }
  return loc.split(',')[0].trim();
}

// "District 4, City A, Country A" -> { city: "City A", country: "Country A" }
function splitLocation(location) {
  const parts = (location || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: '', country: '' };
  if (parts.length === 1) return { city: parts[0], country: '' };
  return { city: parts[parts.length - 2], country: parts[parts.length - 1] };
}

// Job-type labels. The live WordPress adapter maps these to taxonomy term IDs.
function classifyJobTypes(job) {
  const text = `${job.title} ${job.description || ''}`.slice(0, 1000);
  const types = [];
  if (!SENIOR_RE.test(text)) types.push('entry-level');
  if (/\bintern(ship)?s?\b/i.test(job.title)) types.push('internship');
  if (EXECUTIVE_RE.test(job.title)) types.push('executive');
  types.push(PART_TIME_RE.test(text) ? 'part-time' : 'full-time');
  return types;
}

module.exports = { SENIOR_RE, ENTRY_LEVEL_RE, SCAM_RE, extractCity, splitLocation, classifyJobTypes };
