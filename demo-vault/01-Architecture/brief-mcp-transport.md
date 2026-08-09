---
title: MCP transport — HTTP, bearer auth, health endpoints
tags:
  - type/brief
  - project/accretion
  - topic/transport
created: 2026-05-28T09:00:00Z
last_reviewed: 2026-07-21
---

> TL;DR: A long-running Streamable HTTP server on `127.0.0.1:3001`, not a stdio server. Every `/mcp` request needs a bearer token. Start it once; point every client at the same process.

## Why HTTP rather than stdio

Most MCP servers are stdio: the client spawns the process, owns its lifetime, and talks over
pipes. That is simpler and it is the right default for a stateless tool.

It is the wrong shape here, for one reason: this server holds expensive state. A keyword
index over the whole vault, an embedding index, a loaded transformer model, and file
watchers. Under stdio every client spawns its own copy and pays the full build cost, and two
clients cannot share a warm cache.

One long-running HTTP process is built once and shared. The trade is that the user has to
start it — hence the launchd agent and `bootstrap --server-autostart`.

## Auth

Every `/mcp` request must carry `Authorization: Bearer <API_KEY>`. There is no unauthenticated
mode.

The token comes from `.env`; `openssl rand -hex 32` generates a reasonable one. The server
refuses to start without it, rather than defaulting to something guessable — a default token
on a localhost service is a default token on a `0.0.0.0` service the moment someone changes
one line.

## Binding

`HOST` defaults to `127.0.0.1`. Set `0.0.0.0` only deliberately — in Docker, or to expose it
on a LAN behind something that terminates TLS.

Exposing it is the user's call and their responsibility. Note that CORS is currently
unrestricted, which is tracked as a known issue: on a bearer-authenticated localhost service
it is low severity, but combined with a `0.0.0.0` bind it means any web page can attempt
cross-origin requests to the server.

## Health endpoints

`/health` is liveness — the process is up. `/health/ready` is readiness — indexes built and
vaults loaded. The Docker healthcheck polls readiness, because a server that is listening but
still building its index will fail every query it receives.

Rate limiting sits in front of `/mcp`.

## Restart on code change

The running process holds compiled code in memory. New tools, routing changes, and index
behaviour do not take effect until the server restarts. A change that "didn't work" has
usually just not been loaded — this catches people constantly, including people who wrote
the code.

## Related

- [[brief-onboarding]] — getting the server started the first time
- [[brief-multi-vault]] — how one server serves several vaults
- [[brief-path-safety]] — what stops a request escaping the vault
