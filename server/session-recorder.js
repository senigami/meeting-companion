import { mkdir, appendFile, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// Debugging/tuning instrument (ADR-0004, backlog items 2-3): appends both sides of the pipeline --
// incoming transcription chunks and outgoing summarize calls -- to one newline-delimited JSON file
// per session, so a real meeting can be replayed against prompt changes and summary quality measured
// instead of guessed at. This is a superseding, explicit exception to ADR-0003 (no transcript
// persistence by default); it must stay confined to `recordings/` (gitignored, see .gitignore) and
// must never be reachable over the network except via this process's own localhost-only endpoint.
//
// Every method here degrades to a returned { ok: false, error } on any failure -- a full disk, a
// missing directory, a bad path -- and NEVER throws. The caller (server.js's /api/recording/append
// route) is on the same request path as nothing in the live transcription/summarize loop; a
// recording failure must never be able to reach into that loop, which is the whole reason this is a
// side endpoint the client fires-and-forgets rather than something awaited inline in summarizeCurrentText.

// Session ids are client-generated (a timestamp) and used directly in a filename, so this pattern is
// the one thing standing between an operator-tunable id and path traversal (`../`, absolute paths,
// null bytes). Deliberately narrow: digits, letters, dash, underscore only.
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,120}$/;

const DEFAULT_RECORDINGS_DIR = path.resolve('recordings');

export function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && SAFE_SESSION_ID.test(sessionId);
}

// Read-side companion to appendRecords, same defensive spirit: a missing directory or an unreadable
// file is a normal condition (recording never started, or was cleaned up), never something to throw
// at the caller (server.js's /api/recording/list and /api/recording/:id routes).
export async function listRecordings(dir = DEFAULT_RECORDINGS_DIR) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const recordings = [];
  for (const entry of entries) {
    if (!entry.endsWith('.ndjson')) continue;
    const id = entry.slice(0, -'.ndjson'.length);
    if (!isValidSessionId(id)) continue;
    try {
      const info = await stat(path.join(dir, entry));
      recordings.push({ id, bytes: info.size, modifiedAt: info.mtime.toISOString() });
    } catch {
      // File vanished between readdir and stat -- skip it rather than error.
    }
  }

  recordings.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));
  return recordings;
}

// Same traversal discipline as appendRecords: an id that fails SAFE_SESSION_ID never reaches the
// filesystem, so a caller-supplied id can never escape `dir`.
export async function readRecording(id, dir = DEFAULT_RECORDINGS_DIR) {
  if (!isValidSessionId(id)) return null;
  try {
    return await readFile(path.join(dir, `${id}.ndjson`), 'utf8');
  } catch {
    return null;
  }
}

export function createSessionRecorder({ dir = DEFAULT_RECORDINGS_DIR } = {}) {
  const ensuredDirs = new Set();

  async function ensureDir() {
    if (ensuredDirs.has(dir)) return;
    await mkdir(dir, { recursive: true });
    ensuredDirs.add(dir);
  }

  // records: array of plain objects, already shaped by the caller (chunk or summary records). Each
  // is JSON.stringify'd onto its own line and the whole batch appended in one fs write, so a batch of
  // N chunks from one summarize tick costs one disk write, not N.
  async function appendRecords(sessionId, records) {
    if (!isValidSessionId(sessionId)) {
      return { ok: false, error: 'invalid session id' };
    }
    if (!Array.isArray(records) || records.length === 0) {
      return { ok: true, written: 0 };
    }

    try {
      await ensureDir();
      const lines = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
      await appendFile(path.join(dir, `${sessionId}.ndjson`), lines, 'utf8');
      return { ok: true, written: records.length };
    } catch (error) {
      // Never include the records themselves (transcript/summary content) in the error -- only a
      // short, safe message, same discipline as server.js's safeErrorDetail for provider errors.
      return { ok: false, error: String(error?.code || error?.message || 'write failed').slice(0, 200) };
    }
  }

  return {
    appendRecords,
    listRecordings: () => listRecordings(dir),
    readRecording: (id) => readRecording(id, dir)
  };
}
