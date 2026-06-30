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
      /<(section|div|aside|fieldset)\b[^>]*role=(?:"region"|'region'|"dialog"|'dialog')[^>]*[\s\S]*?<\/\1>/gi
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

  assert.match(html, /class=(?:"[^"]*\bapp-shell\b[^"]*"|'[^']*\bapp-shell\b[^']*')/);
  assert.match(html, /id=(?:"root"|'root')/);
  assert.match(html, /<main\b[^>]*id=(?:"display"|'display')/);
  assert.match(html, /<aside\b[^>]*id=(?:"panel"|'panel')/);
  assertContains(html, /id=(?:"transcriptViewport"|'transcriptViewport')/, '#transcriptViewport');
  assertContains(html, /id=(?:"transcriptStack"|'transcriptStack')/, '#transcriptStack');
  assertContains(html, /class=(?:"[^"]*\bmeetingShell\b[^"]*"|'[^']*\bmeetingShell\b[^']*')/, '.meetingShell');
  assertContains(html, /class=(?:"[^"]*\bcontrolPanel\b[^"]*"|'[^']*\bcontrolPanel\b[^']*')/, '.controlPanel');
  assertContains(html, /class=(?:"[^"]*\boperatorRail\b[^"]*"|'[^']*\boperatorRail\b[^']*')/, '.operatorRail');
  assertContains(html, /class=(?:"[^"]*\brailHeader\b[^"]*"|'[^']*\brailHeader\b[^']*')/, '.railHeader');
  assertContains(html, /class=(?:"[^"]*\brailBody\b[^"]*"|'[^']*\brailBody\b[^']*')/, '.railBody');
  assertContains(html, /class=(?:"[^"]*\bmanualBar\b[^"]*"|'[^']*\bmanualBar\b[^']*')/, '.manualBar');
  assertContains(html, /class=(?:"[^"]*\bmanualBarInner\b[^"]*"|'[^']*\bmanualBarInner\b[^']*')/, '.manualBarInner');
  assertContains(html, /class=(?:"[^"]*\bsettingsPanel\b[^"]*"|'[^']*\bsettingsPanel\b[^']*')/, '.settingsPanel');
  assertContains(html, /class=(?:"[^"]*\bsettingsBackdrop\b[^"]*"|'[^']*\bsettingsBackdrop\b[^']*')/, '.settingsBackdrop');
  assertContains(html, /id=(?:"settingsButton"|'settingsButton')/, '#settingsButton');
  assertContains(html, /id=(?:"closeSettings"|'closeSettings')/, '#closeSettings');
  assertContains(html, /class=(?:"[^"]*\bquickControlsGrid\b[^"]*"|'[^']*\bquickControlsGrid\b[^']*')/, '.quickControlsGrid');
  assertContains(html, /class=(?:"[^"]*\bmodeGrid\b[^"]*"|'[^']*\bmodeGrid\b[^']*')/, '.modeGrid');
  assertContains(html, /class=(?:"[^"]*\brailButton\b[^"]*"|'[^']*\brailButton\b[^']*')/, '.railButton');
  assertContains(html, /class=(?:"[^"]*\biconButton\b[^"]*"|'[^']*\biconButton\b[^']*')/, '.iconButton');
  assertContains(html, /hidden/, 'settings panel hidden state');

  const settingsMatch = html.match(/<aside\b[^>]*id=(?:"settingsPanel"|'settingsPanel')[^>]*[\s\S]*?<\/aside>/i);
  assert.ok(settingsMatch, 'Settings dialog is missing');
  const settings = settingsMatch[0];

  const diagnostics = findNamedContainer(settings, /diagnostics/i);
  assert.ok(diagnostics, 'Diagnostics disclosure or region is missing');

  assertContains(settings, /data-kind=(?:"transcription"|'transcription')/, 'transcription source control');
  assertContains(settings, /data-kind=(?:"summarization"|'summarization')/, 'summary source control');
  assertContains(settings, /id=(?:"fontSize"|'fontSize')/, '#fontSize');
  assertContains(settings, /id=(?:"displayMargin"|'displayMargin')/, '#displayMargin');
  assertContains(settings, /id=(?:"summaryInterval"|'summaryInterval')/, '#summaryInterval');
  assertContains(settings, /id=(?:"status"|'status')/, '#status');
  assertContains(settings, /id=(?:"liveTranscript"|'liveTranscript')/, '#liveTranscript');
  assertContains(settings, /id=(?:"pasteTranscript"|'pasteTranscript')/, '#pasteTranscript');
  assertContains(settings, /id=(?:"summarizeOnce"|'summarizeOnce')/, '#summarizeOnce');
  assertContains(settings, /summary/i, 'settings dialog labels');

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
  assert.doesNotMatch(settings, /id=(?:"bigger"|'bigger')/g, 'bigger text button should no longer exist');
  assert.doesNotMatch(settings, /id=(?:"smaller"|'smaller')/g, 'smaller text button should no longer exist');

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
  assertContains(html, /id=(?:"fontSize"|'fontSize')/, '#fontSize');
  assertContains(html, /id=(?:"displayMargin"|'displayMargin')/, '#displayMargin');
  assertContains(html, /id=(?:"summaryInterval"|'summaryInterval')/, '#summaryInterval');
  assertContains(html, /class=(?:"[^"]*\bmode\b[^"]*"|'[^']*\bmode\b[^']*')/, '.mode buttons');
  assertContains(html, /data-mode=(?:"speaker"|'speaker')/, 'speaker mode button');
  assertContains(html, /data-mode=(?:"information"|'information')/, 'information mode button');
  assertContains(html, /data-mode=(?:"song"|'song')/, 'song mode button');
  assertContains(html, /data-mode=(?:"prayer"|'prayer')/, 'prayer mode button');
  assertContains(html, /aria-label=(?:"Open settings"|'Open settings')/, 'gear settings button');
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
    [/id=(?:"settingsButton"|'settingsButton')/, '#settingsButton'],
    [/class=(?:"mode"|'mode')/, '.mode buttons']
  ];

  for (const [selector, description] of primarySelectors) {
    assertNotContains(settings, selector, description);
    assertNotContains(diagnostics, selector, description);
  }
});
