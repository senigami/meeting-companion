# Design Critique — Mobile responsiveness and navigability
**Date:** 2026-07-24
**Scope:** Mobile/phone-width viewport (≤900px) of `public/index.html`, `public/style.css` + `public/styles/*.css`. The 2026-06-30 critique in this same directory (`00-summary.md`, `01-findings.md`, `02-improvement-plan.md`) covered the desktop helper panel before the desktop-operator-redesign pass shipped and predates this repo's mobile breakpoints entirely — this is a fresh, narrower-scoped pass, not an update to that one, filed alongside it rather than over it.
**Trigger:** The owner accessed the app live from a phone on the same Wi-Fi network and reported it "not mobile friendly and very hard to navigate."
**Frameworks:** Apple HIG (primary lens, per request), WCAG 2.2 touch-target guidance, general responsive-layout practice.
**Style guide used:** No formal style guide; implicit dark-glass system preserved as-is — this was a responsiveness/navigability critique, not a re-theme.

---

> **TL;DR:** The mobile breakpoint had a real, severe bug, not just a rough edge: at ≤900px width, `.operatorRail` was flipped to `flex-direction: row` — but `.operatorRail` *is* the whole sidebar container (brand header, status, and the scrollable body), not just the row of control sections inside it. That single rule turned the entire rail into a sideways-scrolling strip, so Quick Controls, Mode selection, and the live-transcript preview each landed in their own off-screen column, reachable only by horizontal scroll a phone user has no reason to expect. A second, related bug compounded it: `#root` (the same DOM node as `.meetingShell`) carries an ID selector in `base.css` (`height: 100%`) that silently outranked the media query's class-selector override, so even after removing the row layout the page stayed clipped to one viewport height with an internal, fought-over scroll container instead of scrolling naturally. Both are now fixed — the rail is a single vertical column on phone widths, and the whole page scrolls as one document.

## What we reviewed
Live-rendered the app in a 375×812 mobile viewport (matches an iPhone-class phone) via the browser preview, screenshotted the actual result, and cross-referenced against the CSS driving it (`public/styles/layout.css`, `controls.css`, `responsive.css`). This was grounded in what actually rendered, not just code-reading — the first screenshot is what surfaced the horizontal-scroll bug; code inspection then found the exact rule causing it.

## What's working
- The dark-glass visual language (single material surface, one accent family, consistent radii) survives the fix untouched — no re-theming was needed or done.
- Touch targets were already sized reasonably (44–58px) even before this fix — Apple HIG's ~44pt minimum was respected in the underlying components.
- DOM order already put Quick Controls first, Mode second, and the live-transcript preview third — the right information-architecture priority for a helper glancing at the page mid-meeting. The fix could rely on that existing order rather than needing to reorder content.
- The collapsible-rail and rail-resize features (desktop-only concerns) were correctly left untouched — the bug and fix are scoped entirely to the ≤900px tier.

## Findings summary
| Severity | Count | Effort |
|----------|-------|--------|
| P1 — Blocker | 1 | Fixed |
| P2 — Major | 1 | Fixed |
| P3 — Polish | 1 | Noted, not fixed |
| P4 — Cosmetic | 0 | — |

## Top findings

**DC-M01 (P1 — Blocker).** `.operatorRail { flex-direction: row; overflow-x: auto; }` at `@media (max-width: 900px)` applied to the rail's own top-level container, not just its inner control body — collapsing the entire sidebar (brand/status/body) into a horizontally-scrolling strip. Apple HIG treats horizontal scroll as acceptable only for a bounded gallery of peer items (e.g. a carousel), never as the primary means of reaching distinct functional sections of a screen — exactly the anti-pattern this produced. **Fixed:** `public/styles/responsive.css` now keeps `.operatorRail` a single vertical column at this breakpoint (`flex-direction` reverts to the base rule's `column`); `.railBody` no longer scrolls horizontally either.

**DC-M02 (P2 — Major).** `html, body, #root { height: 100%; overflow: hidden }` in `base.css` uses an ID selector for `#root`, which is the same DOM node as `.meetingShell`. The mobile media query's `.meetingShell { height: auto }` override lost to that ID selector on specificity alone, regardless of source order, so the page silently stayed pinned to one viewport height and became its own clipped, separately-scrolling container instead of the page scrolling as a whole — a jarring "nested scrollbar" experience even after DC-M01 was fixed in isolation. **Fixed:** the same `html, body, #root` selector list is now also overridden in the ≤900px query (`height: auto; min-height: 100%; overflow: auto`), which wins on identical specificity via source order (responsive.css loads last).

**DC-M03 (P3 — Polish, not fixed).** The manual-line input's placeholder text ("Type a line to show immediately") truncates at 375px width because the input and the "Show now" button share a narrow grid row. Functional, not blocking, and pre-dates this pass — left as a backlog item rather than scope-creeping into the navigability fix.

## What Apple would do (HIG exemplar pass)
Asked directly: would Apple be happy with this page on a phone, and what would they change?
- **Remove, don't just shrink.** The original ≤900px rule tried to preserve the desktop rail's shape (a fixed-width sidebar) by squeezing it sideways instead of letting it become what a phone screen actually wants: one column, top to bottom. HIG's Clarity principle argues for exactly this — content should restructure per platform, not just rescale.
- **One scrollable document, not nested scroll regions.** iOS conditions users to expect the whole screen to scroll as one surface; a scrollable sidebar inside a scrollable page (what DC-M02 produced) reads as broken, not deliberate. The fix collapses this to a single scroll container.
- **Primary action first, settings deepest** — already true here (Quick Controls → Mode → transcript preview → Manual line) and worth preserving explicitly as the page evolves; this is the one structural move that was already right and shouldn't be lost in future changes.
- **Everything else about the shell (display panel, transcript cards, dark glass materials) is unaffected and shouldn't change for mobile's sake** — the bug was structural, not visual.

## Decisions needed from you
None — no brand-conflicting recommendations. Both fixes are behavioral CSS corrections with no visual/theme trade-offs.
