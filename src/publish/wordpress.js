'use strict';

// LIVE adapter (opt-in): WordPress REST API + WP Job Manager (`job-listings`
// post type), authenticated with an Application Password. It is only created
// when config.publishMode === 'wordpress', which requires DEMO_MODE=false,
// PUBLISH_MODE=wordpress and the LIVE_PUBLISH_CONFIRM phrase, and never
// while NODE_ENV=test. The demo never uses it; the tests exercise it only
// against a stubbed fetch. It has not been verified against a real site.
//
// Two steps: create a draft first, then fill in the AI content and publish.
// Term IDs for job types/categories are site-specific, so they come from
// WP_JOB_TYPE_TERMS / WP_CATEGORY_TERMS (JSON) in .env.

const { escapeHtml } = require('../parsing/sanitize');

function createWordPressPublisher(config) {
  const { baseUrl, username, appPassword } = config.wordpress;
  if (!baseUrl || !username || !appPassword) throw new Error('WordPress publisher needs WP_BASE_URL, WP_USERNAME and WP_APP_PASSWORD');
  // The application password is sent with every request, so it must never
  // travel unencrypted (plain http is allowed only for a local test site).
  const { protocol, hostname } = new URL(baseUrl);
  if (protocol !== 'https:' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    throw new Error('WP_BASE_URL must use https:// (plain http would send the password unencrypted)');
  }
  const auth = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
  const parseTerms = (name, raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`${name} must be a JSON object of term IDs`);
    }
  };
  const typeTerms = parseTerms('WP_JOB_TYPE_TERMS', config.wordpress.jobTypeTerms || '{}');
  const categoryTerms = parseTerms('WP_CATEGORY_TERMS', config.wordpress.categoryTerms || '{}');

  async function wp(method, route, body) {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${route}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WordPress ${method} ${route} -> ${res.status} ${data?.message || ''}`.trim());
    return data;
  }

  return {
    name: `WordPress (${new URL(baseUrl).host})`,

    async createDraft(job) {
      if (!job.description || !job.description.trim()) throw new Error('skipped -- no description available from source');
      const post = await wp('POST', '/job-listings', {
        title: `${job.company} Hiring: ${job.title}`,
        status: 'draft',
        meta: { _company_name: job.company, _job_location: job.location, _application: job.url },
      });
      return { id: post.id };
    },

    async publish(id, { content, jobTypes, category }) {
      const payload = {
        title: content.seoTitle,
        content: `<p><em>${escapeHtml(content.metaDescription)}</em></p>\n${content.descriptionHtml}`,
        status: 'publish',
        'job-types': jobTypes.map((t) => typeTerms[t]).filter(Boolean),
        'job-categories': [categoryTerms[category]].filter(Boolean),
      };
      if (content.deadline) payload.meta = { _job_expires: content.deadline };
      const post = await wp('POST', `/job-listings/${id}`, payload);
      return { id: post.id, link: post.link };
    },
  };
}

module.exports = { createWordPressPublisher };
