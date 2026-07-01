export function browserSpeechAvailable() {
  return Boolean(globalThis.window?.SpeechRecognition || globalThis.window?.webkitSpeechRecognition);
}

export function isProviderConfigured(ctx, provider) {
  if (provider === 'openai') {
    return Boolean(ctx.state.providerKeys?.openai?.configured || ctx.state.openAiReady);
  }

  if (provider === 'claude') {
    return Boolean(ctx.state.providerKeys?.claude?.configured || ctx.state.anthropicReady);
  }

  return true;
}

export function isSourceConfigured(ctx, kind, source) {
  if (kind === 'transcription' && source === 'browser') {
    return browserSpeechAvailable();
  }

  return isProviderConfigured(ctx, source);
}
