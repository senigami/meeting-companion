// The commit a recording was made under (issue #4). Shared by server.js (which puts it in
// /api/config, the browser's only way to learn it) and scripts/replay-recording.js (which compares
// a recording's header against the checkout you are replaying in) so the two can never drift into
// answering the question differently.
//
// The `-dirty` suffix is the point, not decoration. ADR-0004 keeps a recording only until it has
// been used for tuning, and this header exists so a file that outlives its prompt can be recognised
// as stale by READING it. A bare hash recorded off a tree with uncommitted edits claims a
// provenance it does not have: the code that produced the recording is not the code at that commit,
// and a replay would compare equal and report "matches" when nothing of the sort is true.
//
// 'unknown' on any failure, never a guess or an empty string: a tarball with no .git, or git not on
// PATH, are ordinary conditions, and replay has to be able to tell "we don't know" from "it
// matched". The timeout is belt-and-braces -- `git rev-parse` cannot prompt, but a resolver that
// runs at module load must not be able to hold the process open.

import { execFileSync } from 'node:child_process';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore']
  });
}

export function resolveAppCommit(cwd) {
  try {
    const head = git(['rev-parse', 'HEAD'], cwd).trim();
    if (!head) return 'unknown';
    const dirty = git(['status', '--porcelain'], cwd).trim();
    return dirty ? `${head}-dirty` : head;
  } catch {
    return 'unknown';
  }
}
