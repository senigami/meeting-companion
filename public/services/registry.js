import {
  getDefaultSummarizationSource,
  getDefaultTranscriptionSource,
  listAvailableSummarizationSources,
  listAvailableTranscriptionSources
} from './catalog.js';
import { createBrowserTranscriptionDriver } from './transcription/browser.js';
import { createOpenAITranscriptionDriver } from './transcription/openai.js';
import { createOpenAISummarizer } from './summarization/openai.js';
import { createClaudeSummarizer } from './summarization/claude.js';

export function createTranscriptionDriver(source, deps = {}) {
  switch (source || getDefaultTranscriptionSource()) {
    case 'browser':
      return createBrowserTranscriptionDriver(deps);
    case 'openai':
      return createOpenAITranscriptionDriver(deps);
    default:
      throw new Error(`Unsupported transcription source: ${source}`);
  }
}

export function createSummarizationDriver(source, deps = {}) {
  switch (source || getDefaultSummarizationSource()) {
    case 'openai':
      return createOpenAISummarizer(deps);
    case 'claude':
      return createClaudeSummarizer(deps);
    default:
      throw new Error(`Unsupported summarization source: ${source}`);
  }
}

export function listAvailableSources() {
  return {
    transcription: listAvailableTranscriptionSources(),
    summarization: listAvailableSummarizationSources()
  };
}
