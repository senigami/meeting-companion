# Design Critique - Meeting Companion Display
**Date:** 2026-06-30  
**Scope:** Specific page / browser UI in `public/index.html`, `public/style.css`, `public/controller/start-app.js`, and `public/controller/view.js`  
**Frameworks:** WCAG 2.2 (Lane A), Nielsen heuristics (Lane B), cognitive load (Lane C), affordances/conventions (Lane D), visual hierarchy/Gestalt (Lane E), color/design systems (Lane F)  
**Style guide used:** No formal style guide found; implicit system extracted from the codebase

---

> **TL;DR:** The page is functionally solid, but the helper panel is still organized like one large settings slab. The immediate controls and the infrequent configuration controls sit at the same visual level, so the helper has to scan and remember more than necessary under pressure. The best fix is progressive disclosure: keep live controls visible, move transcription/summary source and update interval into a dedicated settings surface, and demote diagnostics to a secondary area.

## What we reviewed
This was a code-based critique of the current browser UI and its supporting controller/CSS. I reviewed the live layout semantics, control grouping, visual hierarchy, keyboard shortcuts, and the CSS treatment that makes the page feel dense or airy. No screenshot set was available in this workspace, so the critique is grounded in code and the documented lane checklists.

## What's working
- The transcript-card TV display is clean and extremely focused.
- Keyboard shortcuts are already present for the helper workflow.
- The viewer-specific controls for text size and margins are surfaced clearly.
- The visual system is consistent: one material surface, one accent family, one typography stack.

## Findings summary
| Severity | Count | Estimated total effort |
|----------|-------|----------------------|
| P1 - Blocker | 0 | 0 |
| P2 - Major | 0 | 0 |
| P3 - Polish | 2 | 1-2 days |
| P4 - Cosmetic | 0 | 0 |
| **Total** | **2** | **1-2 days** |

## Coverage by lane
| Lane | Findings | Notable |
|------|----------|---------|
| A - Accessibility | 0 | No verified WCAG blocker surfaced in the current layout/code. |
| B - Usability | 1 | The panel is crowded for a pressure-sensitive helper workflow. |
| C - Cognitive load | 2 | Too many equally weighted choices; settings are not progressively disclosed. |
| D - Affordances/conventions | 1 | Settings are not visually separated from immediate actions. |
| E - Visual hierarchy | 2 | No strong primary/secondary hierarchy inside the helper panel. |
| F - Color/systems | 0 | Color use is disciplined and not overloaded semantically. |

## Top priority findings
| ID | Finding | Severity | Effort |
|----|---------|----------|--------|
| DC-001 | Progressive disclosure is missing for settings | P3 | M |
| DC-002 | Diagnostics still compete with live controls | P3 | S-M |

## Decisions needed from you
No brand-conflicting recommendations. The proposed changes preserve the existing dark Apple-inspired theme and only change structure, grouping, and emphasis.
