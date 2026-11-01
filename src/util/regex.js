'use strict';

// Config values (country, city and brand names) are matched as literal text.
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Case-insensitive "does this text mention that name" test.
function mentions(text, name) {
  return new RegExp(escapeRegExp(name), 'i').test(text || '');
}

module.exports = { escapeRegExp, mentions };
