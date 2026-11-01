'use strict';

// Wires the pipeline together from config. In demo mode every outside-world
// adapter is a local mock, and a network guard blocks any request that is
// not to the (optional) AI provider.

const { createJsonStore } = require('./store/json-store');
const { createActivityLog } = require('./util/log');
const { installNetGuard } = require('./util/net-guard');
const { createAiProvider } = require('./ai');
const { createScreener } = require('./screening/screener');
const { createDuplicateDetector } = require('./dedup/duplicates');
const { createMockPublisher } = require('./publish/mock-wordpress');
const { createWordPressPublisher } = require('./publish/wordpress');
const { createMockIndexer, createGoogleIndexer } = require('./publish/indexing');

function buildApp(config, { quiet = false, ai: aiOverride } = {}) {
  const live = config.publishMode === 'wordpress';
  // Second line of defence: even a hand-built config cannot wire the live
  // adapters while the test suite is running.
  if (live && process.env.NODE_ENV === 'test') throw new Error('live adapters are disabled while NODE_ENV=test');

  const log = createActivityLog({ quiet });
  // The guard stays on unless live publishing is fully enabled.
  const guard = live ? null : installNetGuard({ allowHosts: config.aiProvider === 'groq' ? ['api.groq.com'] : [] });
  const store = createJsonStore(config.stateDir);
  const ai = aiOverride || createAiProvider(config);

  const publisher = live ? createWordPressPublisher(config) : createMockPublisher(config);
  const indexer = live && config.googleIndexingKeyPath ? createGoogleIndexer({ keyPath: config.googleIndexingKeyPath }) : createMockIndexer(config);

  return {
    config,
    log,
    guard,
    store,
    ai,
    screener: createScreener({
      ai,
      store,
      log,
      minGapMs: config.demoMode && config.aiProvider === 'mock' ? 0 : config.aiMinGapMs,
      cooldownMs: config.aiCooldownMs,
      maxAiFailures: config.maxAiFailuresBeforeReview,
    }),
    dedup: createDuplicateDetector({ store, knownCities: config.site.cities, windowDays: config.fingerprintWindowDays }),
    publisher,
    indexer,
  };
}

module.exports = { buildApp };
