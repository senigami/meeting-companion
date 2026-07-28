# Architecture Decisions

Specs say what the app does. ADRs say why the app is shaped this way. ADR numbers are immutable and append-only: if a decision changes later, write a new ADR that supersedes the old one instead of rewriting history.

## ADR Index

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-0001](0001-local-express-static-app.md) | Local Express app with static browser UI | Accepted |
| [ADR-0002](0002-modular-source-registry.md) | Modular source registry for transcription and summarization | Accepted |
| [ADR-0003](0003-no-audio-storage-by-default.md) | No audio or transcript persistence by default | Accepted |

## Template

# ADR-NNNN: Short imperative title

> **TL;DR:** One or two sentences describing the decision and why it was chosen.

## Status

Accepted | Superseded by ADR-XXXX | Deprecated

## Date

YYYY-MM-DD

## Context

What problem forced this decision and what constraints shaped it.

## Decision

What the repo now does.

## Alternatives considered

What was rejected and why.

## Consequences

Tradeoffs accepted and follow-on work created.

## Spec docs affected

Which numbered specs implement this decision.

## When to write an ADR

Write an ADR when a choice is expensive to reverse, likely to be questioned later, or establishes a convention that future code must follow. Good ADRs document framework choices, source boundaries, storage decisions, and security or privacy posture.

This includes decisions about **how the project is run**, not only how the code is built — agent model tiers, review gates, orchestration policy. The rule that sends them here: an instruction file states the current rule plainly, once, and nothing else. The history behind it — what was decided before, what changed it, what not to revert to — belongs in an ADR, because instruction files are loaded every session and a reader should never have to work out which of several rulings is in force.

