# Meeting Companion Display

A tiny local helper app for showing a five-line, large-print summary during a church meeting.

It is designed for a setup where a laptop is connected to a TV. The helper can manually add lines, or optionally use browser speech recognition and AI summarization.

## What it does

- Shows only five large-print lines on the TV.
- New lines appear at the bottom.
- Older lines move up.
- Helper can add manual lines instantly.
- Helper can choose modes: Speaker, Information, Song, Prayer.
- Helper can undo, clear, pause AI, and change text size.
- No database.
- No saved transcript by default.

## Run it

1. Install Node.js.
2. Open this folder in a terminal.
3. Run:

```bash
npm install
cp .env.example .env
npm start
```

4. Open:

```text
http://localhost:3000
```

5. Connect the laptop to the TV and make the browser fullscreen.
6. Press `H` to hide or show the helper panel.

## AI summarization

Manual mode works without an API key.

To enable AI summarization, edit `.env` and set:

```text
OPENAI_API_KEY=your_api_key_here
```

Then restart the app.

## Speech recognition

The current prototype uses the browser's Web Speech API when available. It is easiest to test in Chrome or Edge. If speech recognition is not available, use manual input or paste text and click **Summarize Once**.

## Suggested Sunday workflow

1. Start with manual mode.
2. Use the mode buttons to tell the app what is happening.
3. During a talk, use Speaker mode.
4. During announcements, use Information mode.
5. During a hymn, use Song mode.
6. During prayer, use Prayer mode.
7. If AI output is wrong, click Undo and type a manual line.

## Privacy note

This app does not intentionally save transcripts or audio. If AI summarization is enabled, recent transcript text is sent to the AI provider for summarization.
