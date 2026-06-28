import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "./vault/vault-registry.js";
import { registerReadNote } from "./tools/read-note.js";
import { registerCreateNote } from "./tools/create-note.js";
import { registerListNotes } from "./tools/list-notes.js";
import { registerSearchNotes } from "./tools/search-notes.js";
import { registerUpdateNote } from "./tools/update-note.js";
import { registerPatchNote } from "./tools/patch-note.js";
import { registerDeleteNote } from "./tools/delete-note.js";
import { registerListTags } from "./tools/list-tags.js";
import { registerSearchByTag } from "./tools/search-by-tag.js";
import { registerGetBrief } from "./tools/get-brief.js";
import { registerGetContext } from "./tools/get-context.js";
import { registerArchiveSessions } from "./tools/archive-sessions.js";
import { registerConsolidateSessions } from "./tools/consolidate-sessions.js";
import { registerGetDigestCandidates } from "./tools/get-digest-candidates.js";
import { registerGetStaleBriefs } from "./tools/get-stale-briefs.js";
import { registerGetVaultHealth } from "./tools/get-vault-health.js";
import { registerGetResurfaceCandidates } from "./tools/get-resurface-candidates.js";
import { registerApplyBriefProposal } from "./tools/apply-brief-proposal.js";
import { registerListVaults } from "./tools/list-vaults.js";
import { registerVaultTree } from "./resources/vault-tree.js";
import { registerNoteResource } from "./resources/note-resource.js";

export function createMcpServer(registry: VaultRegistry): McpServer {
  const server = new McpServer({
    name: "obsidian-mcp-server",
    version: "2.1.0",
  });

  // Tools
  registerListVaults(server, registry);
  registerReadNote(server, registry);
  registerCreateNote(server, registry);
  registerListNotes(server, registry);
  registerSearchNotes(server, registry);
  registerUpdateNote(server, registry);
  registerPatchNote(server, registry);
  registerDeleteNote(server, registry);
  registerListTags(server, registry);
  registerSearchByTag(server, registry);
  registerGetBrief(server, registry);
  registerGetContext(server, registry);
  registerArchiveSessions(server, registry);
  registerConsolidateSessions(server, registry);
  registerGetDigestCandidates(server, registry);
  registerGetStaleBriefs(server, registry);
  registerGetVaultHealth(server, registry);
  registerGetResurfaceCandidates(server, registry);
  registerApplyBriefProposal(server, registry);

  // Resources
  registerVaultTree(server, registry);
  registerNoteResource(server, registry);

  return server;
}
