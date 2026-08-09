---
title: 'Exact-match pinning for routed briefs'
tags:
  - type/session
  - project/accretion
created: '2026-07-16T09:02:44.000Z'
updated: '2026-07-16T11:20:09.000Z'
session_id: 'b2c3d4e5-1111-2222-3333-444455556666'
project: 'accretion'
cwd: '/home/dev/code/accretion'
---

# Exact-match pinning for routed briefs

## Topics

- Routing identified the correct brief while RRF ranked it sixth, below sessions mentioning the topic in passing
- The system knew the answer and then declined to show it
- Added pinning: a confidently routed brief is placed into results rather than left to compete on rank
- Guard added — pin only applies if the note was retrieved by at least one index
- Pinning an unretrieved note would assert relevance no index found evidence for

## Files Changed

- `src/vault/hybrid.ts`
- `src/tools/hybrid-search.ts`
- `src/__tests__/hybrid.test.ts`

## Commands

- `npm run build`
- `npm test`
- `node scripts/memory-eval.mjs --vault demo`
