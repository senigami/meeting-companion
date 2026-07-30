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

  // Unlike every other non-browser/openai/claude source, replay needs something real to point
  // at: with zero recordings on disk there is nothing to select, so it must not show as
  // unconditionally available the way the fallback below treats an unrecognised source.
  if (kind === 'transcription' && source === 'replay') {
    return Boolean(ctx.state.availableRecordings?.length);
  }

  return isProviderConfigured(ctx, source);
}
