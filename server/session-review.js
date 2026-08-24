// HTML renderer for the debugging/tuning recorder's ndjson files (ADR-0004), so a past session can
// be audited by eye -- summary next to the raw text it was built from, timestamp alongside both --
// without hand-parsing a file first. Companion to scripts/replay-recording.js (same pairing logic,
// terminal output); this is the browser-facing version, served from server.js's /sessions routes.
//
// Deliberately dependency-free: no template engine, just escaped template literals, matching how
// the rest of this repo has no server-side HTML rendering to imitate and the client is plain
// static HTML/JS (public/services never build markup from strings either -- this is the first).

import { parseRecordingLines } from '../scripts/lib/recording-summary.js';

// Recorded timestamps are UTC ("at" always ends in Z); the room they describe is not. Hardcoded to
// this repo's own meeting timezone (every commit in this repo's own history is -04:00/-05:00, i.e.
// America/New_York) rather than the server's ambient TZ, so the rendered time is deterministic
// regardless of where this runs, and actually matches the wall clock in the room the report is
// about -- a recipient reading "16:24" for a meeting that happened at noon would be genuinely
// misled, not just inconvenienced.
const DISPLAY_TIME_ZONE = 'America/New_York';
// hour12 still picks the 12-hour clock (so noon reads "12:xx", not "0:xx" or "24:00"), but the
// dayPeriod part (AM/PM) is dropped below -- Steve's call: nobody reading a report about an actual
// room event mistakes what it's showing for midnight.
const DISPLAY_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true
});

export function formatDisplayTime(isoTimestamp) {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return String(isoTimestamp);
  return DISPLAY_TIME_FORMATTER.formatToParts(date)
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PAGE_STYLE = `
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 0.5rem; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; }
  td.meta { white-space: nowrap; width: 1%; }
  td.meta .row-num { font-weight: 700; }
  td.meta .mode-time { margin-top: 0.15rem; font-size: 0.78em; color: #555; }
  td.meta .mode-badge { text-transform: uppercase; letter-spacing: 0.03em; }
  td.meta .timestamp { font-family: monospace; }
  tr.failed td { background: #fdecea; }
  tr.mode-change td { border-top: 3px solid #333; }
  tr.corrected td { color: #888; text-decoration: line-through; }
  tr.corrected td.meta { text-decoration: none; }
  ul.recording-list { list-style: none; padding: 0; }
  ul.recording-list li { margin: 0.25rem 0; }
`;

// Lists recordings found on disk (server.js's sessionRecorder.listRecordings), one link per session
// into /sessions/:id/review. Same loopback gating as the JSON /api/recording/list this reuses.
export function buildSessionListHtml(recordings = []) {
  const items = recordings.length
    ? recordings
        .map((recording) => {
          const id = escapeHtml(recording.id);
          const kb = (recording.bytes / 1024).toFixed(1);
          return `<li><a href="/sessions/${encodeURIComponent(recording.id)}/review">${id}</a> <span class="timestamp">(${escapeHtml(recording.modifiedAt)}, ${kb} KB)</span></li>`;
        })
        .join('\n')
    : '<li>No recorded sessions found.</li>';

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Recorded sessions</title><style>${PAGE_STYLE}</style></head>
<body>
<h1>Recorded sessions</h1>
<ul class="recording-list">
${items}
</ul>
</body>
</html>`;
}

// Pairs each summary record with the raw text it was built from (summary.sent -- the exact text
// sent to the provider, not the individual chunks, since that is what the summarizer actually saw)
// and renders one row per pair, in file order (already chronological -- ADR-0004 records are
// appended as they happen).
export function buildSessionReviewHtml(id, ndjsonText, { showCorrections = false } = {}) {
  const { records, unparseable } = parseRecordingLines(ndjsonText);
  const header = records.find((record) => record.t === 'header') || null;
  const summaries = records.filter((record) => record.t === 'summary');
  const corrections = records.filter((record) => record.t === 'correction');

  // A correction is additive (buildCorrectionRecord's own comment explains why): the summary it
  // targets is never removed from the file, only from what renders here by default. `targetAt` is
  // the corrected summary's own `at`, the same idiom consumedIds already uses to point at a chunk
  // without a second id scheme -- and the reason it survives a re-numbering that a row position
  // would not.
  const correctedAts = new Set(corrections.map((c) => c.targetAt).filter(Boolean));
  const visibleSummaries = showCorrections ? summaries : summaries.filter((s) => !correctedAts.has(s.at));

  const noteRows = [];
  if (!header) {
    noteRows.push('<p>No header record (recorded before this field existed) -- commit/prompt/settings unknown.</p>');
  } else {
    noteRows.push(
      `<p>header: commit=${escapeHtml(header.appCommit)} promptHash=${escapeHtml(header.promptHash)} maxWords=${escapeHtml(header.maxWords)} provider=${escapeHtml(header.provider)} intervalSeconds=${escapeHtml(header.intervalSeconds)}</p>`
    );
  }
  if (unparseable > 0) {
    noteRows.push(`<p>NOTE: ${unparseable} line(s) could not be parsed and are not shown below.</p>`);
  }
  if (corrections.length > 0) {
    const toggleHref = showCorrections ? `/sessions/${encodeURIComponent(id)}/review` : `/sessions/${encodeURIComponent(id)}/review?corrections=1`;
    const toggleLabel = showCorrections ? 'hide them again' : 'show what was removed and why';
    noteRows.push(
      `<p>${corrections.length} correction(s) applied -- entries removed from the default view below, not from the recording. <a href="${toggleHref}">${toggleLabel}</a>.</p>`
    );
  }

  function buildRow(summary, index, { corrected = false } = {}) {
    const failedClass = summary.ok ? '' : ' failed';
    const correctedClass = corrected ? ' corrected' : '';
    // A row gets the mode-change break only when its mode actually differs from the row right
    // above it in the SAME visible set -- a row hidden by default must not leave a phantom break
    // in the sequence a reader actually sees.
    const modeChanged = index === 0 || summary.mode !== visibleSummaries[index - 1]?.mode;
    const rowClass = `${failedClass}${modeChanged && !corrected ? ' mode-change' : ''}${correctedClass}`.trim();
    const trAttr = rowClass ? ` class="${rowClass}"` : '';
    const errorLine = summary.ok ? '' : `<br><em>FAILED: ${escapeHtml(summary.error || 'unknown error')}</em>`;
    // #, type, and time share one narrow column -- what a reader actually scans this table for is
    // the summary and the raw text beside it, not any of these three, so they're stacked out of
    // the way rather than each claiming a full-width column of their own.
    return `<tr${trAttr}>
  <td class="meta">
    <div class="row-num">${index + 1}</div>
    <div class="mode-time"><span class="mode-badge">${escapeHtml(summary.mode || '')}</span> <span class="timestamp" title="${escapeHtml(summary.at)}">${escapeHtml(formatDisplayTime(summary.at))}</span></div>
  </td>
  <td>${escapeHtml(summary.returned || '')}${errorLine}</td>
  <td>${escapeHtml(summary.sent || '')}</td>
</tr>`;
  }

  const rows = visibleSummaries.length
    ? visibleSummaries
        .map((summary, index) => buildRow(summary, index, { corrected: showCorrections && correctedAts.has(summary.at) }))
        .join('\n')
    : '<tr><td colspan="3">No summary records in this session.</td></tr>';

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Session review: ${escapeHtml(id)}</title><style>${PAGE_STYLE}</style></head>
<body>
<h1>Session review: ${escapeHtml(id)}</h1>
<p><a href="/sessions">&larr; all sessions</a></p>
${noteRows.join('\n')}
<table>
<thead><tr><th>#/Type/Time</th><th>Summary displayed</th><th>Raw text sent</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;
}
