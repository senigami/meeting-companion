# Scope

> **TL;DR:** This app is a local church accessibility helper, not a general meeting platform. It prioritizes one deaf and low-vision attendee, fast manual input, and short useful summaries over completeness.

## Overview

The app exists to replace a Word document that a helper manually updated during church meetings. It runs on a laptop connected to a TV and shows a large-print transcript stack for the person watching the screen.

The helper controls the app from the laptop. They can type a line manually, pick a mode, adjust text size, margins, and update interval, pause AI, undo, clear, and open Settings when they need to change transcription source, summarization source, or provider keys. In Settings, the source selectors only show services that are ready to use, and a separate registration card lets the helper add a provider key, validate it, and then use it in the source lists. Status and transcript tools live inside Settings behind a compact alert affordance rather than taking space in the live rail. The visible TV display stays label-light and focuses on separated transcript cards, not control chrome. Manual cards use a neutral human silhouette icon so they do not inherit the active mode icon from the current summary setting. The operator rail width is draggable from the divider between the display and controls and the chosen width persists in the browser.

The speech and summary behavior is intentionally narrow. Speaker mode summarizes the specific story, event, teaching, feeling, invitation, or example. Information mode prioritizes exact dates, times, places, hymn numbers, assignments, and announcements. Song mode only shows hymn or song status. Prayer mode compresses the prayer into a short prayer-shaped line that starts with a simple opening like "Heavenly Father" and ends with "Amen".

## In scope

- Large-print transcript-card TV output.
- Slim operator rail controls for manual typing, modes, view options, undo, clear, pause, fullscreen, and Settings access.
- Settings for transcription source, summarization source, service registration, alerts, and diagnostics.
- Browser transcription when the browser supports it.
- OpenAI transcription and OpenAI or Claude summarization when the relevant API key is configured on the local server or saved through Settings.
- Keyboard shortcuts for the helper workflow.
- Local storage only for UI preferences. Provider keys stay on the local server for the running session.

## Out of scope

- Multiple speakers, multi-user accounts, or saved session history.
- Audio recording or transcript archiving by default.
- A cloud dashboard, synchronization, or remote collaboration.
- Mobile-first responsive design beyond basic usability on the laptop helper screen.
- Next.js, React, or a broader application shell.

## Success boundary

The app is done when the helper can run it locally with `npm start`, keep the TV on the transcript-card display, and use the helper panel without needing to think about hidden state or background setup.
