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
