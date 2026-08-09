---
title: 'Fair-share the get_context token budget'
tags:
  - type/session
  - project/accretion
created: '2026-07-21T14:31:20.000Z'
updated: '2026-07-21T16:05:52.000Z'
session_id: 'c3d4e5f6-1111-2222-3333-444455556666'
project: 'accretion'
cwd: '/home/dev/code/accretion'
---

# Fair-share the get_context token budget

## Topics

- Asking for three topics returned the first brief in full plus a "budget reached" marker
- One oversized brief was larger than the whole default allowance
- Filling a shared budget in request order lets the first topic starve the rest
- Changed to equal shares with unused allowance rolling forward
- Added a doctor check flagging oversized briefs before they cause this

## Files Changed

- `src/tools/get-context.ts`
- `scripts/doctor.mjs`
- `src/__tests__/context-budget.test.ts`

## Commands

- `npm test`
- `node scripts/doctor.mjs`
