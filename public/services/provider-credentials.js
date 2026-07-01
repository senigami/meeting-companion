const STORAGE_KEY = 'providerApiKeys';

export function readProviderKeys(storage = globalThis.localStorage) {
  const raw = readJson(storage, STORAGE_KEY, {});
  return sanitizeProviderKeys(raw);
}

export function getProviderKey(storage = globalThis.localStorage, provider) {
  return readProviderKeys(storage)[provider] || '';
}

export function saveProviderKey(storage = globalThis.localStorage, provider, value) {
  const next = readProviderKeys(storage);
  const clean = normalizeKey(value);
  if (!provider) return next;
  if (!clean) {
    delete next[provider];
  } else {
    next[provider] = clean;
  }
  writeJson(storage, STORAGE_KEY, next);
  return next;
}

export function deleteProviderKey(storage = globalThis.localStorage, provider) {
  const next = readProviderKeys(storage);
  if (provider && provider in next) {
    delete next[provider];
    writeJson(storage, STORAGE_KEY, next);
  }
  return next;
}

export function maskProviderKey(value) {
  const clean = normalizeKey(value);
  if (!clean) return '';
  if (clean.length <= 8) return '••••••••';
  const head = clean.slice(0, 3);
  const tail = clean.slice(-4);
  return `${head}••••••••••••${tail}`;
}

export function getProviderKeyState({ serverReady = false, localKey = '' } = {}) {
  const clean = normalizeKey(localKey);
  if (clean) {
    return {
      configured: true,
      origin: 'local',
      label: 'Configured locally',
      masked: maskProviderKey(clean)
    };
  }

  if (serverReady) {
    return {
      configured: true,
      origin: 'server',
      label: 'Configured on server',
      masked: ''
    };
  }

  return {
    configured: false,
    origin: 'missing',
    label: 'Needs key',
    masked: ''
  };
}

function normalizeKey(value) {
  return String(value || '').trim();
}

function sanitizeProviderKeys(value) {
  const record = value && typeof value === 'object' ? value : {};
  const result = {};

  for (const [provider, rawValue] of Object.entries(record)) {
    const clean = normalizeKey(rawValue);
    if (clean) {
      result[provider] = clean;
    }
  }

  return result;
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  storage?.setItem?.(key, JSON.stringify(value));
}
