---
title: 'Add domain-trigger guard to brief routing'
tags:
  - type/session
  - project/accretion
created: '2026-07-14T10:12:03.000Z'
updated: '2026-07-14T13:40:11.000Z'
session_id: 'a1b2c3d4-1111-2222-3333-444455556666'
project: 'accretion'
cwd: '/home/dev/code/accretion'
---

# Add domain-trigger guard to brief routing

## Topics

- Routing returned a brief for "what's the support phone number", which the vault has no answer for
- Floor and margin both passed — the top hit cleared a low absolute score and beat a very weak second place
- Concluded numeric thresholds alone cannot distinguish "best match" from "actually about this"
- Added hasDomainTrigger: query must contain a brief-map keyword, title word, or slug token
- Discussed raising DEFAULT_FLOOR instead; rejected, it kills legitimate fuzzy routes

## Files Changed

- `src/vault/brief-routing.ts`
- `src/__tests__/brief-routing.test.ts`

## Commands

- `npm test`
- `node scripts/memory-eval.mjs --vault demo --no-semantic`
- `node scripts/memory-eval.mjs --vault demo --sweep-routing`
