import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function readHtml() {
  return readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
}

function normalizeSpace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function extractDetailsBlocks(html) {
  return Array.from(html.matchAll(/<details\b[\s\S]*?<\/details>/gi), (match) => match[0]);
}

function extractRegionBlocks(html) {
  return Array.from(
    html.matchAll(
      /<(section|div|aside|fieldset)\b[^>]*role=(?:"region"|'region')[^>]*[\s\S]*?<\/\1>/gi
    ),
    (match) => match[0]
  );
}

function accessibleName(block) {
  const summaryMatch = block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
  if (summaryMatch) {
    return normalizeSpace(summaryMatch[1].replace(/<[^>]+>/g, ''));
  }

  const ariaLabelMatch = block.match(/aria-label=(?:"([^"]+)"|'([^']+)')/i);
  if (ariaLabelMatch) {
    return normalizeSpace(ariaLabelMatch[1] || ariaLabelMatch[2] || '');
  }

  const headingMatch = block.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (headingMatch) {
    return normalizeSpace(headingMatch[1].replace(/<[^>]+>/g, ''));
  }

  return '';
}

function findNamedContainer(html, namePattern) {
  const candidates = [...extractDetailsBlocks(html), ...extractRegionBlocks(html)];
  return candidates.find((block) => namePattern.test(accessibleName(block)));
}

function assertContains(block, selector, description) {
  assert.ok(
    selector.test(block),
    `${description} was not found inside the expected container`
  );
}

function assertNotContains(block, selector, description) {
  assert.ok(
    !selector.test(block),
    `${description} should stay outside the expected container`
  );
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

test('helper panel groups settings and diagnostics into named secondary disclosures', async () => {
  const html = await readHtml();

  assert.match(html, /class=(?:"app-shell"|'app-shell')/);
  assert.match(html, /<main\b[^>]*id=(?:"display"|'display')/);
  assert.match(html, /<aside\b[^>]*id=(?:"panel"|'panel')/);
  assertContains(html, /id=(?:"transcriptViewport"|'transcriptViewport')/, '#transcriptViewport');
  assertContains(html, /id=(?:"transcriptStack"|'transcriptStack')/, '#transcriptStack');
  assertContains(html, /id=(?:"secondaryControls"|'secondaryControls')/, '#secondaryControls');

  const settings = findNamedContainer(html, /settings/i);
  assert.ok(settings, 'Settings disclosure or region is missing');

  const diagnostics = findNamedContainer(html, /diagnostics/i);
  assert.ok(diagnostics, 'Diagnostics disclosure or region is missing');

  assertContains(settings, /data-kind=(?:"transcription"|'transcription')/, 'transcription source control');
  assertContains(settings, /data-kind=(?:"summarization"|'summarization')/, 'summary source control');
  assertNotContains(settings, /id=(?:"summaryInterval"|'summaryInterval')/, 'summary interval slider');
  assertNotContains(settings, /id=(?:"summaryIntervalValue"|'summaryIntervalValue')/, 'summary interval value');

  assert.equal(
    countMatches(html, /data-kind=(?:"transcription"|'transcription')/g),
    countMatches(settings, /data-kind=(?:"transcription"|'transcription')/g),
    'transcription source controls should only live inside Settings'
  );
  assert.equal(
    countMatches(html, /data-kind=(?:"summarization"|'summarization')/g),
    countMatches(settings, /data-kind=(?:"summarization"|'summarization')/g),
    'summary source controls should only live inside Settings'
  );
  assert.equal(countMatches(html, /data-interval=(?:"|')?\d+(?:"|')?/g), 0, 'summary interval buttons should no longer exist');
  assert.equal(countMatches(html, /id=(?:"bigger"|'bigger')/g), 0, 'bigger text button should no longer exist');
  assert.equal(countMatches(html, /id=(?:"smaller"|'smaller')/g), 0, 'smaller text button should no longer exist');

  assertContains(diagnostics, /id=(?:"status"|'status')/, '#status');
  assertContains(diagnostics, /id=(?:"liveTranscript"|'liveTranscript')/, '#liveTranscript');
  assertContains(diagnostics, /id=(?:"pasteTranscript"|'pasteTranscript')/, '#pasteTranscript');
  assertContains(diagnostics, /id=(?:"summarizeOnce"|'summarizeOnce')/, '#summarizeOnce');
  assert.doesNotMatch(diagnostics, /<details\b[^>]*\bopen\b/i, 'Diagnostics should stay collapsed by default');

  assertContains(html, /id=(?:"manualInput"|'manualInput')/, '#manualInput');
  assertContains(html, /id=(?:"addManual"|'addManual')/, '#addManual');
  assertContains(html, /id=(?:"startListening"|'startListening')/, '#startListening');
  assertContains(html, /id=(?:"stopListening"|'stopListening')/, '#stopListening');
  assertContains(html, /id=(?:"pauseAi"|'pauseAi')/, '#pauseAi');
  assertContains(html, /id=(?:"undo"|'undo')/, '#undo');
  assertContains(html, /id=(?:"clear"|'clear')/, '#clear');
  assertContains(html, /id=(?:"fullscreen"|'fullscreen')/, '#fullscreen');
  assertContains(html, /id=(?:"hidePanel"|'hidePanel')/, '#hidePanel');
  assertContains(html, /id=(?:"fontSize"|'fontSize')/, '#fontSize');
  assertContains(html, /id=(?:"displayMargin"|'displayMargin')/, '#displayMargin');
  assertContains(html, /id=(?:"summaryInterval"|'summaryInterval')/, '#summaryInterval');
  assertContains(html, /class=(?:"mode"|'mode')/, '.mode buttons');
  assertContains(html, /data-mode=(?:"speaker"|'speaker')/, 'speaker mode button');
  assertContains(html, /data-mode=(?:"information"|'information')/, 'information mode button');
  assertContains(html, /data-mode=(?:"song"|'song')/, 'song mode button');
  assertContains(html, /data-mode=(?:"prayer"|'prayer')/, 'prayer mode button');
  assertContains(html, /role=(?:"log"|'log')/, 'transcript log region');
  assertContains(html, /aria-live=(?:"polite"|'polite')/, 'transcript live region');

  const primarySelectors = [
    [/id=(?:"manualInput"|'manualInput')/, '#manualInput'],
    [/id=(?:"addManual"|'addManual')/, '#addManual'],
    [/id=(?:"startListening"|'startListening')/, '#startListening'],
    [/id=(?:"stopListening"|'stopListening')/, '#stopListening'],
    [/id=(?:"pauseAi"|'pauseAi')/, '#pauseAi'],
    [/id=(?:"undo"|'undo')/, '#undo'],
    [/id=(?:"clear"|'clear')/, '#clear'],
    [/id=(?:"fullscreen"|'fullscreen')/, '#fullscreen'],
    [/id=(?:"hidePanel"|'hidePanel')/, '#hidePanel'],
    [/id=(?:"fontSize"|'fontSize')/, '#fontSize'],
    [/id=(?:"displayMargin"|'displayMargin')/, '#displayMargin'],
    [/id=(?:"summaryInterval"|'summaryInterval')/, '#summaryInterval'],
    [/class=(?:"mode"|'mode')/, '.mode buttons']
  ];

  for (const [selector, description] of primarySelectors) {
    assertNotContains(settings, selector, description);
    assertNotContains(diagnostics, selector, description);
  }
});
