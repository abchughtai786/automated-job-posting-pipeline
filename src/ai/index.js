'use strict';

const { createGroqProvider } = require('./groq');
const { createMockProvider } = require('./mock');

function createAiProvider(config) {
  return config.aiProvider === 'groq' ? createGroqProvider(config) : createMockProvider(config);
}

module.exports = { createAiProvider };
