'use strict';

// Offline stand-in for the LLM, used by default in demo mode and in tests.
// It answers the same tasks with simple, deterministic heuristics so
// the whole pipeline runs without an API key. It is NOT real screening
// quality; with a real provider the judgement comes from the LLM prompts in
// prompts.js.

const { RateLimitError } = require('./groq');
const { toPostContent } = require('../content/generator');
const { splitLocation, SCAM_RE } = require('../taxonomy');

const VAGUE_EMPLOYER_RE = /\b(dm for details|our client|inbox for details)\b/i;
const RESTRICTED_RE = /\b(must be based in (the )?(uk|us|usa|eu|uae|canada)|(us|uk|eu) citizens only|work permit required)\b/i;

function createMockProvider({ rateLimitAfterCalls = Infinity } = {}) {
  let screeningCalls = 0;

  return {
    name: 'mock (offline heuristics)',
    get screeningCalls() {
      return screeningCalls;
    },

    async screenJob(job, descriptionForScreening) {
      screeningCalls += 1;
      if (screeningCalls > rateLimitAfterCalls) throw new RateLimitError('mock rate limit');
      const d = descriptionForScreening || '';
      const realEnding = d.split('[...middle shortened by the screener...]').pop().trim();
      const verdict = {
        realCompany: !VAGUE_EMPLOYER_RE.test(d) && !VAGUE_EMPLOYER_RE.test(job.company),
        countryEligible: !RESTRICTED_RE.test(d),
        hasJobDetails: d.split(/\s+/).length >= 25,
        looksComplete: /[.!?)]\s*$/.test(realEnding),
        noScamRedFlags: !SCAM_RE.test(d),
      };
      const failed = Object.keys(verdict).filter((k) => !verdict[k]);
      verdict.reason = failed.length ? `mock screener: failed ${failed.join(', ')}` : 'mock screener: looks fine';
      return verdict;
    },

    async writeJobContent(job) {
      const { city, country: jobCountry } = splitLocation(job.location);
      const place = jobCountry ? `${city}, ${jobCountry}` : city;
      // Reuse the deterministic formatter (headings and bullet lists become HTML).
      const description = job.description || '';
      return {
        seoTitle: `${job.title} at ${job.company} - ${place}`,
        metaDescription: `${job.company} is hiring a ${job.title} in ${city}. Read the requirements and apply directly through the employer's official link.`,
        focusKeyphrase: `${job.title} ${city}`.toLowerCase(),
        relatedKeyphrases: [`${job.title} jobs ${city}`, `${job.company} careers`, `entry level jobs ${city}`],
        deadline: null,
        descriptionHtml: toPostContent({ ...job, description, url: null }),
      };
    },
  };
}

module.exports = { createMockProvider };
