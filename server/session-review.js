// HTML renderer for the debugging/tuning recorder's ndjson files (ADR-0004), so a past session can
// be audited by eye -- summary next to the raw text it was built from, timestamp alongside both --
// without hand-parsing a file first. Companion to scripts/replay-recording.js (same pairing logic,
// terminal output); this is the browser-facing version, served from server.js's /sessions routes.
//
// Deliberately dependency-free: no template engine, just escaped template literals, matching how
// the rest of this repo has no server-side HTML rendering to imitate and the client is plain
// static HTML/JS (public/services never build markup from strings either -- this is the first).

import { parseRecordingLines } from '../scripts/lib/recording-summary.js';

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
  td.timestamp { white-space: nowrap; font-family: monospace; font-size: 0.85em; color: #555; }
  td.failed { background: #fdecea; }
  td.mode { white-space: nowrap; font-size: 0.85em; color: #555; text-transform: capitalize; }
  tr.mode-change td { border-top: 3px solid #333; }
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
export function buildSessionReviewHtml(id, ndjsonText) {
  const { records, unparseable } = parseRecordingLines(ndjsonText);
  const header = records.find((record) => record.t === 'header') || null;
  const summaries = records.filter((record) => record.t === 'summary');

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

  const rows = summaries.length
    ? summaries
        .map((summary, index) => {
          const failedClass = summary.ok ? ' ' : ' class="failed" ';
          // A row gets the mode-change break only when its mode actually differs from the row
          // right above it -- back-to-back speaker (or info, or prayer) rows stay flush together,
          // since the break is meant to mark a change of kind, not just a change of card.
          const modeChanged = index === 0 || summary.mode !== summaries[index - 1].mode;
          const rowClass = `${failedClass}${modeChanged ? 'mode-change' : ''}`.trim();
          const trAttr = rowClass ? ` class="${rowClass}"` : '';
          const errorLine = summary.ok ? '' : `<br><em>FAILED: ${escapeHtml(summary.error || 'unknown error')}</em>`;
          return `<tr${trAttr}>
  <td class="row-num">${index + 1}</td>
  <td class="timestamp">${escapeHtml(summary.at)}</td>
  <td class="mode">${escapeHtml(summary.mode || '')}</td>
  <td>${escapeHtml(summary.returned || '')}${errorLine}</td>
  <td>${escapeHtml(summary.sent || '')}</td>
</tr>`;
        })
        .join('\n')
    : '<tr><td colspan="5">No summary records in this session.</td></tr>';

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Session review: ${escapeHtml(id)}</title><style>${PAGE_STYLE}</style></head>
<body>
<h1>Session review: ${escapeHtml(id)}</h1>
<p><a href="/sessions">&larr; all sessions</a></p>
${noteRows.join('\n')}
<table>
<thead><tr><th>#</th><th>Timestamp</th><th>Type</th><th>Summary returned</th><th>Raw text sent</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;
}
