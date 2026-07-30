export function listAvailableTranscriptionSources() {
  return [
    {
      id: 'browser',
      label: 'Browser',
      description: 'Use the browser speech engine on the laptop.'
    },
    {
      id: 'openai',
      label: 'OpenAI',
      description: 'Send short audio chunks to the server for OpenAI transcription.'
    },
    {
      id: 'demo',
      // Depends on nothing -- no microphone, no key, no network -- so it is the one source that can
      // always be selected. Exists to exercise the whole transcript -> summarize -> display path.
      label: 'Demo',
      description: 'Replay a sample meeting. No microphone or API key needed.'
    },
    {
      id: 'replay',
      // A recorded session (ADR-0004), not a live source -- label and description must both read
      // as clearly-not-live so an operator never mistakes it for the microphone.
      label: 'Replay',
      description: 'Replay a recorded session through the live pipeline. Not live audio -- for testing and debugging only.'
    }
  ];
}

export function listAvailableSummarizationSources() {
  return [
    {
      id: 'openai',
      label: 'OpenAI',
      description: 'Summarize text on the server with OpenAI.'
    },
    {
      id: 'claude',
      label: 'Claude',
      description: 'Summarize text on the server with Claude.'
    },
    {
      id: 'demo',
      label: 'Demo',
      // Selects and trims a real recent sentence locally -- it does not summarize, and it never
      // invents words nobody said. Pairs with the demo transcription source so the whole
      // transcript -> display path can be rehearsed with no key.
      description: 'Show trimmed lines from what was actually said. No API key needed.'
    }
  ];
}

export function getDefaultTranscriptionSource() {
  return 'browser';
}

export function getDefaultSummarizationSource() {
  return 'openai';
}
