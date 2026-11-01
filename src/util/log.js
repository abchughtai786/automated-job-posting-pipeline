'use strict';

function createActivityLog({ quiet = false } = {}) {
  const lines = [];
  const log = (msg) => {
    // Messages include text from third-party listings: control characters
    // (newlines, terminal escape codes) could fake log lines or the terminal.
    const safe = String(msg).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
    const line = `[${new Date().toISOString()}] ${safe}`;
    lines.push(line);
    if (!quiet) console.log(line);
  };
  log.lines = lines;
  return log;
}

module.exports = { createActivityLog };
