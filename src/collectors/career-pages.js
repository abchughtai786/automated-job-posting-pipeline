'use strict';

// Structured job feeds published by employers themselves (careers-page JSON,
// applicant-tracking-system APIs). A real deployment would fetch these with
// a scraper or API client; the demo reads the same normalised shape from a
// sample file.
//
// These are first-party employer sources, so they are filtered to
// entry-level titles in the target country at collection time and are not
// sent to the AI screener.

const fs = require('fs');
const path = require('path');
const { ENTRY_LEVEL_RE } = require('../taxonomy');
const { mentions } = require('../util/regex');

// Sample data uses relative dates ("now-3h") so ranking by freshness stays
// meaningful whenever the demo is run.
function resolveDate(value) {
  const m = /^now-(\d+)h$/.exec(value || '');
  return m ? new Date(Date.now() - Number(m[1]) * 3600 * 1000).toISOString() : value || null;
}

async function collectCareerPages({ samplesDir, country }) {
  const raw = JSON.parse(fs.readFileSync(path.join(samplesDir, 'career-pages.json'), 'utf8'));
  return raw.sources.flatMap((source) =>
    source.jobs
      .filter((j) => ENTRY_LEVEL_RE.test(j.title) && mentions(j.location, country))
      .map((j) => ({
        title: j.title,
        company: source.company,
        location: j.location,
        url: j.applyUrl,
        description: j.description || '',
        postedAt: resolveDate(j.postedAt),
        source: `career-page:${source.id}`,
      }))
  );
}

module.exports = { collectCareerPages };
