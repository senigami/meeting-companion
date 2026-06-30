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
    }
  ];
}

export function getDefaultTranscriptionSource() {
  return 'browser';
}

export function getDefaultSummarizationSource() {
  return 'openai';
}
