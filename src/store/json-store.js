'use strict';

// Tiny key-value store backed by one JSON file per key, with atomic writes
// (write to a temp file, then rename). It uses the same getItem/setItem shape
// as node-persist, so a larger store can be swapped in.

const fs = require('fs');
const path = require('path');

function createJsonStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (key) => path.join(dir, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  return {
    async getItem(key) {
      try {
        return JSON.parse(fs.readFileSync(file(key), 'utf8'));
      } catch {
        return undefined;
      }
    },
    async setItem(key, value) {
      const target = file(key);
      fs.writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2));
      fs.renameSync(`${target}.tmp`, target);
    },
  };
}

module.exports = { createJsonStore };
