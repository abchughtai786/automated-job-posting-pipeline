'use strict';

function createActivityLog({ quiet = false } = {}) {
  const lines = [];
  const log = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    lines.push(line);
    if (!quiet) console.log(line);
  };
  log.lines = lines;
  return log;
}

module.exports = { createActivityLog };
