import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The reader cannot hear the room, so the wall is the only thing he has, and the app's entire
// security boundary is the browser origin -- no auth, one operator, everything reachable from a page
// that gets same-origin with it. Script executing in that origin owns the provider key and every
// transcript.
//
// One `innerHTML` with an interpolated value was enough. `public/reading-pace.js` built its results
// table that way from `card.text`, which arrives from GET /api/reading-pace/<name>, whose stored
// payload nothing validates -- the route checks the profile NAME and takes the body as given.
//
// Fixing the instance was one line. This fixes the class, at the moment someone types it, rather
// than in whatever review happens to look. Assignments of a literal empty string are the legitimate
// "empty this <select>" idiom and stay allowed; nothing else does.
const ASSIGNS_TO_HTML = /\.(innerHTML|outerHTML)\s*=(?!=)\s*(.*)$/;
const EMPTY_LITERAL = /^(''|""|``)\s*;?\s*(\/\/.*)?$/;
const INSERT_ADJACENT_HTML = /\.insertAdjacentHTML\s*\(/;
const DOCUMENT_WRITE = /\bdocument\s*\.\s*write(ln)?\s*\(/;

const REPO_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCANNED_DIRS = ['public', 'server', 'packages', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'coverage']);

function walk(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, found);
      continue;
    }
    if (/\.[cm]?js$/.test(entry)) found.push(full);
  }
  return found;
}

function findSinks() {
  const offenders = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of walk(path.join(REPO_DIR, dir))) {
      const relative = path.relative(REPO_DIR, file);
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        const at = `${relative}:${index + 1}`;
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        const assignment = trimmed.match(ASSIGNS_TO_HTML);
        if (assignment && !EMPTY_LITERAL.test(assignment[2].trim())) {
          offenders.push(`${at}  ${trimmed}`);
        }
        if (INSERT_ADJACENT_HTML.test(trimmed) || DOCUMENT_WRITE.test(trimmed)) {
          offenders.push(`${at}  ${trimmed}`);
        }
      });
    }
  }
  return offenders;
}

test('no shipped script writes markup into the DOM from a value', () => {
  const offenders = findSinks();

  assert.deepEqual(
    offenders,
    [],
    `Build the node and set textContent instead.\n${offenders.join('\n')}`
  );
});

// A guard that cannot fail is worse than no guard, because it reads as coverage. This proves the
// scanner recognises the exact shape that shipped, rather than merely that today's tree is clean.
test('the guard recognises the line that actually shipped, and still permits the empty-select idiom', () => {
  const shipped = "      row.innerHTML = `<td>${cardIndex + 1}. ${card.text}</td>`;";
  const legitimate = "    select.innerHTML = '';";

  const match = shipped.trim().match(ASSIGNS_TO_HTML);
  assert.ok(match, 'the scanner must see an innerHTML assignment here');
  assert.equal(EMPTY_LITERAL.test(match[2].trim()), false, 'and must not excuse it as the empty-select idiom');

  const allowed = legitimate.trim().match(ASSIGNS_TO_HTML);
  assert.ok(allowed, 'the empty-select idiom is still an innerHTML assignment');
  assert.equal(EMPTY_LITERAL.test(allowed[2].trim()), true, 'but is permitted');
});
