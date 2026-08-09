---
title: 'Session note dedupe for resumed sessions'
tags:
  - type/session
  - project/accretion
created: '2026-07-28T08:45:10.000Z'
updated: '2026-07-28T10:15:33.000Z'
session_id: 'd4e5f6a7-1111-2222-3333-444455556666'
project: 'accretion'
cwd: '/home/dev/code/accretion'
---

# Session note dedupe for resumed sessions

## Topics

- A resumed session ends more than once, writing to today's date directory each time
- Found up to seven byte-identical copies of one note, crowding real results out of retrieval
- findExistingSessionNote now locates the session's existing note anywhere, including the archive
- Careful with project prefixes: atlas-e6e38ce4 and atlas-mobile-app-e6e38ce4 are different notes
- Digest filenames must not be mistaken for session notes

## Files Changed

- `hooks/session-journal.mjs`
- `src/__tests__/session-note-dedupe.test.ts`

## Commands

- `npm test`
