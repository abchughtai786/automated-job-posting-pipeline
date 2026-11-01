'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../src/config');

// A config pointing state and output at a fresh temp directory.
function tempConfig(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-pipeline-test-'));
  return loadConfig({ STATE_DIR: path.join(dir, 'state'), OUTPUT_DIR: path.join(dir, 'output'), ...overrides });
}

function memoryStore() {
  const m = new Map();
  return {
    async getItem(k) {
      return m.has(k) ? JSON.parse(m.get(k)) : undefined;
    },
    async setItem(k, v) {
      m.set(k, JSON.stringify(v));
    },
  };
}

module.exports = { tempConfig, memoryStore };
