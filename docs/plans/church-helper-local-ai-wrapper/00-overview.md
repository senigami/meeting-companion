# Church Helper Local AI Wrapper - Overview

> **TL;DR:** Keep the app tiny and local, but make transcription and summarization modular so browser, OpenAI, and Claude sources can be swapped or extended without changing the display controller.

## Goal

The app should run as a local Express site with a five-line display, a helper panel, and a standardized provider wrapper for transcription and summarization.

## Scope & boundary

In scope: modular source catalog and registry, browser, OpenAI, and Claude drivers, readable helper UI, keyboard shortcuts, docs/specs, and mirrored tests. Out of scope: React/Next migration, audio archiving, cloud sync, or a general meeting platform.

## Constraints

- Keep the app runnable with `npm start`.
- Keep the source ids stable.
- Keep the display limited to five large-print lines.
- Do not save audio or transcripts by default.
- Keep tests in a separate tree that mirrors the source layout.

## Success criteria

- The browser and OpenAI transcription sources both work through the same standardized wrapper.
- The OpenAI and Claude summarizers work through the same wrapper and only emit useful, specific lines.
- The helper panel can be used by keyboard under pressure.
- The docs and tests match the actual code layout and behavior.
