# Meeting Companion Memory Rules

- `docs/00-index.md` is the product-spec index and wins over chat when behavior drifts.
- Update specs, tests, and docs in the same change when visible behavior changes.
- Keep source files small and split anything that starts to drift past 500 lines.
- Keep tests in `test/` with mirrored layout under the source tree.
- Preserve the local-first default: no audio or transcript persistence unless explicitly requested.
- Use `npm test --silent` and `git diff --check` for verification before handing work off.
- Refresh the screenshot after meaningful visual changes.
- Margin guides should only appear while the margin slider is actively being adjusted.
