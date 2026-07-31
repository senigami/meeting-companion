import {
  getDefaultSummarizationSource,
  getDefaultTranscriptionSource,
  listAvailableSummarizationSources,
  listAvailableTranscriptionSources
} from './catalog.js';
import { createBrowserTranscriptionDriver } from './transcription/browser.js';
import { createOpenAITranscriptionDriver } from './transcription/openai.js';
import { createDemoTranscriptionDriver } from './transcription/demo.js';
import { createReplayTranscriptionDriver } from './transcription/replay.js';
import { createOpenAISummarizer } from './summarization/openai.js';
import { createClaudeSummarizer } from './summarization/claude.js';
import { createDemoSummarizer } from './summarization/demo.js';

export function createTranscriptionDriver(source, deps = {}) {
  // TEMPORARY DEBUG -- branch debug/browser-transcription, do not merge.
  const resolved = source || getDefaultTranscriptionSource();
  if (typeof window !== 'undefined' && window.__btDebug) {
    window.__btDebug('registry: building transcription driver', { requested: source, resolved });
  }
  switch (resolved) {
    case 'browser':
      return createBrowserTranscriptionDriver(deps);
    case 'openai':
      return createOpenAITranscriptionDriver(deps);
    case 'demo':
      return createDemoTranscriptionDriver(deps);
    case 'replay':
      return createReplayTranscriptionDriver(deps);
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
    case 'demo':
      return createDemoSummarizer(deps);
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
