import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { VaultManager } from "./vault/vault-manager.js";
import { SearchIndex } from "./vault/search-index.js";
import { TagIndex } from "./vault/tag-index.js";
import { VaultWatcher } from "./vault/watcher.js";
import { createMcpServer } from "./server.js";
import { bearerAuth } from "./auth.js";
import { logger } from "./utils/logger.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";
const API_KEY = process.env.API_KEY;
const VAULT_PATH = process.env.VAULT_PATH || "./vault";

if (!API_KEY) {
  logger.error("API_KEY environment variable is required");
  process.exit(1);
}

const vault = new VaultManager(VAULT_PATH);
const searchIndex = new SearchIndex();
const tagIndex = new TagIndex();
const watcher = new VaultWatcher(vault, searchIndex, tagIndex);

// Readiness tracking — server is NOT ready until indexes are built
let isReady = false;
let initError: string | null = null;

// Build indexes on startup — read all notes once and share between indexes
async function initializeIndexes() {
  try {
    logger.info("Building indexes...");
    const start = Date.now();
    const allNotes = await vault.getAllNotes();
    logger.info(`Loaded ${allNotes.length} notes in ${Date.now() - start}ms`);
    await searchIndex.buildFromVault(vault, allNotes);
    await tagIndex.buildFromVault(vault, allNotes);
    watcher.start();
    isReady = true;
    logger.info(`Indexes initialized in ${Date.now() - start}ms — server ready`);
  } catch (err) {
    initError = String(err);
    logger.error("Failed to build indexes", { error: initError });
  }
}

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
  res.json({ status: "ok", ready: isReady, sessions: sessions.size });
});

// Readiness probe — returns 503 until indexes are built
app.get("/health/ready", (_req, res) => {
  if (isReady) {
    res.json({ status: "ready", sessions: sessions.size, searchDocs: searchIndex.size });
  } else {
    res.status(503).json({ status: "initializing", error: initError });
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
  if (!isReady) {
    res.status(503).json({ error: "Server not ready — indexes still initializing" });
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
  const server = createMcpServer(vault, searchIndex, tagIndex);

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

// Start server: await index initialization, THEN listen
async function main() {
  await initializeIndexes();

  app.listen(PORT, HOST, () => {
    logger.info(`Obsidian MCP server listening on ${HOST}:${PORT}`);
    logger.info(`Vault path: ${VAULT_PATH}`);
    logger.info(`Ready: ${isReady}`);
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", { error: String(err) });
  process.exit(1);
});
