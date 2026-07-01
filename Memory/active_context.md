# Active Context

- The app is currently a small local Express + plain HTML/CSS/JS project.
- The UI uses an Apple-inspired dark glass treatment with a dominant display panel, slim operator rail, and bottom manual bar.
- Demo mode is wired at `/?demo=1` for visual checks and screenshot refreshes.
- The display margin guides are intentionally temporary and should only appear while the slider is being adjusted.
- The current verified state is green under `npm test --silent`.
- The repo now has `.agent/rules.md` as the operating guide for reading and updating the local memory files.

## Guardrails

- Do not reintroduce large always-visible warning cards into the operator rail.
- Keep provider setup inside Settings.
- Keep docs, tests, and screenshots aligned with UI changes.
- Update the Memory files after verified changes so future sessions inherit the current state.
- Keep local state out of audio/transcript persistence by default.
