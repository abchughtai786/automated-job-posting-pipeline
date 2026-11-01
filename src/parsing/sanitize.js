'use strict';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Only http(s) and mailto links are ever written into a post.
function safeLinkUrl(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.toString() : '';
  } catch {
    return '';
  }
}

// Strips everything except a small allow-list of tags, and all attributes
// except href on links. Any "<" or ">" that is not part of a complete tag is
// escaped, so a half-written tag such as `<img src=x onerror=...` can never
// be completed by HTML appended later.
function sanitizeHtml(html) {
  const allowed = new Set(['p', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'br', 'a']);
  return String(html || '')
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(\/?)([a-z][a-z0-9]*)([^<>]*)>|[<>]/gi, (tag, slash, name, attrs) => {
      if (!name) return tag === '<' ? '&lt;' : '&gt;';
      const n = name.toLowerCase();
      if (!allowed.has(n)) return '';
      if (slash) return `</${n}>`;
      if (n === 'a') {
        const href = safeLinkUrl((attrs.match(/href\s*=\s*"([^"]*)"/i) || [])[1]);
        return href ? `<a href="${escapeHtml(href)}" rel="nofollow ugc noopener">` : '<a>';
      }
      return `<${n}>`;
    });
}

// For fields that must never contain markup (titles, company, location, meta
// text): tags are removed and any leftover angle brackets dropped.
function plainText(str) {
  return String(str ?? '')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// "Fancy" Unicode bold/italic letters (U+1D400 to U+1D7FF), common in
// pasted job titles, are 4-byte characters that a utf8 (not
// utf8mb4) WordPress database rejects. They are mapped back to plain ASCII;
// any other character outside the Basic Multilingual Plane (emoji) is dropped.
function sanitizeUnicodeText(str) {
  if (!str) return str;
  const LETTER_BLOCKS = [0x1d400, 0x1d434, 0x1d468, 0x1d49c, 0x1d4d0, 0x1d504, 0x1d538, 0x1d56c, 0x1d5a0, 0x1d5d4, 0x1d608, 0x1d63c, 0x1d670];
  const DIGIT_BLOCKS = [0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6];
  let out = '';
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x10000) {
      out += ch;
      continue;
    }
    let mapped = '';
    const letterBase = LETTER_BLOCKS.find((b) => cp >= b && cp < b + 52);
    if (letterBase !== undefined) {
      const offset = cp - letterBase;
      mapped = String.fromCharCode(offset < 26 ? 65 + offset : 97 + (offset - 26));
    } else {
      const digitBase = DIGIT_BLOCKS.find((b) => cp >= b && cp < b + 10);
      if (digitBase !== undefined) mapped = String.fromCharCode(48 + (cp - digitBase));
    }
    out += mapped;
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

module.exports = { escapeHtml, safeLinkUrl, sanitizeHtml, sanitizeUnicodeText, plainText };
