import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Pins the .transcript-meta-value font-size formula from issue #60: a flat 1.35rem (21.6px) floor
// inverted the intended 0.4 label-to-card ratio (Ansel's 2026-08-04 #52 ruling) at the low end of
// the FONT_SIZE_MIN..FONT_SIZE_MAX (24..144px, view-settings.js) card-size range, reading 0.90 at
// the 24px minimum instead of 0.4. The fix scales the floor itself with --font-size rather than
// keeping it fixed, so this test re-derives the same calc() this file writes into layout.css and
// checks it against the real slider range, not just the two points that were already correct.

const cssPath = fileURLToPath(new URL('../../../public/styles/layout.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

function metaValueFontSize(fontSizePx) {
  // Mirrors: max(calc(16px + (var(--font-size) - 24px) * 17.6 / 60), calc(var(--font-size) * 0.4))
  const scaledFloor = 16 + (fontSizePx - 24) * (17.6 / 60);
  const ratioFloor = fontSizePx * 0.4;
  return Math.max(scaledFloor, ratioFloor);
}

test('.transcript-meta-value uses the scaled-floor formula, not the old flat 1.35rem', () => {
  const rule = css.match(/\.transcript-meta-value\s*{[^}]*}/s);
  assert.ok(rule, 'expected a .transcript-meta-value rule in layout.css');
  const declaration = rule[0].match(/font-size:[^;]*;/)[0];
  assert.ok(!/1\.35rem/.test(declaration), 'the flat 1.35rem floor should be gone (issue #60)');
  assert.match(
    declaration,
    /font-size:\s*max\(\s*calc\(16px \+ \(var\(--font-size\) - 24px\) \* 17\.6 \/ 60\),\s*calc\(var\(--font-size\) \* 0\.4\)\s*\)/,
    'expected the scaled-floor formula from issue #60'
  );
});

test('the scaled floor matches 0.4 exactly at the 84px default and the 144px maximum (no regression)', () => {
  assert.equal(metaValueFontSize(84), 33.6, '84px default: unchanged from Ansel\'s #52 ruling');
  assert.equal(metaValueFontSize(144), 57.6, '144px maximum: unchanged from Ansel\'s #52 ruling');
});

test('the scaled floor tapers the ratio instead of ballooning at the 24px minimum', () => {
  const atMin = metaValueFontSize(24);
  const atMinRatio = atMin / 24;
  assert.equal(atMin, 16, '24px minimum: floor is 16px, a legible absolute minimum');
  assert.ok(atMinRatio < 0.9, `ratio at minimum (${atMinRatio}) must be well below the old 0.90`);
  assert.ok(atMinRatio > 0.4, `ratio at minimum (${atMinRatio}) must still exceed the base 0.4 ratio`);

  const at32 = metaValueFontSize(32);
  assert.ok(at32 / 32 < atMinRatio, 'ratio must taper down as the card grows toward the default');
});

test('the label never shrinks below a legible 16px floor anywhere in the FONT_SIZE_MIN..MAX range', () => {
  for (let fontSizePx = 24; fontSizePx <= 144; fontSizePx += 4) {
    assert.ok(
      metaValueFontSize(fontSizePx) >= 16,
      `label font-size at card size ${fontSizePx}px must be at least 16px`
    );
  }
});
