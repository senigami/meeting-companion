export function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function toLowerKey(text) {
  return normalizeText(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function appendUniqueText(list, text) {
  const clean = normalizeText(text);
  if (!clean) return list;
  if (toLowerKey(list[list.length - 1] || '') === toLowerKey(clean)) return list;
  return [...list, clean];
}

export function appendUniqueChunk(chunks, text, at = Date.now()) {
  const clean = normalizeText(text);
  if (!clean) return chunks;
  const last = chunks[chunks.length - 1];
  if (toLowerKey(last?.text || '') === toLowerKey(clean)) return chunks;
  return [...chunks, { text: clean, at }];
}
