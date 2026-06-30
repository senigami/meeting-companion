# Findings

## DC-001: Progressive disclosure is missing for settings

| Field | Value |
|-------|-------|
| **Severity** | P3 - Polish |
| **Lanes / Framework** | B (H8) + C (C1, C4) + D (Apple HIG - Deference, Single Prominent Action) + E (E2, E4, E10) |
| **Location** | `public/index.html:33-101` and `public/style.css:119-177` |
| **Effort** | M |
| **Theme impact** | Low |

**Issue:** The panel presents viewer controls, update interval, mode, transcription source, and summary source as a single flat block of equally weighted sections. That makes the helper scan too many choices at the same level, which is exactly the situation progressive disclosure is meant to avoid. The user asked for transcription source and summary source to live in settings so they are not constantly visible; the current structure does the opposite.

**Current:**
```html
<div class="section">
  <div class="section-label">Update interval</div>
  <div class="interval-row" role="group" aria-label="Update interval">
    <button type="button" data-interval="2" class="interval">2s</button>
    <button type="button" data-interval="5" class="interval active" aria-pressed="true">5s</button>
    <button type="button" data-interval="10" class="interval">10s</button>
    <button type="button" data-interval="15" class="interval">15s</button>
  </div>
</div>

<div class="section">
  <div class="section-label">Transcription source</div>
  <div class="source-row" role="group" aria-label="Transcription source">
    <button type="button" data-kind="transcription" data-source="browser" class="source active" aria-pressed="true">Browser</button>
    <button type="button" data-kind="transcription" data-source="openai" class="source" aria-pressed="false">OpenAI</button>
  </div>
</div>

<div class="section">
  <div class="section-label">Summary source</div>
  <div class="source-row" role="group" aria-label="Summary source">
    <button type="button" data-kind="summarization" data-source="openai" class="source active" aria-pressed="true">OpenAI</button>
    <button type="button" data-kind="summarization" data-source="claude" class="source" aria-pressed="false">Claude</button>
  </div>
</div>
```

**Fix:**
```html
<section class="section primary-controls">
  <!-- immediate actions and viewer adjustments stay visible -->
</section>

<details class="section settings">
  <summary>Settings</summary>
  <div class="section">
    <div class="section-label">Update interval</div>
    ...
  </div>
  <div class="section">
    <div class="section-label">Transcription source</div>
    ...
  </div>
  <div class="section">
    <div class="section-label">Summary source</div>
    ...
  </div>
</details>
```

**Why it matters:** This reduces decision cost, improves scan speed, and gives the helper a cleaner distinction between "what I need right now" and "what I set once and mostly leave alone." It aligns with Apple HIG deference/depth, Nielsen H8, and Gestalt grouping.

---

## DC-002: Diagnostics still compete with live controls

| Field | Value |
|-------|-------|
| **Severity** | P3 - Polish |
| **Lanes / Framework** | C (C3, C4) + D (Apple HIG - Deference) + E (E1, E4, E8) |
| **Location** | `public/index.html:119-132` and `public/style.css:315-320` |
| **Effort** | S-M |
| **Theme impact** | Low |

**Issue:** The status line and recent transcript are always visible on the same panel as the action controls. That makes the panel feel like one continuous stream of live data instead of a hierarchy of immediate controls plus secondary diagnostics. For a helper who is already juggling the meeting, this adds avoidable attention split.

**Current:**
```html
<div class="button-grid">
  <button id="summarizeOnce" type="button">Summarize once</button>
  <button id="startListening" type="button">Start listening</button>
  <button id="stopListening" type="button">Stop listening</button>
  <button id="pauseAi" type="button" aria-pressed="false">Pause AI</button>
  <button id="undo" type="button">Undo</button>
  <button id="clear" type="button">Clear</button>
  <button id="bigger" type="button">Bigger text</button>
  <button id="smaller" type="button">Smaller text</button>
  <button id="fullscreen" type="button">Fullscreen</button>
</div>

<div id="status" class="status" role="status">Manual mode is ready.</div>
<div id="liveTranscript" class="transcript" aria-label="Recent transcript"></div>
```

**Fix:**
```html
<section class="section">
  <div class="button-grid primary-actions">
    <!-- immediate actions only -->
  </div>
</section>

<details class="section diagnostics">
  <summary>Diagnostics</summary>
  <div id="status" class="status" role="status">Manual mode is ready.</div>
  <div id="liveTranscript" class="transcript" aria-label="Recent transcript"></div>
</details>
```

**Why it matters:** The live transcript and status are useful, but not equally urgent as the controls that start/stop the meeting flow. Moving them behind a secondary disclosure lowers cognitive load and improves the "squint test" without changing the visual theme.

## P3 - Polish (grouped)

| ID | Finding | Lane | Location | Effort | Note |
|----|---------|------|----------|--------|------|
| DC-001 | Progressive disclosure is missing for settings | B/C/D/E | `public/index.html:33-101`, `public/style.css:119-177` | M | Move transcription/summary source and interval into Settings. |
| DC-002 | Diagnostics still compete with live controls | C/D/E | `public/index.html:119-132`, `public/style.css:315-320` | S-M | Collapse status and transcript into a secondary diagnostics area. |

## P4 - Cosmetic (grouped)

| ID | Finding | Lane | Location | Note |
|----|---------|------|----------|------|
| None | No cosmetic-only findings worth filing separately | - | - | The current issues are structural, not pixel nits. |
