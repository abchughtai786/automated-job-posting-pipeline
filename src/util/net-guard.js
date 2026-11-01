'use strict';

// Demo-mode safety net. Every outbound HTTP request in this codebase goes
// through global fetch, and in demo mode this guard replaces fetch with a
// version that only lets the optional AI provider through. WordPress, Google
// and any other service are unreachable while it is installed.
//
// Scope: it guards `fetch` only. The code base uses no other network API;
// test/safety.test.js checks that no source file loads http, https, net,
// tls, dgram or child_process.

class BlockedRequestError extends Error {}

function hostnameOf(input) {
  const href = input instanceof URL ? input.href : typeof input === 'string' ? input : input?.url;
  try {
    return new URL(href).hostname;
  } catch {
    return null;
  }
}

function installNetGuard({ allowHosts = [] } = {}) {
  const realFetch = globalThis.fetch;
  const blocked = [];
  globalThis.fetch = async (input, init) => {
    const host = hostnameOf(input);
    if (!host || !allowHosts.includes(host)) {
      blocked.push(host || String(input));
      throw new BlockedRequestError(`demo mode blocked a request to ${host || 'an unparseable URL'}`);
    }
    return realFetch(input, init);
  };
  return {
    blocked,
    uninstall() {
      globalThis.fetch = realFetch;
    },
  };
}

module.exports = { installNetGuard, BlockedRequestError };
