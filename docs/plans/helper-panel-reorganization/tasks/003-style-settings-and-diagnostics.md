# 003 — Style Settings And Diagnostics

- **Status:** not-started
- **Workload:** Visual Hierarchy
- **Effort:** M
- **Blocked by:** 002
- **Blocks:** 004

## Map Links

- **Parts touched:** P2, P3, P4, P5
- **Connections affected:** P5->P2/P3/P4 class contracts
- **Invariants that apply:** INV-5, INV-6, INV-7, INV-8

## Goal

Refine the helper panel visual hierarchy so primary controls are easier to scan and secondary sections feel intentional.

## Why This Matters

The current controls are functional but visually crowded. A cleaner hierarchy reduces operator hesitation without changing the local app model.

## Context An Executor Needs

- Edit `public/style.css`.
- Existing styles include the glassy fixed `.panel`, `.panel-main`, `.panel-footer`, `.section`, `.section-label`, `.mode-row`, `.source-row`, `.range-field`, `.button-grid`, `.manual-row`, active button styles, focus-visible styles, `.status`, and `.transcript`.
- The visual direction should remain Apple-inspired: calm material surfaces, clear spacing, soft shadows, and precise typography.
- Avoid making the controller UI look like a generic dashboard with too many bordered boxes.

## Target Shape / Contract

Add or adapt classes for:

- A primary control stack with more breathing room and clearer grouping.
- A visible view-options block for text size, margins, and summary interval.
- A compact Settings disclosure that reads as configuration, not a primary action.
- A Diagnostics disclosure that keeps status and transcript readable but secondary.
- Disclosure summary rows with obvious click/tap affordance and visible focus.
- Responsive behavior at laptop and smaller widths.

CSS should preserve:

- Existing active state visuals for `.mode`, `.source`, and `.interval` buttons.
- Existing range input usability for viewer controls.
- Existing `.panel.open`/hidden behavior.
- Existing high-contrast display readability.

## Steps

1. Review the final markup from task 002.
2. Add CSS classes for the new groupings and disclosure controls.
3. Adjust spacing so primary controls are visible without vertical clutter.
4. Ensure Settings and Diagnostics do not appear as equally important as primary controls when closed.
5. Preserve or improve `:focus-visible` treatment for buttons, inputs, summaries, and textareas.
6. Run existing style-related tests and add a small test only if there is already a pattern for CSS contract assertions.

## Acceptance Criteria

- [ ] Primary controls are visually dominant over Settings and Diagnostics.
- [ ] View options remain quick to operate and visually distinct from Settings.
- [ ] Settings and Diagnostics are easy to identify and keyboard-focusable.
- [ ] Active button styling still works.
- [ ] Viewer controls remain quick to operate.
- [ ] The layout remains usable on laptop-width and narrower screens.
- [ ] Style tests, if present, pass.

## Out Of Scope

- Do not change JS behavior.
- Do not redesign the TV display beyond preserving readability.
- Do not add external fonts, frameworks, CSS preprocessors, or icon libraries.
