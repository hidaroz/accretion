#!/usr/bin/env node
import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { loadVaultsConfig } from "./engine/config/vault-config.js";
import { VaultRegistry } from "./engine/registry.js";
import { createMcpServer } from "./server.js";
import { bearerAuth } from "./auth.js";
import { logger } from "./engine/utils/logger.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
// Bind localhost-only by default — this is a personal, single-user server.
// Override with HOST=0.0.0.0 only when intentionally exposing it (e.g. in Docker).
const HOST = process.env.HOST || "127.0.0.1";
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  logger.error("API_KEY environment variable is required");
  process.exit(1);
}

let registry: VaultRegistry;

// Session management
const sessions = new Map<
  string,
  { transport: StreamableHTTPServerTransport; lastActive: number }
>();

// Clean up stale sessions every 5 minutes
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActive > SESSION_TTL_MS) {
      logger.info("Cleaning up stale session", { sessionId: id });
      session.transport.close?.();
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Liveness probe — always returns 200 if process is running
app.get("/health", (_req, res) => {
  const vaults = registry?.list().map((v) => ({
    id: v.id,
    ready: v.ready,
    notes: v.ready ? v.searchIndex.size : 0,
  }));
  res.json({ status: "ok", ready: registry?.allReady ?? false, vaults, sessions: sessions.size });
});

// Readiness probe — returns 503 until all vaults are indexed
app.get("/health/ready", (_req, res) => {
  if (registry?.allReady) {
    const vaults = registry.list().map((v) => ({
      id: v.id,
      notes: v.searchIndex.size,
    }));
    res.json({ status: "ready", vaults, sessions: sessions.size });
  } else {
    const vaults = registry?.list().map((v) => ({
      id: v.id,
      ready: v.ready,
      error: v.initError,
    }));
    res.status(503).json({ status: "initializing", vaults });
  }
});

// Reject OAuth discovery — this server uses Bearer token auth, not OAuth
app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.status(404).json({ error: "OAuth not supported. Use Bearer token authentication." });
});
app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.status(404).json({ error: "OAuth not supported. Use Bearer token authentication." });
});
app.post("/register", (_req, res) => {
  res.status(404).json({ error: "OAuth client registration not supported. Use Bearer token authentication." });
});

// DNS rebinding protection
app.use("/mcp", hostHeaderValidation(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]));

// Rate limiting on MCP routes — defense against accidental loops
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — rate limit exceeded" },
});
app.use("/mcp", mcpLimiter);

// Apply auth to MCP routes
app.use("/mcp", bearerAuth(API_KEY));

// Gate MCP routes on readiness
app.use("/mcp", (_req, res, next) => {
  if (!registry?.allReady) {
    res.status(503).json({ error: "Server not ready — vaults still initializing" });
    return;
  }
  next();
});

// POST /mcp — handle MCP messages (new sessions and existing)
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    // Existing session
    const session = sessions.get(sessionId)!;
    session.lastActive = Date.now();
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — create McpServer + transport
  const server = createMcpServer(registry);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId) => {
      logger.info("Session initialized", { sessionId: newSessionId });
      sessions.set(newSessionId, {
        transport,
        lastActive: Date.now(),
      });
    },
  });

  // Handle transport close
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      sessions.delete(sid);
      logger.info("Session closed", { sessionId: sid });
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// GET /mcp — SSE stream for existing sessions
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }

  const session = sessions.get(sessionId)!;
  session.lastActive = Date.now();
  await session.transport.handleRequest(req, res);
});

// DELETE /mcp — close session
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }

  const session = sessions.get(sessionId)!;
  await session.transport.handleRequest(req, res);
  sessions.delete(sessionId);
  logger.info("Session deleted via DELETE", { sessionId });
});

// Start server: load config, initialize vaults, THEN listen
async function main() {
  const configs = await loadVaultsConfig();
  registry = new VaultRegistry(configs);
  await registry.initializeAll();

  app.listen(PORT, HOST, () => {
    logger.info(`Obsidian MCP server listening on ${HOST}:${PORT}`);
    const vaultList = registry
      .list()
      .map((v) => `  ${v.id}: ${v.ready ? "ready" : "error"} (${v.searchIndex.size} notes)`)
      .join("\n");
    logger.info(`Vaults:\n${vaultList}`);
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", { error: String(err) });
  process.exit(1);
});
