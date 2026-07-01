export async function fetchWithTimeout(fetchImpl, url, options = {}, {
  timeoutMs = 12000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  let timedOut = false;
  const timer = setTimeoutFn(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error('Request timed out');
    throw error;
  } finally {
    clearTimeoutFn(timer);
  }
}
