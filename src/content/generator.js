'use strict';

// Builds the published page content. The LLM rewrites the description into
// fixed sections plus SEO fields; if the model fails or returns something
// unusable, a plain reformat of the source text is used instead, so a job is
// never published empty.

const { escapeHtml, safeLinkUrl, sanitizeHtml, plainText } = require('../parsing/sanitize');
const { splitLocation } = require('../taxonomy');

// Plain-text descriptions become paragraphs; short "Heading:" lines become
// <h3> and bullet lines become lists, so sections are machine-readable.
function toPostContent(job) {
  if (/<[a-z][^<>]*>/i.test(job.description || '')) return sanitizeHtml(job.description) + applyLinkParagraph(job.url);
  const blocks = (job.description || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const html = blocks.map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (/^[A-Z][A-Za-z &/]{2,40}:$/.test(lines[0])) {
      const heading = escapeHtml(lines[0].replace(/:$/, ''));
      const rest = lines.slice(1);
      if (rest.length === 0) return `<h3>${heading}</h3>`;
      if (rest.every((l) => /^[-*•]\s+/.test(l))) {
        return `<h3>${heading}</h3><ul>${rest.map((l) => `<li>${escapeHtml(l.replace(/^[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<h3>${heading}</h3><p>${rest.map(escapeHtml).join('<br>')}</p>`;
    }
    return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
  });
  const body = html.length ? html.join('\n') : "<p>See the employer's posting for full details.</p>";
  return body + applyLinkParagraph(job.url);
}

function applyLinkParagraph(url) {
  const href = safeLinkUrl(url);
  // Links come from third-party listings: no ranking credit, no opener access.
  return href ? `\n<p><strong>Apply:</strong> <a href="${escapeHtml(href)}" rel="nofollow ugc noopener">${escapeHtml(href)}</a></p>` : '';
}

async function generateJobContent(job, { ai, country }) {
  const { city, country: jobCountry } = splitLocation(job.location);
  const fallback = {
    seoTitle: `${job.company} Hiring: ${job.title}`,
    metaDescription: `${job.company} is hiring for ${job.title} in ${city}, ${jobCountry || country}.`,
    focusKeyphrase: job.title,
    relatedKeyphrases: [],
    deadline: null,
    descriptionHtml: toPostContent(job),
    usedFallback: true,
    writtenBy: 'fallback formatter',
  };
  try {
    const out = await ai.writeJobContent(job);
    // A real title has several words; a malformed reply can be a single
    // word such as "Management", which must never become a page title.
    if (typeof out?.seoTitle !== 'string' || typeof out.descriptionHtml !== 'string' || out.seoTitle.length < 20 || out.seoTitle.split(/\s+/).length < 4 || !out.descriptionHtml) return fallback;
    return {
      seoTitle: plainText(out.seoTitle),
      metaDescription: plainText(out.metaDescription) || fallback.metaDescription,
      focusKeyphrase: plainText(out.focusKeyphrase) || fallback.focusKeyphrase,
      relatedKeyphrases: Array.isArray(out.relatedKeyphrases) ? out.relatedKeyphrases.map(plainText).filter(Boolean) : [],
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(out.deadline || '') ? out.deadline : null,
      descriptionHtml: sanitizeHtml(out.descriptionHtml) + applyLinkParagraph(job.url),
      usedFallback: false,
      writtenBy: ai.name || 'AI provider',
    };
  } catch {
    return fallback;
  }
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
}

module.exports = { generateJobContent, toPostContent, slugify };
