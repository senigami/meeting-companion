# 018 — Shortcut badge cleanup + keyboard polish

Status: done
Map links: P3, P8; invariants I2, I3, I8, I12. Depends on: 008, 011, 013, 014. Blocks: 020.

## Goal

Reconcile the visible shortcut hints with the final shortcut set and the desktop look: permanent letter badges on every button are TV-app chrome; on macOS, shortcuts live in tooltips.

## Steps

1. Remove the `.shortcutBadge` overlay spans from the rail buttons in `index.html` (Clear's was already removed in 013). Fold each shortcut into the button's `title` instead: e.g. `title="Undo (U)"`, `title="Pause AI (P)"`, mode buttons `title="Speaker (1)"` etc. Keep `aria-label`s intact; keep `aria-keyshortcuts` if present or add it (`aria-keyshortcuts="u"` etc.) — cheap and correct.
2. Verify the final shortcut set end-to-end (I8): `U` undo, `P` pause, `1–4` modes, `/` focus manual input, `Escape` close panels, `Ctrl/Cmd+Enter` summarize-once, no `C`, no `S/T/F` changes (leave Start/Stop/Fullscreen bindings exactly as they are today — do not add new ones).
3. Update any tests/`style.test.js` pins referencing `.shortcutBadge`; grid row pin `.quickControlsGrid button { grid-template-rows: 24px auto; }` may need updating if badge removal changes the row structure — state the change.
4. Confirm hit targets unaffected (I12).

## Acceptance criteria

- No permanent letter badges; hovering any control reveals its shortcut; every listed shortcut works; suite green with documented pin updates only.

## Out of scope

New shortcuts beyond `/`; a shortcut help overlay (explicitly rejected).
