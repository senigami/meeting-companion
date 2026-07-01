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
  assert.ok(selector.test(block), `${description} was not found inside the expected container`);
}

function assertNotContains(block, selector, description) {
  assert.ok(!selector.test(block), `${description} should stay outside the expected container`);
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

test('helper panel keeps quick actions compact and settings centered', async () => {
  const html = await readHtml();

  assert.match(html, /class=(?:"[^"]*\bmeetingShell\b[^"]*"|'[^']*\bmeetingShell\b[^']*')/);
  assert.match(html, /id=(?:"root"|'root')/);
  assert.match(html, /<main\b[^>]*id=(?:"display"|'display')/);
  assert.match(html, /<aside\b[^>]*id=(?:"panel"|'panel')/);
  assertContains(html, /id=(?:"transcriptViewport"|'transcriptViewport')/, '#transcriptViewport');
  assertContains(html, /id=(?:"transcriptStack"|'transcriptStack')/, '#transcriptStack');
  assertContains(html, /class=(?:"[^"]*\boperatorRail\b[^"]*"|'[^']*\boperatorRail\b[^']*')/, '.operatorRail');
  assertContains(html, /class=(?:"[^"]*\brailTop\b[^"]*"|'[^']*\brailTop\b[^']*')/, '.railTop');
  assertContains(html, /class=(?:"[^"]*\brailBody\b[^"]*"|'[^']*\brailBody\b[^']*')/, '.railBody');
  assertContains(html, /class=(?:"[^"]*\bmanualBar\b[^"]*"|'[^']*\bmanualBar\b[^']*')/, '.manualBar');
  assertContains(html, /class=(?:"[^"]*\bmanualBarInner\b[^"]*"|'[^']*\bmanualBarInner\b[^']*')/, '.manualBarInner');
  assertContains(html, /id=(?:"railTranscript"|'railTranscript')/, '#railTranscript');
  assertContains(html, /class=(?:"[^"]*\bsettingsOverlay\b[^"]*"|'[^']*\bsettingsOverlay\b[^']*')/, '.settingsOverlay');
  assertContains(html, /class=(?:"[^"]*\bsettingsModal\b[^"]*"|'[^']*\bsettingsModal\b[^']*')/, '.settingsModal');
  assertContains(html, /class=(?:"[^"]*\bsettingsBody\b[^"]*"|'[^']*\bsettingsBody\b[^']*')/, '.settingsBody');
  assertContains(html, /class=(?:"[^"]*\bsettingsCard\b[^"]*"|'[^']*\bsettingsCard\b[^']*')/, '.settingsCard');
  assertContains(html, /class=(?:"[^"]*\bsettingsGrid\b[^"]*"|'[^']*\bsettingsGrid\b[^']*')/, '.settingsGrid');
  assertContains(html, /class=(?:"[^"]*\bsettingsBackdrop\b[^"]*"|'[^']*\bsettingsBackdrop\b[^']*')/, '.settingsBackdrop');
  assertContains(html, /id=(?:"settingsButton"|'settingsButton')/, '#settingsButton');
  assertContains(html, /id=(?:"alertButton"|'alertButton')/, '#alertButton');
  assertContains(html, /class=(?:"[^"]*\bquickControlsGrid\b[^"]*"|'[^']*\bquickControlsGrid\b[^']*')/, '.quickControlsGrid');
  assertContains(html, /class=(?:"[^"]*\bmodeGrid\b[^"]*"|'[^']*\bmodeGrid\b[^']*')/, '.modeGrid');
  assertContains(html, /class=(?:"[^"]*\brailButton\b[^"]*"|'[^']*\brailButton\b[^']*')/, '.railButton');
  assertContains(html, /class=(?:"[^"]*\biconButton\b[^"]*"|'[^']*\biconButton\b[^']*')/, '.iconButton');

  const railMatch = html.match(/<aside\b[^>]*id=(?:"panel"|'panel')[^>]*[\s\S]*?<\/aside>/i);
  assert.ok(railMatch, 'Operator rail is missing');
  const rail = railMatch[0];
  assertContains(rail, /class=(?:"[^"]*\brailActions\b[^"]*"|'[^']*\brailActions\b[^']*')/, '.railActions');
  assertContains(rail, /id=(?:"railTranscript"|'railTranscript')/, '#railTranscript');
  assertContains(rail, /class=(?:"[^"]*\brailTranscriptDisclosure\b[^"]*"|'[^']*\brailTranscriptDisclosure\b[^']*')/, '.railTranscriptDisclosure');
  assertNotContains(rail, /<h1\b/i, 'large Controls heading');
  assertNotContains(rail, /id=(?:"apiWarning"|'apiWarning')/, '#apiWarning');

  const settingsMatch = html.match(/<dialog\b[^>]*id=(?:"settingsPanel"|'settingsPanel')[^>]*[\s\S]*?<\/dialog>/i);
  assert.ok(settingsMatch, 'Settings dialog is missing');
  const settings = settingsMatch[0];

  assertContains(settings, /role=(?:"dialog"|'dialog')/, 'dialog role');
  assertContains(settings, /aria-modal=(?:"true"|'true')/, 'modal flag');
  assertContains(settings, /class=(?:"[^"]*\bsettingsHeader\b[^"]*"|'[^']*\bsettingsHeader\b[^']*')/, '.settingsHeader');
  assertContains(settings, /class=(?:"[^"]*\bsettingsBody\b[^"]*"|'[^']*\bsettingsBody\b[^']*')/, '.settingsBody');
  assertContains(settings, /id=(?:"openaiKeyInput"|'openaiKeyInput')/, '#openaiKeyInput');
  assertContains(settings, /id=(?:"claudeKeyInput"|'claudeKeyInput')/, '#claudeKeyInput');
  assertContains(settings, /id=(?:"openaiKeySave"|'openaiKeySave')/, '#openaiKeySave');
  assertContains(settings, /id=(?:"openaiKeyTest"|'openaiKeyTest')/, '#openaiKeyTest');
  assertContains(settings, /id=(?:"openaiKeyDelete"|'openaiKeyDelete')/, '#openaiKeyDelete');
  assertContains(settings, /id=(?:"claudeKeySave"|'claudeKeySave')/, '#claudeKeySave');
  assertContains(settings, /id=(?:"claudeKeyTest"|'claudeKeyTest')/, '#claudeKeyTest');
  assertContains(settings, /id=(?:"claudeKeyDelete"|'claudeKeyDelete')/, '#claudeKeyDelete');
  assertContains(settings, /id=(?:"summaryInterval"|'summaryInterval')/, '#summaryInterval');
  assertContains(settings, /id=(?:"displayMargin"|'displayMargin')/, '#displayMargin');
  assertContains(settings, /id=(?:"fontSize"|'fontSize')/, '#fontSize');
  assertContains(settings, /id=(?:"status"|'status')/, '#status');
  assertContains(settings, /id=(?:"liveTranscript"|'liveTranscript')/, '#liveTranscript');
  assertContains(settings, /id=(?:"pasteTranscript"|'pasteTranscript')/, '#pasteTranscript');
  assertContains(settings, /id=(?:"summarizeOnce"|'summarizeOnce')/, '#summarizeOnce');
  assertContains(settings, /summary/i, 'settings dialog labels');

  const alertsMatch = settings.match(/<section\b[^>]*id=(?:"alertsSection"|'alertsSection')[^>]*[\s\S]*?<\/section>/i);
  assert.ok(alertsMatch, 'Alerts card is missing');
  const alerts = alertsMatch[0];
  assertContains(alerts, /id=(?:"apiWarning"|'apiWarning')/, '#apiWarning');

  const providerSections = countMatches(settings, /class=(?:"[^"]*\bproviderCard\b[^"]*"|'[^']*\bproviderCard\b[^']*')/g);
  assert.ok(providerSections >= 2, 'provider key cards should be visible');

  assertContains(settings, /data-kind=(?:"transcription"|'transcription')/, 'transcription source control');
  assertContains(settings, /data-kind=(?:"summarization"|'summarization')/, 'summary source control');

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
    [/id=(?:"alertButton"|'alertButton')/, '#alertButton'],
    [/class=(?:"mode"|'mode')/, '.mode buttons']
  ];

  for (const [selector, description] of primarySelectors) {
    assertNotContains(settings, selector, description);
    assertNotContains(alerts, selector, description);
  }

  assertContains(rail, /id=(?:"railTranscript"|'railTranscript')/, '#railTranscript');
});
