import { normalizeText } from './text.js';

export async function readResponseJson(response) {
  if (!response) return {};

  if (typeof response.text === 'function') {
    const text = await response.text();
    if (!normalizeText(text)) return {};

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  if (typeof response.json === 'function') {
    return response.json();
  }

  return {};
}

export function responseErrorMessage(data, fallback = 'Request failed.') {
  return normalizeText(data?.error || data?.raw || '') || fallback;
}
