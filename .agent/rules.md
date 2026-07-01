# Local Agent Rules

## Start Here

- Read `Memory/rules.md`, `Memory/state.json`, `Memory/active_context.md`, and `docs/00-index.md` before making assumptions.
- Use `Memory/session_logs.md` when you need the latest verified work or recent decisions.
- Treat `Memory/` as the shared durable project state, not as runtime app state.

## Keep Memory Updated

- After verified work lands, update `Memory/state.json` with the new focus, verified status, and any changed behavior.
- Append one concise note to `Memory/session_logs.md` for each verified work session.
- If UI behavior, contracts, or user-visible flows change, update the matching docs and specs in the same change.
- Keep the memory files factual, short, and current. Do not stash speculative ideas there.

## Working Rules

- Keep docs, tests, and code changes aligned in the same commit when behavior changes.
- Preserve the local-first default unless the user explicitly asks otherwise.
- Keep source files small and split anything that starts to drift past 500 lines.
