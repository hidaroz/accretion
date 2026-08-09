---
title: 'accretion — 2026-W29'
tags:
  - type/digest
  - project/accretion
period: 2026-W29
session_count: 2
sources:
  - sessions/2026/07-14/accretion-a1b2c3d4.md
  - sessions/2026/07-14/accretion-b2c3d4e5.md
created: '2026-07-20T09:00:00Z'
generated_by: memory-weekly
---

> TL;DR: Two routing failures found and fixed — confidently wrong routes, and correctly routed briefs that retrieval then buried. Both were precision problems in opposite directions.

## Summary

A week on brief routing, prompted by a query that returned a confidently wrong answer.

The first problem was that numeric confidence gates are not sufficient. A query with no
answer in the vault can still clear an absolute score floor and beat second place by a wide
margin, purely because everything scored low and one brief scored least-low. Floor and margin
measure *relative* strength; neither establishes that a query is about a particular brief.
The domain-trigger guard adds that missing evidence requirement.

The second was the mirror image: routing correctly identified a brief, and fusion ranked it
sixth. The system had the right answer and did not show it. Exact-match pinning fixes it,
with a guard that a pin only applies to a note some index actually retrieved — otherwise the
pin asserts relevance nothing found evidence for.

## Decisions

- Routing requires positive evidence (brief-map keyword, title word, or slug token), not just
  numeric thresholds. Intent over proximity.
- `DEFAULT_FLOOR` stays low. Raising it to suppress wrong routes also kills legitimate fuzzy
  matching; the trigger does that job better and more cheaply.
- Pins apply only to retrieved notes.

## Open Threads

- Routing thresholds are calibrated against this vault only. MiniSearch scores are
  corpus-relative and there is no evidence yet about how they transfer.
- A wrong pin at rank one can mislead a caller even when recall is unchanged. The current
  metrics do not capture that; it is real harm that goes unmeasured.
- The eval is retrieval and routing only. No answer-quality tier exists.

## Trends

Both fixes came from watching a specific bad output rather than from a metric moving. The
eval confirmed neither change regressed anything, but neither would have been found by
staring at the scorecard.

## Source Sessions

- [[accretion-a1b2c3d4|Add domain-trigger guard to brief routing]]
- [[accretion-b2c3d4e5|Exact-match pinning for routed briefs]]
