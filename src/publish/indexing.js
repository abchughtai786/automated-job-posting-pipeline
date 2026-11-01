'use strict';

// Search-engine notification after publish.
//
// The live adapter submits each new job URL to the Google Indexing API
// (intended for JobPosting pages; quota-limited) using a service-account JWT
// signed with Node's built-in crypto. It is opt-in: only used when live
// publishing is fully enabled AND a key file path is configured, and it has
// not been verified against the real API. The demo records the URL in
// output/indexing-requests.json instead.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createMockIndexer({ outputDir }) {
  const file = path.join(outputDir, 'indexing-requests.json');
  return {
    name: 'mock indexer (writes output/indexing-requests.json)',
    async submit(url) {
      const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
      list.push({ url, type: 'URL_UPDATED', at: new Date().toISOString() });
      fs.writeFileSync(file, JSON.stringify(list, null, 2));
    },
  };
}

function createGoogleIndexer({ keyPath }) {
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const b64 = (x) => Buffer.from(x).toString('base64url');
  let token = null;
  let tokenExpires = 0;

  async function getToken() {
    if (token && Date.now() < tokenExpires - 60_000) return token;
    const now = Math.floor(Date.now() / 1000);
    const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64(
      JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/indexing', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })
    );
    const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(`Google token error: ${data.error || res.status}`);
    token = data.access_token;
    tokenExpires = Date.now() + data.expires_in * 1000;
    return token;
  }

  return {
    name: 'Google Indexing API',
    async submit(url) {
      const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'URL_UPDATED' }),
      });
      if (!res.ok) throw new Error(`Indexing API ${res.status}`);
    },
  };
}

module.exports = { createMockIndexer, createGoogleIndexer };
