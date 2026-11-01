'use strict';

// Real LLM adapter (Groq, OpenAI-compatible chat completions). Only used when
// AI_PROVIDER=groq and GROQ_API_KEY are set. It never publishes anything; it
// only returns text, so it is allowed in demo mode.

const { screeningPrompt, contentPrompt, asJobPosting } = require('./prompts');

class RateLimitError extends Error {}

function createGroqProvider(config) {
  async function chat({ system, user, maxTokens, reasoning = 'low' }) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.groqApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.groqModel,
        reasoning_effort: reasoning,
        // Reasoning tokens count against max_tokens too; small budgets cut
        // answers off mid-JSON.
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 429 || /rate.?limit/i.test(`${body?.error?.code} ${body?.error?.message}`)) {
      throw new RateLimitError('LLM rate limit reached');
    }
    if (!res.ok || body.error) throw new Error(`LLM error: ${body?.error?.message || res.status}`);
    const text = (body?.choices?.[0]?.message?.content || '').replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(text);
  }

  return {
    name: `groq:${config.groqModel}`,

    async screenJob(job, descriptionForScreening) {
      return chat({
        system: screeningPrompt(config),
        user: asJobPosting(`Title: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\nDescription: ${descriptionForScreening}`),
        maxTokens: 700,
      });
    },

    async writeJobContent(job) {
      return chat({
        system: contentPrompt(config),
        user: asJobPosting(`Title: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\nApply link: ${job.url}\n\nSource text:\n${(job.description || '').slice(0, 3000)}`),
        maxTokens: 4000,
        reasoning: 'medium',
      });
    },
  };
}

module.exports = { createGroqProvider, RateLimitError };
