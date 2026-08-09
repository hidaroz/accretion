---
title: Multi-vault — the registry and project routing
tags:
  - type/brief
  - project/accretion
  - topic/vaults
created: 2026-06-26T09:00:00Z
last_reviewed: 2026-07-21
---

> TL;DR: One server, several vaults, registered in `~/.config/accretion/vaults.json`. Sessions route to a vault by the project directory's basename. Keeping client work and personal notes in separate vaults is the point.

## Why more than one

The separation is not organisational tidiness, it is a boundary. Client work under NDA and
personal notes should not share a store — different remotes, different encryption, different
people who might legitimately read them, different answers to "can this be pushed".

A single vault with tags pretending to be a boundary is not a boundary. Retrieval crosses
tags freely, which is the whole point of retrieval.

## The registry

```json
{
  "vaults": [
    {
      "id": "work",
      "path": "/abs/path/to/vault",
      "displayName": "Work",
      "default": true,
      "gitAutoCommit": true,
      "gitAutoPush": false
    }
  ]
}
```

`gitAutoPush` defaults to **false**. Committing locally is recoverable; pushing is not.
Enabling it should be a decision made once someone has checked where the remote points.

Exactly one vault may be `default`. `upsertVault` clears the flag on the others when a new
default is set, so the invariant cannot be violated by adding a vault.

Paths are tilde-expanded and resolved when the registry loads, so a hand-edited `~/notes`
works.

## Project routing

`project-vault-map.json` maps a directory basename to a vault id:

```json
{ "my-project": "work", "_default": null }
```

The key is the **working directory's basename**, so a session run in `~/code/my-project`
routes to `work`.

`_default: null` means unmapped projects are not captured at all. This is the opt-in default
— see [[brief-session-capture]] for why a globally-installed hook must not record everything
by default.

A consequence worth knowing: one session run from two directories with different basenames
routes by whichever directory it was launched from. Sub-projects therefore need their own
mappings, and prefix collisions (`atlas` versus `atlas-mobile-app`) are handled carefully
when matching existing notes.

## Tool-level selection

Every tool takes an optional `vault` argument. Omitted, it uses the default. `list_vaults`
enumerates what is available, which is how an agent discovers what it can reach.

## Related

- [[brief-session-capture]] — the routing that feeds this
- [[brief-onboarding]] — `setup-vault` writes both files
