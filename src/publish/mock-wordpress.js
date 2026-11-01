'use strict';

// Demo publisher. Implements the same interface as the real WordPress
// adapter, but "publishing" means writing an HTML preview and a JSON record
// to output/posts/. Nothing leaves the machine.

const fs = require('fs');
const path = require('path');
const { slugify } = require('../content/generator');
const { escapeHtml } = require('../parsing/sanitize');

// Minimal styling so the local preview reads like a job page.
const PREVIEW_CSS = [
  'body{max-width:720px;margin:32px auto;padding:0 20px;font:16px/1.6 system-ui,sans-serif;color:#1f2328;background:#fff}',
  'h1{font-size:1.6rem;line-height:1.3;margin:.2em 0}',
  'h3{margin:1.4em 0 .3em;font-size:1.05rem}',
  '.preview{display:inline-block;margin:0;padding:2px 10px;border-radius:12px;background:#fff4d6;color:#7a5500;font-size:.8rem}',
  '.meta{color:#57606a}',
  '.tags span{display:inline-block;margin-right:6px;padding:1px 10px;border-radius:12px;background:#eef2f6;font-size:.85rem}',
  'a{color:#0969da}',
].join('');

function createMockPublisher({ outputDir, siteUrl }) {
  const postsDir = path.join(outputDir, 'posts');
  fs.mkdirSync(postsDir, { recursive: true });
  let nextId = 1000 + fs.readdirSync(postsDir).filter((f) => f.endsWith('.json')).length;
  const drafts = new Map();

  return {
    name: 'mock WordPress (writes to output/posts)',

    async createDraft(job) {
      // Same guard as the live adapter: an empty description is never published.
      if (!job.description || !job.description.trim()) {
        throw new Error('skipped -- no description available from source');
      }
      const id = nextId++;
      drafts.set(id, { id, job, status: 'draft' });
      return { id };
    },

    async publish(id, { content, jobTypes, category }) {
      const draft = drafts.get(id);
      if (!draft) throw new Error(`draft ${id} not found`);
      // Like WordPress, a taken slug gets a numeric suffix instead of overwriting.
      let slug = slugify(content.seoTitle) || `job-${id}`;
      if (fs.existsSync(path.join(postsDir, `${slug}.json`))) slug = `${slug}-${id}`;
      const link = `${siteUrl}/job/${slug}/`;
      const record = {
        id,
        status: 'publish',
        link,
        title: content.seoTitle,
        company: draft.job.company,
        location: draft.job.location,
        applyUrl: draft.job.url,
        jobTypes,
        category,
        deadline: content.deadline,
        focusKeyphrase: content.focusKeyphrase,
        relatedKeyphrases: content.relatedKeyphrases,
        metaDescription: content.metaDescription,
        contentBy: content.writtenBy,
      };
      fs.writeFileSync(path.join(postsDir, `${slug}.json`), JSON.stringify(record, null, 2));
      fs.writeFileSync(
        path.join(postsDir, `${slug}.html`),
        `<!doctype html><meta charset="utf-8"><title>${escapeHtml(content.seoTitle)}</title>\n` +
          `<meta name="description" content="${escapeHtml(content.metaDescription)}">\n` +
          `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
          `<style>${PREVIEW_CSS}</style>\n` +
          `<p class="preview">Demo preview -- not a real job posting</p>\n` +
          `<h1>${escapeHtml(content.seoTitle)}</h1>\n<p class="meta"><em>${escapeHtml(content.metaDescription)}</em></p>\n` +
          `<p class="tags">${[...jobTypes, category].map((t) => `<span>${escapeHtml(t)}</span>`).join(' ')}</p>\n${content.descriptionHtml}\n`
      );
      return { id, link };
    },
  };
}

module.exports = { createMockPublisher };
