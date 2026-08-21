// Cleans the raw text a contenteditable transcript-card node hands back after an operator edit
// (#125). contenteditable can hand back more than the characters someone typed: a pasted or
// Enter-inserted block boundary (a <div>/<br> the browser inserted under the hood) surfaces in
// `.textContent`/`innerText` as a bare newline between what were two separate blocks, and some
// input methods leave zero-width characters (U+200B zero-width space, U+FEFF BOM) sitting in the
// text. Neither belongs in a transcript card, so both are stripped before the result is handed to
// runtime.js#updateItemText, which writes it verbatim with no sanitizing of its own.
const ZERO_WIDTH_CHARS = /[​‌‍﻿]/g;

export function sanitizeEditedText(rawText) {
  return String(rawText || '')
    .replace(ZERO_WIDTH_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
}
