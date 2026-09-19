# Changelog

Repo release version, distinct from any individual skill's own version. Moves only on Steve's
explicit approval (OD-0024). Individual skill/plugin versions are tracked in their own
`.claude-plugin/plugin.json`, not here.

## v0.2.0 — 2026-09-19

Tagged on `main` at `44478eb`, backing a new `production` branch for live-service use: main keeps
moving while `production` stays pinned to a known-good point that can be checked out during a
service without pulling in same-day work. 33 commits since v0.1.0. No known live-path defect
blocks service use as of this tag; #177 (a model reply that answers about the transcript instead
of summarizing it can still drain and display as a real card) is open and unfixed but has not
recurred since the session that filed it.

## v0.1.0 — 2026-08-12

First tracked release. Marks the point this repo adopted release versioning as its own axis,
separate from per-skill version bumps. No prior state is reconstructed here; history before this
point lives in `git log` and `.claude/decisions/`.
