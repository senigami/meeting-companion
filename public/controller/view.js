import {
  clampSummaryMaxWordsOverride,
  sliderPositionFromFontSize
} from '../services/view-settings.js';
import { applyQuickPanelSnap, loadQuickPanelSnap } from './quick-panel-sheet.js';
import { usableIntervalFloor } from '../services/reading-pace.js';
import { autoExpandRailForCondition, resetRailAutoExpand } from './rail-collapse.js';

const MODE_META = {
  speaker: { label: 'Speaker', icon: 'icon-speaker' },
  information: { label: 'Information', icon: 'icon-information' },
  song: { label: 'Song', icon: 'icon-song' },
  prayer: { label: 'Prayer', icon: 'icon-prayer' }
};

const MANUAL_META = {
  label: 'Manual',
  icon: 'icon-human'
};

// Program-tab mode picker and speaker-name datalist filtering (per-meeting program list, issue TBD):
// short labels distinct from MODE_META's card labels ("Info" not "Information") -- Steve's spec for
// the settings tab names these exact four words.
const PROGRAM_MODE_OPTIONS = [
  { value: 'speaker', label: 'Speaker' },
  { value: 'information', label: 'Info' },
  { value: 'song', label: 'Song' },
  { value: 'prayer', label: 'Prayer' }
];

// Exploratory (#4, Steve unsure this earns its keep): flip to false to revert same-mode
// speaker-change alternation with no other code change -- see renderDisplay/createTranscriptCard.
const SPEAKER_ALTERNATION_ENABLED = true;

const TRANSCRIPT_SCROLL_DURATION_MS = 1000;

const SETTINGS_SECTIONS = ['alerts', 'timing', 'transcription', 'summaries', 'services', 'program', 'tools'];
const DEFAULT_SETTINGS_SECTION = 'timing';

const RAIL_STATUS_WORDS = {
  listening: 'Listening',
  paused: 'Paused',
  manual: 'Manual',
  problem: 'Problem',
  // "Check mic" rather than "Problem": prolonged silence while listening is genuinely ambiguous --
  // it is exactly as consistent with a long prayer or reflective pause (normal in this room) as
  // with a dead microphone. Treating it as a confirmed "Problem" would be crying wolf during a
  // moment of silence that deserves quiet, not an alarm; saying nothing at all is the failure this
  // whole watchdog exists to prevent. A fourth, gentler level is the honest middle: visible and
  // persistent (loud enough to notice), but not styled or announced as urgently as a confirmed
  // fatal error (not loud enough to panic over).
  silence: 'Check mic',
  // Confirmed, not speculative: trimBucket only ever drops the oldest speech once the buffer has
  // actually overflowed (BUCKET_MAX_CHARS), which only happens during a sustained summarizer
  // outage. Distinct wording from 'problem' -- this is INV-13 (silent loss of speech the reader
  // never gets), not INV-10's fatal transcription failure, and the two facts must stay tellable
  // apart on the rail.
  dropped: 'Speech dropped',
  // Also confirmed, not speculative: only set when a scheduled summarize tick actually found the
  // previous one still in flight (see noteSkippedSummarizeTick), which only happens when a call is
  // running longer than the update interval. Distinct from 'dropped' -- no speech has been lost
  // here, the wall is just late -- and distinct from 'silence', which is a time-based guess, not an
  // observed fact.
  behind: 'Running behind'
};

// Levels serious enough that their rail-note explanation must stay up (no auto-hide) until the
// condition clears, rather than flashing briefly like a Clear/Undo note. 'problem' is a confirmed
// fatal condition (INV-10); 'dropped' and 'behind' are confirmed-but-non-fatal (INV-13 data loss /
// scheduling lag); 'silence' is not confirmed fatal, only prolonged and unexplained -- see
// showRailPersistentNote for how all four are still styled and announced differently.
const PERSISTENT_STATUS_LEVELS = new Set(['problem', 'dropped', 'behind', 'silence']);

// Ordered severity for the four persistent levels, most confirmed/severe first: 'problem' (a
// confirmed fatal condition, INV-10) must never be silently replaced by a lower-ranked persistent
// level elbowing in while it's still active -- e.g. a summarize-failure escalation followed by 45s
// of no transcript events precisely because the server path is backed off. 'dropped' (confirmed
// data loss) outranks 'behind' (confirmed lag, no loss yet) which outranks 'silence' (unconfirmed).
// Recovery still works: it comes from the condition itself clearing to a non-persistent level
// (e.g. 'listening'), never from a lower-ranked persistent level elbowing in on a higher one.
const LEVEL_RANK = { problem: 4, dropped: 3, behind: 2, silence: 1 };

// Per-level rail-note presentation: a distinct Unicode prefix (WCAG 1.4.1 -- colour is not the
// only channel) and CSS class for each persistent level, plus whether it interrupts assertively.
// Only a confirmed fatal condition (INV-10) is announced as role="alert"; the other three are
// role="status"/polite so they don't also start crying wolf.
const PERSISTENT_LEVEL_META = {
  problem: { className: 'is-problem', prefix: '⚠ ', urgent: true },
  dropped: { className: 'is-dropped', prefix: '✂ ', urgent: false },
  behind: { className: 'is-behind', prefix: '⏳ ', urgent: false },
  silence: { className: 'is-silence', prefix: '⏱ ', urgent: false }
};
const PERSISTENT_LEVEL_CLASSES = Object.values(PERSISTENT_LEVEL_META).map((meta) => meta.className);

export function updateStatus(ctx, text, { level, clearTimeoutFn = clearTimeout } = {}) {
  if (level && RAIL_STATUS_WORDS[level]) {
    const currentLevel = ctx.state.railStatusLevel;
    if (
      PERSISTENT_STATUS_LEVELS.has(currentLevel) &&
      PERSISTENT_STATUS_LEVELS.has(level) &&
      (LEVEL_RANK[level] || 0) < (LEVEL_RANK[currentLevel] || 0)
    ) {
      return;
    }
  }

  ctx.dom.status.textContent = text;
  if (!level || !RAIL_STATUS_WORDS[level]) return;

  // #status lives inside the closed settings dialog, so a problem/silence message written only
  // there is unreadable. Mirror it into the rail note, and keep it up (no auto-hide) until the
  // level clears.
  if (PERSISTENT_STATUS_LEVELS.has(level)) {
    showRailPersistentNote(ctx, text, { clearTimeoutFn, level });
  } else if (ctx.state.railProblemNote || ctx.state.railPersistentNoteText) {
    // Deliberately NOT gated on railProblemNote alone: flashRailNote clears that flag while its
    // overlay is up, so a recovery landing inside the 4s flash window would skip the cleanup
    // entirely and leak the auto-expand latch plus a stale remembered note. The screen would look
    // right and the next genuinely new condition would silently fail to expand a collapsed rail.
    clearRailProblem(ctx);
  }

  if (ctx.state.railStatusLevel === level) return;
  ctx.state.railStatusLevel = level;

  const dot = ctx.dom.railStatusDot;
  const word = ctx.dom.railStatusWord;
  if (word) {
    word.textContent = RAIL_STATUS_WORDS[level];
  }
  if (dot) {
    Object.keys(RAIL_STATUS_WORDS).forEach((name) => {
      dot.classList.toggle(`is-level-${name}`, name === level);
    });
  }
}

const RAIL_NOTE_DURATION_MS = 4000;

// #railNote stays mounted in the a11y tree at all times (see index.html) so switching its
// role/aria-live and filling its text is a single mutation on an already-registered live region --
// not "appear + speak" in the same tick, which AT frequently drops. A genuinely fatal problem
// (INV-10: this function only ever receives text already filtered to the fatal case) interrupts
// immediately (role="alert"/assertive); the benign Clear/Undo flashes stay role="status"/polite so
// they don't also start crying wolf.
function setRailNoteUrgency(note, isProblem) {
  note.setAttribute('role', isProblem ? 'alert' : 'status');
  note.setAttribute('aria-live', isProblem ? 'assertive' : 'polite');
}

// Non-text-based cue per level (WCAG 1.4.1: colour is not the only channel -- text colour alone
// must not be the only thing distinguishing one persistent note from another or from a benign
// Clear/Undo one). A plain Unicode prefix, not a separate aria-hidden node: this module has no
// DOM/document dependency today (renderDisplay's document.createElement only runs where a caller
// has stubbed `document`), so keep it that way rather than introducing one just for a decorative
// glyph. See PERSISTENT_LEVEL_META for the actual glyph/class/urgency per level.

function showRailPersistentNote(ctx, text, { clearTimeoutFn = clearTimeout, level = 'problem' } = {}) {
  const note = ctx.dom.railNote;
  if (!note) return;
  const meta = PERSISTENT_LEVEL_META[level] || PERSISTENT_LEVEL_META.problem;
  clearTimeoutFn(ctx.state.railNoteTimer);
  ctx.state.railNoteTimer = null;
  ctx.state.railProblemNote = true;
  PERSISTENT_LEVEL_CLASSES.forEach((className) => note.classList.toggle(className, className === meta.className));
  // Only a confirmed fatal condition interrupts assertively (role="alert"). The other persistent
  // levels have not confirmed anything is actually broken, or are non-fatal by nature -- they stay
  // role="status"/polite so they don't also start crying wolf during what might just be a long
  // prayer, a recoverable outage, or a summarizer that's merely running late.
  setRailNoteUrgency(note, meta.urgent);
  const fullText = meta.prefix + text;
  note.textContent = fullText;
  // Remembered so a later flashRailNote (Clear/Undo) can hand the note back exactly as it was --
  // text, class, and urgency -- once its own timer expires, rather than leaving the condition's
  // note permanently blank while the condition itself is still active.
  ctx.state.railPersistentNoteText = fullText;
  ctx.state.railPersistentNoteLevel = level;
  // Every persistent level auto-expands, not just a confirmed problem. Verified live: with the rail
  // collapsed the watchdog fired correctly and the operator saw nothing but an unchanged dot,
  // because the 64px rail hides #railNote -- which would leave the watchdog doing no work in
  // exactly the unattended case it exists for. The note's whole value is that it says what to DO
  // next. Keyed by level: see autoExpandRailForCondition for why a shared latch was wrong.
  autoExpandRailForCondition(ctx, level);
}

function clearRailProblem(ctx) {
  ctx.state.railProblemNote = false;
  ctx.state.railPersistentNoteText = null;
  ctx.state.railPersistentNoteLevel = null;
  // The rail has returned to a normal status -- every persistent condition has cleared -- so reset
  // the whole per-condition latch set rather than just the one that happened to be active.
  resetRailAutoExpand(ctx);
  const note = ctx.dom.railNote;
  if (!note) return;
  note.textContent = '';
  PERSISTENT_LEVEL_CLASSES.forEach((className) => note.classList.remove(className));
  setRailNoteUrgency(note, false);
}

export function flashRailNote(ctx, text, { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  const note = ctx.dom.railNote;
  if (!note) return;
  clearTimeoutFn(ctx.state.railNoteTimer);
  ctx.state.railProblemNote = false;
  PERSISTENT_LEVEL_CLASSES.forEach((className) => note.classList.remove(className));
  setRailNoteUrgency(note, false);
  note.textContent = text;
  ctx.state.railNoteTimer = setTimeoutFn(() => {
    ctx.state.railNoteTimer = null;
    // A flash (Clear/Undo) is a temporary overlay on top of a persistent note, not a destructive
    // takeover of it: if the condition this note exists for is still active when the flash expires,
    // hand the note back exactly as it was rather than leaving it permanently blank -- a blank note
    // with the dot still reading e.g. "Problem"/"Speech dropped" strands the operator with no way
    // to tell what's wrong, which is the exact failure this whole area exists to prevent. Ground
    // truth is the live rail level, not a flag the flash itself could have gone stale against.
    if (PERSISTENT_STATUS_LEVELS.has(ctx.state.railStatusLevel) && ctx.state.railPersistentNoteText) {
      const level = ctx.state.railPersistentNoteLevel;
      const meta = PERSISTENT_LEVEL_META[level] || PERSISTENT_LEVEL_META.problem;
      ctx.state.railProblemNote = true;
      PERSISTENT_LEVEL_CLASSES.forEach((className) => note.classList.toggle(className, className === meta.className));
      setRailNoteUrgency(note, meta.urgent);
      note.textContent = ctx.state.railPersistentNoteText;
      return;
    }
    note.textContent = '';
  }, RAIL_NOTE_DURATION_MS);
}

export function renderDisplay(ctx) {
  if (!ctx.dom.transcriptStack || !ctx.dom.transcriptViewport) return;

  // A mode click (Speaker/Info/Song/Prayer) used to change nothing on screen until content actually
  // arrived in the new mode -- sometimes not for a while, if the operator switched ahead of the
  // speaker actually starting. Steve, live: "I would like the glowing line to appear as soon as I
  // change modes, not on first item push." This pending marker is not a real card and carries no
  // item id, so it is stripped before the id-based diff below runs, then re-added after if it is
  // still owed -- it must never be mistaken for "the previous last card" by that diff.
  const existingChildren = ctx.dom.transcriptStack.children;
  const previousTrailingNode = existingChildren && existingChildren.length
    ? existingChildren[existingChildren.length - 1]
    : null;
  if (previousTrailingNode?.className?.includes?.('transcript-mode-divider--pending')) {
    if (typeof previousTrailingNode.remove === 'function') {
      previousTrailingNode.remove();
    } else if (Array.isArray(ctx.dom.transcriptStack.children)) {
      ctx.dom.transcriptStack.children.pop();
    }
  }

  const items = Array.isArray(ctx.state.transcriptItems) ? ctx.state.transcriptItems : [];
  const renderItems = items.length
    ? items
    : ctx.state.viewPanelOpen
      ? [{
        id: 'sample-text',
        mode: 'information',
        text: 'Sample text appears here so you can tune the display before the meeting starts.',
        createdAt: Date.now(),
        source: 'manual',
        sample: true
      }]
      : [];
  const shouldStick = ctx.state.stickToBottom !== false;
  const previousScrollTop = ctx.dom.transcriptViewport.scrollTop || 0;
  const reducedMotion = Boolean(ctx.state.prefersReducedMotion);

  const renderIds = renderItems.map((item) => item.id);
  const previousIds = Array.isArray(ctx.state.transcriptRenderedIds) ? ctx.state.transcriptRenderedIds : [];
  // A card arriving is an append: the ids already on screen are still the leading run of the new
  // list, in the same order. Delete, undo, clear, and the display-count cap all break that (an id
  // drops out of the middle or the front), so this only ever matches the steady-state case below.
  const previousIsPrefix = previousIds.length <= renderIds.length
    && previousIds.every((id, index) => id === renderIds[index]);

  // 2026-08-09 reversal of issue #40 (Steve): the label is a persistent card-corner nameplate now,
  // not a sentence to re-read -- it shows on EVERY card that has a speaker, whether or not it
  // changed from the previous one. A reader following along glances at the corner and only has to
  // notice when it's different; making it disappear on a repeat forces them to remember who was
  // talking instead, which is more cognitive load, not less.
  const newNodes = [];
  // Speaker-alternation toggle (exploratory #4, Steve unsure -- flip SPEAKER_ALTERNATION_ENABLED
  // to false to revert with no other code changes needed): walked across the FULL renderItems list
  // every render, not just the new-node slice below, so the toggle stays correctly sequenced even
  // when earlier cards aren't being rebuilt this pass.
  let speakerAltOn = false;
  renderItems.forEach((item, index) => {
    const speaker = typeof item.speaker === 'string' ? item.speaker.trim() : '';
    const showSpeaker = Boolean(speaker);
    const previousItem = index > 0 ? renderItems[index - 1] : null;
    const isModeBoundary = Boolean(previousItem) && previousItem.mode !== item.mode;

    if (SPEAKER_ALTERNATION_ENABLED && item.mode === 'speaker' && previousItem && previousItem.mode === 'speaker') {
      const previousSpeaker = typeof previousItem.speaker === 'string' ? previousItem.speaker.trim() : '';
      if (previousSpeaker !== speaker) speakerAltOn = !speakerAltOn;
    } else {
      speakerAltOn = false;
    }
    const isSpeakerAlt = SPEAKER_ALTERNATION_ENABLED && item.mode === 'speaker' && speakerAltOn;

    if (previousIsPrefix && index < previousIds.length) return;
    // A genuine standalone line between cards, not a border on the card itself -- a border-top read
    // as "this card's own edge is slightly brighter," easy to miss against these translucent, blurred
    // backgrounds. Steve, live: "there's still no clear separation... I was hoping that there would be
    // a line drawn on the page." Colored to the mode being ENTERED (reusing --card-accent the same way
    // every card already does) so the line also previews what's coming, not just that something changed.
    if (isModeBoundary) newNodes.push(createModeDividerNode(item.mode));
    newNodes.push(createTranscriptCard(item, index === renderItems.length - 1, {
      showSpeaker,
      speaker,
      isSpeakerAlt
    }));
  });

  // Issue #13: rebuilding every card on every arrival tore down and recreated cards that hadn't
  // changed, replaying each one's slide-in entrance animation at once -- what read as the whole
  // display jumping. The steady-state case (a new card lands, nothing before it changed) now only
  // touches the DOM the new card needs: the previously-last card's active flag flips off in place
  // (a plain attribute write, not a remove/reinsert), and the new card is the only node that plays
  // transcriptIn. Anything that reorders or drops an existing card still gets a full rebuild.
  if (previousIsPrefix && previousIds.length > 0) {
    const existingChildren = ctx.dom.transcriptStack.children;
    const previousLastNode = existingChildren && existingChildren.length
      ? existingChildren[existingChildren.length - 1]
      : null;
    if (newNodes.length > 0) {
      if (previousLastNode) setDataAttribute(previousLastNode, 'active', 'false');
      if (typeof ctx.dom.transcriptStack.append === 'function') {
        ctx.dom.transcriptStack.append(...newNodes);
      }
    }
  } else if (typeof ctx.dom.transcriptStack.replaceChildren === 'function') {
    ctx.dom.transcriptStack.replaceChildren(...newNodes);
  } else {
    ctx.dom.transcriptStack.children = [...newNodes];
  }
  ctx.state.transcriptRenderedIds = renderIds;

  // Only against a REAL last item, never the synthetic sample-text placeholder (items, not
  // renderItems) -- nothing to separate a mode click from yet if the meeting hasn't produced a
  // single real card, and the settings-preview placeholder isn't content to draw a boundary against.
  const lastRealItem = items.length ? items[items.length - 1] : null;
  if (lastRealItem && ctx.state.mode && lastRealItem.mode !== ctx.state.mode) {
    const pendingDivider = createModeDividerNode(ctx.state.mode);
    pendingDivider.className += ' transcript-mode-divider--pending';
    if (typeof ctx.dom.transcriptStack.append === 'function') {
      ctx.dom.transcriptStack.append(pendingDivider);
    } else if (Array.isArray(ctx.dom.transcriptStack.children)) {
      ctx.dom.transcriptStack.children.push(pendingDivider);
    }
  }

  if (shouldStick) {
    scrollTranscriptToBottom(ctx, { reducedMotion });
    return;
  }

  ctx.dom.transcriptViewport.scrollTop = previousScrollTop;
}

function scrollTranscriptToBottom(ctx, { reducedMotion = false } = {}) {
  const viewport = ctx.dom.transcriptViewport;
  const targetTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);

  if (reducedMotion) {
    viewport.scrollTop = targetTop;
    return;
  }

  const startTop = Number(viewport.scrollTop) || 0;
  const distance = targetTop - startTop;
  if (Math.abs(distance) < 1) {
    viewport.scrollTop = targetTop;
    return;
  }

  const requestFrame = globalThis.requestAnimationFrame || ((callback) => setTimeout(() => callback(Date.now()), 16));
  const cancelFrame = globalThis.cancelAnimationFrame || clearTimeout;

  if (ctx.state.transcriptScrollFrame) {
    cancelFrame(ctx.state.transcriptScrollFrame);
    ctx.state.transcriptScrollFrame = null;
  }

  let startedAt = null;
  const animate = (timestamp) => {
    const now = Number.isFinite(timestamp) ? timestamp : Date.now();
    startedAt ??= now;
    const elapsed = Math.min(1, (now - startedAt) / TRANSCRIPT_SCROLL_DURATION_MS);
    const eased = elapsed < 0.5
      ? 2 * elapsed * elapsed
      : 1 - Math.pow(-2 * elapsed + 2, 2) / 2;
    viewport.scrollTop = startTop + distance * eased;

    if (elapsed < 1) {
      ctx.state.transcriptScrollFrame = requestFrame(animate);
      return;
    }

    viewport.scrollTop = targetTop;
    ctx.state.transcriptScrollFrame = null;
  };

  ctx.state.transcriptScrollFrame = requestFrame(animate);
}

export function getDefaultSettingsSection(ctx) {
  return buildAlerts(ctx).length > 0 ? 'alerts' : DEFAULT_SETTINGS_SECTION;
}

export function setSettingsSection(ctx, section) {
  const next = SETTINGS_SECTIONS.includes(section) ? section : DEFAULT_SETTINGS_SECTION;
  ctx.state.settingsSection = next;
  const hasAlerts = buildAlerts(ctx).length > 0;

  (ctx.dom.settingsSections || []).forEach((node) => {
    const sectionName = node.dataset?.settingsSection;
    const isActive = sectionName === next;
    // The alerts section stays hidden whenever there are no alerts to show,
    // even if a helper navigates to it directly.
    node.hidden = sectionName === 'alerts' ? !(isActive && hasAlerts) : !isActive;
  });

  (ctx.dom.settingsNavButtons || []).forEach((button) => {
    const isActive = button.dataset?.settingsNav === next;
    button.setAttribute('aria-current', String(isActive));
    button.classList?.toggle?.('active', isActive);
    // The Alerts tab itself, not just its panel, disappears when there is nothing to show -- an
    // always-visible tab that opens on an empty section reads as a control that doesn't work.
    if (button.dataset?.settingsNav === 'alerts') {
      button.hidden = !hasAlerts;
    }
  });
}

// Above 900px `.drawerContent` is `display: contents` (controls.css:519), so #quickPanel is
// not a box at all -- its children ARE the permanent desktop rail chrome. `inert` applies to
// the flat-tree regardless of `display: contents`, so writing it there kills the rail. Only
// write `inert` when the panel is actually acting as a closed drawer (<=900px).
function isQuickPanelDrawerActive() {
  return Boolean(globalThis.matchMedia?.('(max-width: 900px)')?.matches);
}

// Chrome refuses aria-hidden (and inert has the same effect) on a container that still holds the
// focused element, and warns instead of applying it -- so a panel closing while focus is still
// inside it must move focus out FIRST, synchronously, not on the next animation frame.
function releaseFocusBeforeHiding(container, fallback) {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (!container || typeof container.contains !== 'function' || !active || !container.contains(active)) {
    return;
  }
  if (fallback && typeof fallback.focus === 'function') {
    fallback.focus();
  } else if (typeof active.blur === 'function') {
    active.blur();
  }
}

export function setSettingsOpen(ctx, open, { focusReturn = false } = {}) {
  const next = Boolean(open);
  ctx.state.settingsOpen = next;
  ctx.state.panelOpen = next;

  if (next) {
    setSettingsSection(ctx, getDefaultSettingsSection(ctx));
    renderReadyCheck(ctx);
  }

  if (ctx.dom.settingsPanel) {
    if (!next) {
      // A native <dialog> that is hidden and closed is already out of the focus order and the
      // accessibility tree, so it needs no aria-hidden/inert of its own -- but close() only takes
      // focus with it reliably once focus has already left the dialog.
      releaseFocusBeforeHiding(ctx.dom.settingsPanel, ctx.dom.settingsButton);
    }
    ctx.dom.settingsPanel.hidden = !next;
    if (next && typeof ctx.dom.settingsPanel.showModal === 'function' && !ctx.dom.settingsPanel.open) {
      ctx.dom.settingsPanel.showModal();
    } else if (next && !ctx.dom.settingsPanel.open) {
      ctx.dom.settingsPanel.setAttribute('open', '');
    } else if (!next && ctx.dom.settingsPanel.open && typeof ctx.dom.settingsPanel.close === 'function') {
      ctx.dom.settingsPanel.close();
    } else if (!next) {
      ctx.dom.settingsPanel.removeAttribute?.('open');
    }
  }

  if (ctx.dom.settingsBackdrop) {
    ctx.dom.settingsBackdrop.hidden = true;
  }

  if (ctx.dom.settingsButton) {
    ctx.dom.settingsButton.setAttribute('aria-expanded', String(next));
    ctx.dom.settingsButton.setAttribute('aria-pressed', String(next));
  }

  if (next) {
    const focusTarget = ctx.state.pendingProviderSelection
      ? ctx.dom.serviceRegistrationKeyInput || ctx.dom.closeSettings || ctx.dom.settingsPanel || ctx.dom.settingsButton
      : ctx.dom.closeSettings || ctx.dom.settingsPanel || ctx.dom.settingsButton;
    globalThis.requestAnimationFrame?.(() => focusTarget?.focus?.());
    return;
  }

  if (focusReturn) {
    globalThis.requestAnimationFrame?.(() => ctx.dom.settingsButton?.focus?.());
  }

  if (!next) {
    ctx.state.pendingProviderSelection = null;
  }
}

export const setPanelOpen = setSettingsOpen;

export function setViewPanelOpen(ctx, open, { focusReturn = false } = {}) {
  const next = Boolean(open);
  ctx.state.viewPanelOpen = next;

  if (ctx.state.viewPanelCloseHandle) {
    clearTimeout(ctx.state.viewPanelCloseHandle);
    ctx.state.viewPanelCloseHandle = null;
  }

  if (ctx.dom.viewPanel) {
    if (!next) {
      releaseFocusBeforeHiding(ctx.dom.viewPanel, ctx.dom.viewButton);
    }
    ctx.dom.viewPanel.hidden = !next;
    ctx.dom.viewPanel.inert = !next;
    if (next) {
      ctx.dom.viewPanel.classList?.add?.('is-open');
    } else {
      ctx.dom.viewPanel.classList?.remove?.('is-open');
      ctx.state.viewPanelCloseHandle = setTimeout(() => {
        if (ctx.dom.viewPanel && !ctx.state.viewPanelOpen) {
          ctx.dom.viewPanel.hidden = true;
        }
        ctx.state.viewPanelCloseHandle = null;
      }, 240);
    }
  }

  if (ctx.dom.viewButton) {
    ctx.dom.viewButton.setAttribute('aria-expanded', String(next));
    ctx.dom.viewButton.setAttribute('aria-pressed', String(next));
    const label = next ? 'Close display controls' : 'Open display controls';
    ctx.dom.viewButton.setAttribute('aria-label', label);
    ctx.dom.viewButton.title = label;
  }

  renderDisplay(ctx);

  if (next) {
    globalThis.requestAnimationFrame?.(() => ctx.dom.closeViewPanel?.focus?.());
  } else if (focusReturn) {
    globalThis.requestAnimationFrame?.(() => ctx.dom.viewButton?.focus?.());
  }
}

export function setQuickPanelOpen(ctx, open, { focusReturn = false } = {}) {
  const next = Boolean(open);
  ctx.state.quickPanelOpen = next;

  if (ctx.state.quickPanelCloseHandle) {
    clearTimeout(ctx.state.quickPanelCloseHandle);
    ctx.state.quickPanelCloseHandle = null;
  }

  if (ctx.dom.quickPanel) {
    if (next) {
      // Apply the last-used (or persisted) snap height before sliding
      // up, without animating the height itself -- only the slide
      // transform should visibly animate on open.
      applyQuickPanelSnap(ctx, ctx.state.quickPanelSnap || loadQuickPanelSnap(), { animate: false });
    } else {
      releaseFocusBeforeHiding(ctx.dom.quickPanel, ctx.dom.quickPanelToggle);
    }
    ctx.dom.quickPanel.inert = !next && isQuickPanelDrawerActive();
    if (next) {
      ctx.dom.quickPanel.classList?.add?.('is-open');
    } else {
      ctx.dom.quickPanel.classList?.remove?.('is-open');
    }
  }

  if (ctx.dom.quickPanelBackdrop) {
    ctx.dom.quickPanelBackdrop.hidden = !next;
  }

  if (ctx.dom.quickPanelToggle) {
    ctx.dom.quickPanelToggle.setAttribute('aria-expanded', String(next));
    ctx.dom.quickPanelToggle.setAttribute('aria-pressed', String(next));
    const label = next ? 'Close quick controls' : 'Open quick controls';
    ctx.dom.quickPanelToggle.setAttribute('aria-label', label);
    ctx.dom.quickPanelToggle.title = label;
  }

  if (next) {
    globalThis.requestAnimationFrame?.(() => ctx.dom.quickPanelHandle?.focus?.());
  } else if (focusReturn) {
    globalThis.requestAnimationFrame?.(() => ctx.dom.quickPanelToggle?.focus?.());
  }
}

export function bindTranscriptViewport(ctx) {
  if (!ctx.dom.transcriptViewport) return;
  ctx.dom.transcriptViewport.addEventListener('scroll', () => {
    ctx.state.stickToBottom = isTranscriptNearBottom(ctx.dom.transcriptViewport);
  }, { passive: true });
}

export function updateModeButtons(ctx) {
  ctx.dom.modeButtons.forEach((btn) => {
    const active = btn.dataset.mode === ctx.state.mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

export function updateSourceButtons(ctx) {
  ctx.dom.transcriptionButtons.forEach((btn) => {
    const active = btn.dataset.source === ctx.state.transcriptionSource;
    const unavailable = isSourceUnavailable(ctx, btn.dataset.kind, btn.dataset.source);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.hidden = unavailable && btn.dataset.source !== ctx.state.transcriptionSource;
    btn.disabled = unavailable && btn.dataset.source === 'browser';
    updateProviderOptionLabel(btn, ctx, btn.dataset.kind, btn.dataset.source, { unavailable });
  });

  ctx.dom.summarizationButtons.forEach((btn) => {
    const active = btn.dataset.source === ctx.state.summarizationSource;
    const unavailable = isSourceUnavailable(ctx, btn.dataset.kind, btn.dataset.source);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.hidden = unavailable && btn.dataset.source !== ctx.state.summarizationSource;
    btn.disabled = false;
    updateProviderOptionLabel(btn, ctx, btn.dataset.kind, btn.dataset.source, { unavailable });
  });

  syncReplayControls(ctx);
}

// The recording picker and speed selector are only meaningful once replay is actually selected --
// same show/hide-by-state idiom as the rest of this file (settingsAlertBadge, apiWarning, etc.),
// not a permanently-visible control like the mic test group.
function syncReplayControls(ctx) {
  if (ctx.dom.replayControls) {
    ctx.dom.replayControls.hidden = ctx.state.transcriptionSource !== 'replay';
  }
  if (ctx.dom.replaySpeedSelect) {
    ctx.dom.replaySpeedSelect.value = ctx.state.replaySpeed || '1';
  }
}

export function syncServiceRegistration(ctx) {
  const provider = getRegistrationProvider(ctx);
  ctx.state.registrationProvider = provider;
  const state = getProviderState(ctx, 'summarization', provider);
  const label = provider === 'claude' ? 'Claude' : 'OpenAI';
  const configuredText = state.origin === 'server'
    ? 'Configured on server'
    : state.origin === 'local'
      ? 'Configured locally'
      : 'Needs key';

  updateRegistrationButton(ctx.dom.serviceRegistrationOpenAi, ctx, 'openai', provider);
  updateRegistrationButton(ctx.dom.serviceRegistrationClaude, ctx, 'claude', provider);

  if (ctx.dom.serviceRegistrationTitle) {
    ctx.dom.serviceRegistrationTitle.textContent = `${label} API key`;
  }

  if (ctx.dom.serviceRegistrationDescription) {
    ctx.dom.serviceRegistrationDescription.textContent = state.origin === 'local'
      ? 'Saved locally in this browser.'
      : state.origin === 'server'
        ? 'Using the server key. Paste a local override if needed.'
        : 'No key saved in this browser.';
  }

  if (ctx.dom.serviceRegistrationState) {
    ctx.dom.serviceRegistrationState.className = `statusPill ${state.configured ? 'ok' : 'warning'}`;
    ctx.dom.serviceRegistrationState.textContent = configuredText;
  }

  if (ctx.dom.serviceRegistrationMasked) {
    ctx.dom.serviceRegistrationMasked.hidden = !state.masked;
    ctx.dom.serviceRegistrationMasked.textContent = state.masked || '';
  }

  if (ctx.dom.serviceRegistrationKeyInput) {
    ctx.dom.serviceRegistrationKeyInput.placeholder = state.origin === 'local'
      ? `Paste a new ${label} key to replace the saved local key`
      : state.origin === 'server'
        ? `Paste a local ${label} override if you want one in this browser`
        : `Paste ${label} API key or local override`;
  }

  if (ctx.dom.serviceRegistrationSave) {
    ctx.dom.serviceRegistrationSave.textContent = state.configured ? 'Replace key' : 'Add and validate';
  }

  if (ctx.dom.serviceRegistrationTest) {
    ctx.dom.serviceRegistrationTest.textContent = 'Test key';
  }

  if (ctx.dom.serviceRegistrationDelete) {
    ctx.dom.serviceRegistrationDelete.disabled = state.origin !== 'local';
  }

  if (ctx.dom.serviceRegistrationHint) {
    ctx.dom.serviceRegistrationHint.textContent = state.origin === 'local'
      ? 'Saved locally in this browser. Do not use this on a shared computer.'
      : state.origin === 'server'
        ? 'This browser can override the server key locally if needed.'
        : 'Saved locally in this browser. Do not use this on a shared computer.';
  }
}

export function updatePauseButton(ctx) {
  const button = ctx.dom.pauseAi;
  const paused = Boolean(ctx.state.paused);
  if (ctx.dom.pauseAiLabel) {
    ctx.dom.pauseAiLabel.textContent = paused ? 'Resume' : 'Pause';
  }
  button.setAttribute('aria-pressed', String(paused));
  button.classList?.toggle?.('is-paused', paused);
  ctx.dom.panel?.classList?.toggle?.('is-paused', paused);
}

export function updateClearButton(ctx) {
  const button = ctx.dom.clear;
  if (!button) return;
  const armed = Boolean(ctx.state.clearArmed);
  if (ctx.dom.clearLabel) {
    ctx.dom.clearLabel.textContent = armed ? 'Confirm?' : 'Clear';
  }
  button.setAttribute('aria-label', armed ? 'Confirm clear all lines' : 'Clear all lines');
  button.title = armed ? 'Confirm clear all lines' : 'Clear all lines';
  button.classList?.toggle?.('is-armed', armed);
}

function updateSliderFill(input) {
  if (!input) return;
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const percent = ((Number(input.value) - min) / Math.max(1, max - min)) * 100;
  input.style.setProperty('--slider-fill', `${Math.min(100, Math.max(0, percent))}%`);
}

export function updateSummaryIntervalControl(ctx) {
  if (!ctx.dom.summaryIntervalInput || !ctx.dom.summaryIntervalValue) return;
  // #56. The unusable part of the range is removed rather than labelled: at this reader's measured
  // pace every position below this one derives a card budget under the floor, and a caption is not
  // a guard. The floor moves with the measurement, so a faster profile gives the range back.
  const floor = usableIntervalFloor(ctx);
  ctx.dom.summaryIntervalInput.min = String(floor);
  ctx.dom.summaryIntervalInput.setAttribute?.('min', String(floor));
  ctx.dom.summaryIntervalInput.value = String(ctx.state.summaryIntervalSeconds);
  ctx.dom.summaryIntervalInput.setAttribute('aria-valuetext', `${ctx.state.summaryIntervalSeconds}s`);
  ctx.dom.summaryIntervalValue.textContent = `${ctx.state.summaryIntervalSeconds}s`;
  updateSliderFill(ctx.dom.summaryIntervalInput);
}

function pluraliseWords(count) {
  return `${count} ${count === 1 ? 'word' : 'words'}`;
}

export function updateSummaryMaxWordsControl(ctx) {
  if (!ctx.dom.summaryMaxWordsInput || !ctx.dom.summaryMaxWordsValue) return;
  // The thumb position clamps into the slider's own range even when the true derived number sits
  // outside it (e.g. a below-floor pace deriving 3 words) -- the text below still shows the honest
  // true figure, this is only where the handle can physically sit.
  ctx.dom.summaryMaxWordsInput.value = String(clampSummaryMaxWordsOverride(ctx.state.summaryMaxWords));
  // The TRUE budget, not the clamped one, whenever the two differ. At 30 wpm every interval from 2s
  // to 15s clamped up to the same 11 and was displayed as "11 words", so the number on screen was
  // false across the entire usable range of the control that produces it -- and the operator pushing
  // that control saw nothing move. A derived figure that cannot be trusted is worse than the two
  // independent dials it replaced, because it looks authoritative.
  // Read, never recomputed. runtime.js's recomputeSummaryMaxWords owns this number.
  const budget = ctx.state.readingBudget;
  // Three states, not two. Ansel's ruling: a budget sitting exactly on the floor must not read as
  // comfortable, because the live configuration lands there and rounding in the measured pace flips
  // the verdict with nothing changing about how readable the card actually is.
  const text = budget?.belowFloor
    ? `${pluraliseWords(Math.max(1, Math.round(budget.rawWords)))}, too short for this reader`
    : budget?.marginal
      ? `${pluraliseWords(ctx.state.summaryMaxWords)}, only just enough`
      : `${pluraliseWords(ctx.state.summaryMaxWords)}`;
  ctx.dom.summaryMaxWordsInput.setAttribute('aria-valuetext', text);
  ctx.dom.summaryMaxWordsValue.textContent = text;
  ctx.dom.summaryMaxWordsValue.classList.toggle('is-belowFloor', Boolean(budget?.belowFloor));
  ctx.dom.summaryMaxWordsValue.classList.toggle('is-marginal', Boolean(budget?.marginal));
  updateSliderFill(ctx.dom.summaryMaxWordsInput);
}

export function syncViewerControls(ctx) {
  ctx.dom.fontSizeInput.value = String(sliderPositionFromFontSize(ctx.state.fontSize));
  ctx.dom.fontSizeInput.setAttribute('aria-valuetext', `${ctx.state.fontSize}px`);
  ctx.dom.fontSizeValue.textContent = `${ctx.state.fontSize}px`;
  updateSliderFill(ctx.dom.fontSizeInput);
  ctx.dom.displayMarginInput.value = String(ctx.state.displayMargin);
  ctx.dom.displayMarginValue.textContent = `${ctx.state.displayMargin.toFixed(1)}%`;
  updateSliderFill(ctx.dom.displayMarginInput);
  updateSummaryIntervalControl(ctx);
  updateSummaryMaxWordsControl(ctx);
  updateDisplayMarginGuides(ctx);
}

export function applyViewerSettings(ctx) {
  document.documentElement.style.setProperty('--font-size', `${ctx.state.fontSize}px`);
  document.documentElement.style.setProperty('--display-margin', `${ctx.state.displayMargin}%`);
  updateDisplayMarginGuides(ctx);
}

export function setDisplayMarginGuidesVisible(ctx, visible) {
  ctx.state.displayMarginGuidesVisible = Boolean(visible);
  updateDisplayMarginGuides(ctx);
}

export function syncSettingsPanel(ctx) {
  const alerts = buildAlerts(ctx);
  const hasAlerts = alerts.length > 0;

  if (ctx.dom.settingsAlertBadge) {
    ctx.dom.settingsAlertBadge.hidden = !hasAlerts;
  }

  if (ctx.dom.settingsButton) {
    const label = hasAlerts ? 'Open settings, alerts waiting' : 'Open settings';
    ctx.dom.settingsButton.setAttribute('aria-label', label);
    ctx.dom.settingsButton.title = label;
  }

  if (ctx.dom.alertsSection) {
    ctx.dom.alertsSection.hidden = !hasAlerts;
  }

  if (ctx.dom.apiWarning) {
    ctx.dom.apiWarning.hidden = !hasAlerts;
    ctx.dom.apiWarning.textContent = hasAlerts ? alerts.map((alert) => alert.message).join(' ') : '';
  }

  // This runs on every alert-relevant state change, not just on opening Settings or clicking a nav
  // tab -- an alert can appear or clear while the dialog is already open on a different tab, so the
  // Alerts tab's own visibility has to be kept live here too, not only in setSettingsSection.
  const alertsNavButton = (ctx.dom.settingsNavButtons || []).find((button) => button.dataset?.settingsNav === 'alerts');
  if (alertsNavButton) {
    alertsNavButton.hidden = !hasAlerts;
  }
  // An alert clearing while its tab is the active one would otherwise leave the operator on a
  // hidden tab looking at a blank panel -- fall back to the same default landing section instead.
  if (!hasAlerts && ctx.state.settingsSection === 'alerts') {
    setSettingsSection(ctx, DEFAULT_SETTINGS_SECTION);
  }

  updateSourceButtons(ctx);
  syncServiceRegistration(ctx);
  renderReadyCheck(ctx);
}

// Plain-language, one per distinct not-ready cause (docs/backlog.md item 1) -- each names the next
// step for a helper under time pressure who is not an audio engineer, rather than one blanket line
// that describes a browser-capability gap when the real problem is a blocked permission or an
// unplugged mic.
const MIC_FIX_TEXT = {
  unsupported: 'This browser can\'t listen with its own speech recognition. Choose OpenAI transcription or type lines manually.',
  denied: 'Microphone access is blocked for this browser. Allow it in your browser or system privacy settings, then reopen Settings.',
  'no-device': 'No microphone was found. Plug one in or check your system sound settings, then reopen Settings.',
  unknown: 'Microphone hasn\'t been checked yet. Reopen Settings, or click Test, to check it.'
};

export function renderReadyCheck(ctx) {
  const mic = checkMicReady(ctx);
  renderReadyCheckRow(ctx.dom.readyCheckMicDot, ctx.dom.readyCheckMicFix, mic.ready, {
    fix: MIC_FIX_TEXT[mic.reason] || ''
  });

  const activeSummaryProvider = ctx.state.summarizationSource === 'claude' ? 'claude' : 'openai';
  renderReadyCheckRow(ctx.dom.readyCheckAiDot, ctx.dom.readyCheckAiFix, checkAiReady(ctx), {
    fix: activeSummaryProvider === 'claude'
      ? 'Claude key is missing. Add one in AI services, or switch to OpenAI.'
      : 'OpenAI key is missing. Add one in AI services, or switch to Claude.'
  });

  renderReadyCheckRow(ctx.dom.readyCheckDisplayDot, ctx.dom.readyCheckDisplayFix, true, { fix: '' });
}

// Real state, not a feature-detect: both the browser-speech and OpenAI transcription paths open
// a real getUserMedia stream (transcription/openai.js does it too, for the same audio graph the
// mic test probes), so this row reflects actual permission + device state -- refreshed
// asynchronously onto ctx.state.micReady/micReadyReason by runtime.js#refreshMicReadiness -- not
// merely whether the Web Speech API exists. The one case that IS a pure capability gap: the
// browser transcription source with no Web Speech API at all, which no mic permission can fix.
function checkMicReady(ctx) {
  if (ctx.state.transcriptionSource === 'browser' && !browserSpeechAvailable()) {
    return { ready: false, reason: 'unsupported' };
  }
  if (ctx.state.micReady) return { ready: true, reason: null };
  return { ready: false, reason: ctx.state.micReadyReason || 'unknown' };
}

function checkAiReady(ctx) {
  const activeSummaryProvider = ctx.state.summarizationSource === 'claude' ? 'claude' : 'openai';
  return activeSummaryProvider === 'claude' ? Boolean(ctx.state.anthropicReady) : Boolean(ctx.state.openAiReady);
}

function renderReadyCheckRow(dot, fixNode, ready, { fix } = {}) {
  if (dot) {
    dot.classList?.toggle?.('is-ready', ready);
    dot.classList?.toggle?.('is-not-ready', !ready);
  }
  if (fixNode) {
    fixNode.textContent = ready ? '' : fix || '';
    fixNode.hidden = ready;
  }
}

// Per-meeting program list (Steve's spec, 2026-08-17): typed fresh each meeting, no persistence --
// see ctx.state.program in start-app.js. This module only renders rows from state; start-app.js
// owns the delegated listeners (add/remove/edit), same split as the transcript-delete button below.
export function renderProgramPanel(ctx) {
  const container = ctx.dom.programList;
  if (!container) return;
  const entries = Array.isArray(ctx.state.program) ? ctx.state.program : [];
  const rows = entries.map((entry, index) => buildProgramRow(entry, index));
  if (typeof container.replaceChildren === 'function') {
    container.replaceChildren(...rows);
  } else {
    container.children = rows;
  }
}

function buildProgramRow(entry, index) {
  const row = createNode('div');
  row.className = 'programRow';
  setDataAttribute(row, 'programIndex', index);

  const nameInput = createNode('input');
  nameInput.type = 'text';
  nameInput.className = 'programRowName';
  nameInput.value = entry.name || '';
  nameInput.placeholder = 'Name';
  if (typeof nameInput.setAttribute === 'function') {
    nameInput.setAttribute('aria-label', 'Program entry name');
  }

  const modeSelect = createNode('select');
  modeSelect.className = 'programRowMode';
  if (typeof modeSelect.setAttribute === 'function') {
    modeSelect.setAttribute('aria-label', 'Program entry mode');
  }
  const options = PROGRAM_MODE_OPTIONS.map((opt) => {
    const option = createNode('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === entry.mode && typeof option.setAttribute === 'function') {
      option.setAttribute('selected', '');
    }
    option.selected = opt.value === entry.mode;
    return option;
  });
  if (typeof modeSelect.append === 'function') {
    modeSelect.append(...options);
  } else {
    modeSelect.children = options;
  }
  modeSelect.value = entry.mode || 'speaker';

  const removeBtn = createNode('button');
  removeBtn.type = 'button';
  removeBtn.className = 'programRowRemove';
  removeBtn.textContent = 'Remove';
  if (typeof removeBtn.setAttribute === 'function') {
    removeBtn.setAttribute('aria-label', 'Remove program entry');
  }

  row.append(nameInput, modeSelect, removeBtn);
  return row;
}

// Filtered by the CURRENT mode (Steve: generic across all four, no special-casing Info) -- refreshed
// on every mode change and every program-list edit, never persisted alongside it. Native <datalist>
// prefill only; selecting an option never sends anything on its own.
export function updateSpeakerDatalist(ctx) {
  const datalist = ctx.dom.speakerNameDatalist;
  if (!datalist) return;
  const entries = Array.isArray(ctx.state.program) ? ctx.state.program : [];
  const options = entries
    .filter((entry) => entry && entry.mode === ctx.state.mode && entry.name)
    .map((entry) => {
      const option = createNode('option');
      option.value = entry.name;
      return option;
    });
  if (typeof datalist.replaceChildren === 'function') {
    datalist.replaceChildren(...options);
  } else {
    datalist.children = options;
  }
}

// A standalone line marking a mode change, inserted as its own sibling in the stack rather than a
// border on the card that follows it -- see the call site in renderDisplay for why. Reuses the same
// per-mode --card-accent custom property every card already sets (transcript-item--<mode> in
// layout.css), via the class the divider carries, rather than a second color system to keep in sync.
function createModeDividerNode(mode) {
  const divider = createNode('div');
  divider.className = `transcript-mode-divider transcript-item--${mode || 'speaker'}`;
  if (typeof divider.setAttribute === 'function') {
    divider.setAttribute('aria-hidden', 'true');
  }
  return divider;
}

function createTranscriptCard(item, active = false, { showSpeaker = false, speaker = '', isSpeakerAlt = false } = {}) {
  const isManual = item.source === 'manual';
  const isSample = Boolean(item.sample);
  // Operator-authored header card (program-tab send button): icon + mode label + the text, and
  // NOTHING else -- no timestamp, no speaker-name row, no flowing-prose body styling. Pushed through
  // the same addLine/commitItems pipeline as any other manual card, distinguished only by this flag.
  const isHeader = Boolean(item.isHeader);
  // Song is the one mode meant to be typed, not heard (see runtime.js#setMode) -- a hand-typed hymn
  // line should read as a song card, not fall back to the generic "Manual" badge every other
  // hand-typed mode gets to signal "a human wrote this, not the AI."
  const isManualSong = isManual && item.mode === 'song';
  // A header card always shows its OWN mode (Speaker/Info/Song/Prayer), same reasoning as
  // isManualSong above -- it is the operator naming what's coming next, not a generic "Manual" note.
  const isManualException = isManualSong || isHeader;
  const visualMode = isManual && !isManualException ? 'manual' : item.mode || 'speaker';
  const modeMeta = isManual && !isManualException ? MANUAL_META : MODE_META[item.mode] || MODE_META.speaker;
  const article = createNode('article');
  article.className = `transcript-item transcript-item--${visualMode}`
    // isManualException is excluded here too -- it already gets transcript-item--<mode> from
    // visualMode above, and adding --manual as well let its --card-accent win on source order
    // (layout.css defines .transcript-item--manual after the mode classes), silently overriding the
    // mode accent color the comment above says this card should have.
    + `${isManual && !isManualException ? ' transcript-item--manual' : ''}`
    + `${isSample ? ' transcript-item--sample' : ''}`
    // Exploratory (Steve unsure, easy to revert -- see SPEAKER_ALTERNATION_ENABLED in renderDisplay):
    // same-mode speaker change within Speaker mode alone had no visual marker either, so consecutive
    // speaker cards alternate between two accent shades whenever item.speaker changes.
    + `${isSpeakerAlt ? ' transcript-item--speaker-alt' : ''}`
    + `${isHeader ? ' transcript-item--header' : ''}`;
  setDataAttribute(article, 'mode', visualMode);
  setDataAttribute(article, 'source', item.source || 'ai');
  setDataAttribute(article, 'active', String(active));
  article.dataset.mode = visualMode;
  article.dataset.source = item.source || 'ai';
  article.dataset.active = String(active);
  if (isSample) {
    setDataAttribute(article, 'sample', 'true');
  }
  if (article.classList?.add && isSample) {
    article.classList.add('transcript-item--sample');
  }

  const meta = createNode('div');
  meta.className = 'transcript-meta';

  const icon = createNode('span');
  icon.className = `transcript-icon ${modeMeta.icon}`;
  if (typeof icon.setAttribute === 'function') {
    icon.setAttribute('aria-hidden', 'true');
  }
  meta.append(icon);

  const label = createNode('span');
  label.className = 'transcript-meta-label';
  label.textContent = modeMeta.label;
  meta.append(label);

  // A header card folds its text into the label row itself ("Speaker  James Lovett"), at the same
  // compact meta scale as the label -- not a separate paragraph at the giant reading-card font size.
  // The first version of this got that wrong: it rendered item.text as its own <p> body element
  // sharing --font-size with a normal summary card's flowing text, so a one-word name came out at
  // full display scale below the label instead of sitting compactly beside it. Steve caught this
  // live: "That divider doesn't look like a divider."
  if (isHeader && item.text) {
    const value = createNode('span');
    value.className = 'transcript-meta-value';
    value.textContent = item.text;
    meta.append(value);
  }

  // Issue #40: rendered as its own node alongside the mode label, never woven into transcript-text
  // -- a display attribute, not something the summarizer's text passed through. Only present at
  // all when this card is where the speaker changed (showSpeaker), computed by the caller so this
  // function stays a pure per-item renderer with no knowledge of what came before it.
  // A header card gets neither of these: icon + mode label + text and nothing else, per spec.
  if (!isHeader && showSpeaker && speaker) {
    const speakerLabel = createNode('span');
    speakerLabel.className = 'transcript-speaker';
    speakerLabel.textContent = speaker;
    meta.append(speakerLabel);
  }

  if (!isHeader && item.createdAt) {
    const time = createNode('time');
    time.className = 'transcript-time';
    time.dateTime = new Date(item.createdAt).toISOString();
    time.textContent = new Date(item.createdAt).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      // Seconds are here for measuring pipeline delay during testing: the gap between
      // a line being spoken and its card appearing is the number we are tuning, and
      // minute resolution hides all of it.
      second: '2-digit'
    });
    meta.append(time);
  }

  // Header cards have no body at all -- their text lives in the meta row's value span above.
  if (isHeader) {
    article.append(meta);
  } else {
    const body = createNode('p');
    body.className = 'transcript-text';
    body.textContent = item.text || '';
    article.append(meta, body);
  }

  // The sample placeholder isn't a real captured line -- nothing to delete. Every other card gets
  // a delete button; it stays visually hidden until the card is hovered/focused (see layout.css),
  // and carries the item id so the delegated handler in start-app.js knows which one to remove.
  if (!isSample) {
    setDataAttribute(article, 'itemId', item.id);
    const deleteBtn = createNode('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'transcript-delete';
    if (typeof deleteBtn.setAttribute === 'function') {
      deleteBtn.setAttribute('aria-label', 'Delete this card');
    }
    const deleteIcon = createNode('span');
    deleteIcon.className = 'transcript-delete-icon';
    if (typeof deleteIcon.setAttribute === 'function') {
      deleteIcon.setAttribute('aria-hidden', 'true');
    }
    deleteBtn.append(deleteIcon);
    article.append(deleteBtn);
  }

  return article;
}

function syncBrowserPanel(ctx, refs) {
  const pending = ctx.state.pendingProviderSelection;
  const browserPending = pending?.kind === 'transcription' && pending?.source === 'openai';
  if (refs.panel) {
    refs.panel.hidden = !(ctx.state.transcriptionSource === 'browser' && !browserPending);
  }
  if (refs.description) {
    refs.description.textContent = browserSpeechAvailable()
      ? 'Browser speech stays local and uses the built-in microphone.'
      : 'Browser speech recognition is not available in this browser.';
  }
}

function isProviderPanelVisible(ctx, kind, source) {
  const pending = ctx.state.pendingProviderSelection;
  if (kind === 'transcription') {
    return ctx.state.transcriptionSource === source || (pending?.kind === kind && pending?.source === source);
  }
  if (kind === 'summarization') {
    return ctx.state.summarizationSource === source || (pending?.kind === kind && pending?.source === source);
  }
  return false;
}

function isSourceUnavailable(ctx, kind, source) {
  if (kind === 'transcription') {
    if (source === 'demo') return false;
    if (source === 'browser') return !browserSpeechAvailable();
    return !getProviderState(ctx, kind, source).configured;
  }

  return !getProviderState(ctx, kind, source).configured;
}

function syncProviderCard(ctx, provider, refs, visible = true) {
  const state = ctx.state.providerKeys?.[provider] || {
    configured: false,
    origin: 'missing',
    label: 'Needs key',
    masked: ''
  };

  if (refs.panel) {
    refs.panel.hidden = !visible;
  }

  if (refs.description) {
    refs.description.textContent = state.origin === 'local'
      ? 'Saved locally in this browser.'
      : state.origin === 'server'
        ? 'Using the server key. Paste a local override if needed.'
        : 'No key saved in this browser.';
  }

  if (refs.state) {
    refs.state.className = `statusPill ${state.configured ? 'ok' : 'warning'}`;
    refs.state.textContent = state.label;
  }

  if (refs.masked) {
    refs.masked.hidden = !state.masked;
    refs.masked.textContent = state.masked || '';
  }

  if (refs.input) {
    refs.input.placeholder = state.origin === 'local'
      ? 'Paste a new key to replace the saved local key'
      : state.origin === 'server'
        ? 'Paste a local override if you want one in this browser'
        : 'Paste API key or local override';
  }

  if (refs.remove) {
    refs.remove.disabled = state.origin !== 'local';
  }

  if (refs.save) {
    refs.save.textContent = state.origin === 'local' ? 'Replace key' : 'Save key';
  }

  if (refs.test) {
    refs.test.textContent = 'Test key';
  }
}

function updateProviderOptionLabel(button, ctx, kind, source, options = {}) {
  if (!button) return;
  const state = getProviderState(ctx, kind, source);
  const statusNode = typeof button.querySelector === 'function'
    ? button.querySelector('.providerStatus')
    : null;
  if (statusNode) {
    statusNode.textContent = state.label;
  } else if (typeof button.textContent === 'string' && button.dataset?.statusLabel) {
    button.textContent = button.dataset.statusLabel.replace('{status}', state.label);
  }
  button.dataset.configured = String(state.configured);
  button.dataset.origin = state.origin;
  if (kind === 'transcription' && source === 'browser') {
    button.disabled = !browserSpeechAvailable();
  }
}

function updateRegistrationButton(button, ctx, provider, activeProvider) {
  if (!button) return;
  const state = getProviderState(ctx, 'summarization', provider);
  const statusNode = typeof button.querySelector === 'function'
    ? button.querySelector('.providerStatus')
    : null;
  if (statusNode) {
    statusNode.textContent = state.label;
  }
  button.classList.toggle('active', provider === activeProvider);
  button.setAttribute('aria-pressed', String(provider === activeProvider));
  button.dataset.configured = String(state.configured);
  button.dataset.origin = state.origin;
}

function getRegistrationProvider(ctx) {
  const pending = ctx.state.pendingProviderSelection;
  if (pending?.provider === 'openai' || pending?.provider === 'claude') {
    return pending.provider;
  }

  if (ctx.state.registrationProvider === 'openai' || ctx.state.registrationProvider === 'claude') {
    return ctx.state.registrationProvider;
  }

  const openAiState = getProviderState(ctx, 'summarization', 'openai');
  const claudeState = getProviderState(ctx, 'summarization', 'claude');
  if (!openAiState.configured) return 'openai';
  if (!claudeState.configured) return 'claude';
  return 'openai';
}

function getProviderState(ctx, kind, source) {
  // The demo source depends on nothing -- no microphone, no key, no network -- so it is the one
  // source that is always configured. That is the whole point of it: there is always a way to see
  // the display working before a meeting starts.
  if (kind === 'transcription' && source === 'demo') {
    return { configured: true, origin: 'local', label: 'Sample meeting' };
  }

  if (kind === 'summarization' && source === 'demo') {
    return { configured: true, origin: 'local', label: 'No key needed' };
  }

  if (kind === 'transcription' && source === 'browser') {
    return {
      configured: browserSpeechAvailable(),
      origin: 'local',
      label: browserSpeechAvailable() ? 'Local' : 'Unavailable'
    };
  }

  // Mirrors provider-availability.js's isSourceConfigured gate for replay: it needs an actual
  // recording on disk, so with none it is not just unconfigured, there is nothing to pick.
  if (kind === 'transcription' && source === 'replay') {
    const hasRecordings = Boolean(ctx.state.availableRecordings?.length);
    return {
      configured: hasRecordings,
      origin: 'local',
      label: hasRecordings ? 'Recorded session' : 'No recordings yet'
    };
  }

  if (source === 'openai') {
    return ctx.state.providerKeys?.openai || {
      configured: Boolean(ctx.state.serverOpenAiReady),
      origin: Boolean(ctx.state.serverOpenAiReady) ? 'server' : 'missing',
      label: Boolean(ctx.state.serverOpenAiReady) ? 'Configured on server' : 'Needs key',
      masked: ''
    };
  }

  if (source === 'claude') {
    return ctx.state.providerKeys?.claude || {
      configured: Boolean(ctx.state.serverAnthropicReady),
      origin: Boolean(ctx.state.serverAnthropicReady) ? 'server' : 'missing',
      label: Boolean(ctx.state.serverAnthropicReady) ? 'Configured on server' : 'Needs key',
      masked: ''
    };
  }

  return {
    configured: false,
    origin: 'missing',
    label: 'Needs key'
  };
}

// An unconfigured provider is only an alert when something currently selected actually needs it.
// This used to alert on every provider that had no key, which meant an operator running OpenAI and
// browser transcription was permanently told "Claude key is missing" about a provider they had never
// selected and may never use. That is not an error, it is a fact about a road not taken -- and a
// standing alert nobody can clear teaches the operator to ignore the alert surface, which is exactly
// what INV-10 exists to prevent. The settings panel still shows every provider's "Needs key" state;
// that is where you go to learn what is unconfigured. An alert is for something wrong right now.
function providersInUse(ctx) {
  const inUse = new Set();
  if (ctx.state.transcriptionSource === 'openai') inUse.add('openai');
  if (ctx.state.summarizationSource === 'openai') inUse.add('openai');
  if (ctx.state.summarizationSource === 'claude') inUse.add('anthropic');
  return inUse;
}

function buildAlerts(ctx) {
  const alerts = [];
  const inUse = providersInUse(ctx);

  if (inUse.has('openai') && !ctx.state.openAiReady) {
    alerts.push({
      provider: 'openai',
      // Alternatives named here are REAL ones only. Demo is deliberately never offered as a remedy:
      // it replays a rehearsal script, so on a live display it would show text nobody said. See the
      // note in services/response.js -- manual typing is the sanctioned live fallback, not demo.
      message: ctx.state.transcriptionSource === 'openai'
        ? 'OpenAI is selected but has no key. Add one in AI services, or switch transcription to Browser.'
        : 'OpenAI is selected for summaries but has no key. Add one in AI services, or switch summaries to Claude.'
    });
  }

  if (inUse.has('anthropic') && !ctx.state.anthropicReady) {
    alerts.push({
      provider: 'claude',
      message: 'Claude is selected for summaries but has no key. Add one in AI services, or switch summaries to OpenAI.'
    });
  }

  // A confirmed run of summarize failures (escalateSummarizeFailure, three in a row) is a real,
  // separate condition from "no key configured" above -- it can fire even with a working key
  // (rate limits, an outage) and even in manual-only/demo setups with no provider selected at all.
  // It MUST be counted here, in the one function both the badge and the visible alerts list are
  // built from: this used to be pushed straight onto the DOM by escalateSummarizeFailure/
  // clearSummarizeFailureAlert, bypassing this list entirely, so re-opening Settings (which
  // recomputes the alerts SECTION's visibility from this function alone) could hide the section
  // while the badge -- set by that separate direct write -- stayed lit. One list now drives both.
  if (ctx.state.summarizeFailureAlertActive) {
    alerts.push({
      provider: 'summarize-failure',
      message: 'AI summaries are failing. Manual lines still work.'
    });
  }

  return alerts;
}

export function browserSpeechAvailable() {
  return Boolean(globalThis.window?.SpeechRecognition || globalThis.window?.webkitSpeechRecognition);
}

function isTranscriptNearBottom(viewport, threshold = 96) {
  if (!viewport) return true;
  const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  return remaining <= threshold;
}

function createNode(tagName) {
  if (globalThis.document?.createElement) {
    return globalThis.document.createElement(tagName);
  }

  return {
    tagName: tagName.toUpperCase(),
    children: [],
    className: '',
    dataset: {},
    attributes: {},
    textContent: '',
    dateTime: '',
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    scrollIntoView() {}
  };
}

function setDataAttribute(node, name, value) {
  if (!node) return;
  if (node.dataset) {
    node.dataset[name] = String(value);
  }
  if (typeof node.setAttribute === 'function') {
    node.setAttribute(`data-${name}`, value);
  }
}

function updateDisplayMarginGuides(ctx) {
  if (!ctx.dom.display) return;
  setDataAttribute(ctx.dom.display, 'marginGuides', ctx.state.displayMarginGuidesVisible ? 'true' : 'false');
}
