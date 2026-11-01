'use strict';

// All configuration comes from environment variables (see .env.example).
// Demo mode is the default and cannot be switched off by accident: live
// publishing needs DEMO_MODE=false AND PUBLISH_MODE=wordpress AND the
// explicit LIVE_PUBLISH_CONFIRM phrase, and the test suite forces demo mode.

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const LIVE_CONFIRM_PHRASE = 'I_UNDERSTAND_THIS_PUBLISHES_TO_A_REAL_SITE';

function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
}

// Fails early with a clear message instead of crashing mid-run.
function loadSiteConfig(file) {
  let site;
  try {
    site = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read site config ${file}: ${e.message}`);
  }
  const isNameList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim());
  const problems = [];
  if (!isNameList(site.cities)) problems.push('cities');
  if (site.brands !== undefined && !isNameList(site.brands)) problems.push('brands');
  if (problems.length) throw new Error(`invalid site config ${file}: ${problems.join(', ')} must be a list of names`);
  return { cities: site.cities, brands: site.brands || [] };
}

function loadConfig(overrides = {}) {
  if (process.env.NODE_ENV !== 'test') loadDotEnv();
  const env = { ...process.env, ...overrides };
  const isTest = env.NODE_ENV === 'test';
  const int = (name, fallback) => {
    const v = parseInt(env[name], 10);
    return Number.isFinite(v) ? v : fallback;
  };

  const demoMode = isTest || env.DEMO_MODE !== 'false';
  const wantsLive = env.PUBLISH_MODE === 'wordpress';
  const liveConfirmed = env.LIVE_PUBLISH_CONFIRM === LIVE_CONFIRM_PHRASE;
  const publishMode = !demoMode && wantsLive && liveConfirmed ? 'wordpress' : 'mock';

  const siteFile = env.SITE_CONFIG || path.join(ROOT, 'config', 'site.example.json');

  return {
    root: ROOT,
    demoMode,
    publishMode,
    liveBlockedReason:
      wantsLive && publishMode !== 'wordpress'
        ? demoMode
          ? 'DEMO_MODE is on'
          : 'LIVE_PUBLISH_CONFIRM phrase not set'
        : null,

    siteName: env.SITE_NAME || 'Example Jobs Board',
    siteUrl: (env.SITE_URL || 'https://jobs.example.com').replace(/\/$/, ''),
    country: env.TARGET_COUNTRY || 'Country A',

    aiProvider: env.AI_PROVIDER === 'groq' && env.GROQ_API_KEY ? 'groq' : 'mock',
    groqApiKey: env.GROQ_API_KEY || '',
    groqModel: env.GROQ_MODEL || 'openai/gpt-oss-120b',
    aiMinGapMs: int('AI_MIN_GAP_MS', 2000),
    aiCooldownMs: int('AI_COOLDOWN_MS', 60_000),

    dailyTarget: int('JOBS_DAILY_TARGET', 20),
    runCap: int('JOBS_RUN_CAP', 8),
    interCandidateDelayMs: int('INTER_CANDIDATE_DELAY_MS', demoMode ? 0 : 60_000),
    maxFailuresBeforeStuck: int('MAX_FAILURES_BEFORE_STUCK', 3),
    maxAiFailuresBeforeReview: int('MAX_AI_FAILURES_BEFORE_REVIEW', 3),
    fingerprintWindowDays: int('FINGERPRINT_WINDOW_DAYS', 7),
    timezoneOffsetHours: int('TIMEZONE_OFFSET_HOURS', 0),

    wordpress: {
      baseUrl: env.WP_BASE_URL || '',
      username: env.WP_USERNAME || '',
      appPassword: env.WP_APP_PASSWORD || '',
      jobTypeTerms: env.WP_JOB_TYPE_TERMS || '{}',
      categoryTerms: env.WP_CATEGORY_TERMS || '{}',
    },
    googleIndexingKeyPath: env.GOOGLE_INDEXING_KEY_PATH || '',

    site: loadSiteConfig(siteFile),

    samplesDir: env.SAMPLES_DIR || path.join(ROOT, 'data', 'samples'),
    stateDir: env.STATE_DIR || path.join(ROOT, '.demo-state'),
    outputDir: env.OUTPUT_DIR || path.join(ROOT, 'output'),
  };
}

module.exports = { loadConfig, loadSiteConfig, LIVE_CONFIRM_PHRASE };
