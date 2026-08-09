---
title: Observability — detecting silent death
tags:
  - type/brief
  - project/accretion
  - topic/monitoring
created: 2026-07-02T09:00:00Z
last_reviewed: 2026-08-01
---

> TL;DR: Installation checks answer "is it set up". Liveness checks answer "is it still running". Only the second kind catches the failure this system actually has, which is stopping quietly.

## Two kinds of check

Most of `doctor.mjs` answers *is this installed?* — Node version, build present, registry
valid, hook copied, command copied, server reachable.

None of that answers *is this still working?* A capture hook can be installed and not firing.
A weekly agent can be generated and never loaded. A digest backlog can grow for a month while
every installation check stays green.

The pipeline has died silently more than once, and both times every installation check
passed. Nothing broke loudly. The gap was measured in weeks.

## Liveness signals

**Is the agent loaded?** `launchctl print gui/<uid>/com.memory-weekly.<vault>` — generating
a plist is not the same as scheduling it, and the difference is invisible without asking
launchd directly.

**Has a run happened recently?** Run reports land in `sessions/digests/_runs/`. Their newest
mtime is the honest answer to when the loop last did anything.

**Is there a backlog?** `memory-digest-candidates.mjs` reports groups needing digests. A
growing backlog means the loop is running and failing, or not running.

**Is a brief oversized?** `get_context` concatenates whole briefs under a token budget, so
one oversized brief starves every other topic in an assembled context. A brief that grew past
the total budget silently made multi-topic context assembly useless. Doctor now flags brief
size before it gets there.

## Severity depends on history

A vault that has never been curated is unmanaged, and warns. A vault that was curated and
then stopped has regressed, and fails.

Failing on both would keep every unmanaged vault permanently red, and a permanently red check
gets ignored — at which point it stops detecting the regression it exists for. The signal
only works if it is quiet when things are fine.

## Postflight, not exit codes

The weekly runner does not trust its own exit code. A run that exits 0 having done nothing is
the failure mode that actually occurs.

So the runner invokes doctor *after* the agent finishes, and doctor decides whether the run
counts as healthy. A run that completes cleanly but leaves doctor red raises a separate
notification, because "the job ran" and "the job worked" are different claims.

## Related

- [[brief-weekly-loop]] — what is being watched
- [[brief-onboarding]] — doctor's severity rule
- [[brief-digests-archive]] — what a backlog means
