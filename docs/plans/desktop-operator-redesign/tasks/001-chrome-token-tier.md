# 001 — Add the chrome token tier

Status: done
Map links: P2; invariants I3, I4. Depends on: nothing. Blocks: 002, 003, 007.

## Goal

Introduce the `--chrome-*` custom-property tier in `public/styles/base.css` `:root` so operator chrome can be restyled independently of the frozen TV tokens. Values in THIS task approximate the current look (aliases/near-current), so nothing visibly changes yet — task 007 swaps them to the macOS palette.

## Files

- `public/styles/base.css` — add tokens to the existing `:root` block.
- `test/public/style.test.js` — add one new test asserting the chrome tokens exist.

## Steps

1. In `:root`, below the existing tokens, add (initial values chosen to match today's effective chrome look — sample the dominant values used in `controls.css`/`settings.css`, e.g. panel fill `rgba(22, 25, 33, 0.78)`):
   `--chrome-bg`, `--chrome-bg-elevated`, `--chrome-bg-control`, `--chrome-bg-control-hover`, `--chrome-separator`, `--chrome-text`, `--chrome-text-secondary`, `--chrome-accent` (alias `var(--accent)` for now), `--chrome-radius-sm`, `--chrome-radius-md`, `--chrome-radius-lg` (initially today's common radii, e.g. 12/16/24px), `--chrome-space-1: 4px` … `--chrome-space-5: 24px`, `--chrome-focus-ring-width: 2px`, `--chrome-focus-ring-offset: 1px`.
2. Do NOT change any existing token or any rule yet.
3. Add a test in `style.test.js` (new `test(...)` block, same regex style) asserting each `--chrome-` token name is declared.

## Acceptance criteria

- All new tokens declared once in `base.css :root`; no existing token or rule modified.
- App renders pixel-identical (tokens unused so far).
- `npm test` green, including the new token assertions.

## Out of scope

Consuming the tokens anywhere (002/003); changing token values to macOS palette (007).
