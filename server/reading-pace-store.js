import { mkdir, writeFile, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// First slice of #44 (named reader profiles): the reading-pace measurement is a one-time, in-person
// reading of a real person's speed, and the whole display is calibrated against that one number.
// localStorage loses it on a cleared browser and can't move between machines, so this stores each
// named result to disk instead. Same defensive spirit as server/session-recorder.js: a `SAFE_*`
// pattern stands between an operator-supplied name and path traversal, and every method degrades to
// a returned result rather than throwing at the caller (server.js's /api/reading-pace routes).

// Reader names are typed by the operator on the done screen, not client-generated, but the same
// discipline applies: digits, letters, dash, underscore only, never built into a path unvalidated.
const SAFE_NAME = /^[A-Za-z0-9_-]{1,120}$/;

const DEFAULT_READING_PACE_DIR = path.resolve('reader-profiles');

export function isValidReaderName(name) {
  return typeof name === 'string' && SAFE_NAME.test(name);
}

// Read-side companion to save, same defensive spirit as session-recorder's listRecordings: a
// missing directory is a normal condition (no profiles saved yet), never something to throw at the
// caller (server.js's /api/reading-pace/list route).
export async function listReadingPaceProfiles(dir = DEFAULT_READING_PACE_DIR) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const profiles = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const name = entry.slice(0, -'.json'.length);
    if (!isValidReaderName(name)) continue;
    try {
      const contents = await readFile(path.join(dir, entry), 'utf8');
      const parsed = JSON.parse(contents);
      profiles.push({ name, recordedAt: parsed?.recordedAt || null });
    } catch {
      // Unreadable or corrupt file -- skip it rather than error.
    }
  }

  profiles.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
  return profiles;
}

// Same traversal discipline as readRecording: a name that fails SAFE_NAME never reaches the
// filesystem, so a caller-supplied name can never escape `dir`.
export async function readReadingPaceProfile(name, dir = DEFAULT_READING_PACE_DIR) {
  if (!isValidReaderName(name)) return null;
  try {
    const contents = await readFile(path.join(dir, `${name}.json`), 'utf8');
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

export function createReadingPaceStore({ dir = DEFAULT_READING_PACE_DIR } = {}) {
  const ensuredDirs = new Set();

  async function ensureDir() {
    if (ensuredDirs.has(dir)) return;
    await mkdir(dir, { recursive: true });
    ensuredDirs.add(dir);
  }

  // payload: the already-shaped reading-pace result (recordedAt, fontSizePx, cards), same shape the
  // client currently writes to localStorage. Written as one whole file per name -- a re-measurement
  // under the same name overwrites, which is the intended behavior for a named reader profile.
  async function save(name, payload) {
    if (!isValidReaderName(name)) {
      return { ok: false, error: 'invalid name' };
    }

    try {
      await ensureDir();
      await writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload), 'utf8');
      return { ok: true };
    } catch (error) {
      // Never include the payload (the measured reading data) in the error -- only a short, safe
      // message, same discipline as server.js's safeErrorDetail for provider errors.
      return { ok: false, error: String(error?.code || error?.message || 'write failed').slice(0, 200) };
    }
  }

  return {
    save,
    list: () => listReadingPaceProfiles(dir),
    read: (name) => readReadingPaceProfile(name, dir)
  };
}
