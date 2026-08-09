---
title: Home
tags:
  - type/moc
created: 2026-05-28T09:00:00Z
---

# Demo vault

A working example vault for [accretion](https://github.com/hidaroz/accretion), and the
fixture its eval harness runs against.

It documents the system itself, which means you can point a fresh install at it and
immediately ask your agent how the thing you just installed works. It also carries a few
notes on unrelated subjects — coffee, bread, bicycles — which exist so the eval can check
that retrieval declines to answer questions the vault has no business answering.

Everything here is real prose. Stub notes would not embed or rank like real ones, and a
scorecard measured against stubs would mean nothing.

## Architecture

- [[brief-mcp-transport]] — HTTP transport, bearer auth, health endpoints
- [[brief-vault-structure]] — folders, frontmatter, the brief map
- [[brief-path-safety]] — keeping requests inside the vault

## Retrieval

- [[brief-hybrid-retrieval]] — keyword and semantic, fused with RRF
- [[brief-brief-routing]] — confidence gates and abstention
- [[brief-embedding-index]] — local inference, no network at query time
- [[brief-search-index]] — keyword matching and recency

## Lifecycle

- [[brief-session-capture]] — the SessionEnd hook and redaction
- [[brief-digests-archive]] — compressing sessions into memory
- [[brief-brief-proposals]] — propose-only, never unattended edits
- [[brief-weekly-loop]] — autonomous curation, dry-run by default

## Operations

- [[brief-multi-vault]] — the registry and project routing
- [[brief-onboarding]] — bootstrap, setup-vault, doctor
- [[brief-observability]] — detecting silent death
- [[brief-eval-harness]] — measuring retrieval and routing

## Off-domain, deliberately

- [[brief-coffee-roasting]]
- [[brief-sourdough]]
- [[brief-bike-maintenance]]
