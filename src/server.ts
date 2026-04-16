import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VaultManager } from "./vault/vault-manager.js";
import { SearchIndex } from "./vault/search-index.js";
import { TagIndex } from "./vault/tag-index.js";
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
import { registerVaultTree } from "./resources/vault-tree.js";
import { registerNoteResource } from "./resources/note-resource.js";

export function createMcpServer(
  vault: VaultManager,
  searchIndex: SearchIndex,
  tagIndex: TagIndex
): McpServer {
  const server = new McpServer({
    name: "obsidian-mcp-server",
    version: "1.0.0",
  });

  // Tools
  registerReadNote(server, vault);
  registerCreateNote(server, vault);
  registerListNotes(server, vault);
  registerSearchNotes(server, searchIndex);
  registerUpdateNote(server, vault);
  registerPatchNote(server, vault);
  registerDeleteNote(server, vault);
  registerListTags(server, tagIndex);
  registerSearchByTag(server, vault, tagIndex);
  registerGetBrief(server, vault, searchIndex);
  registerGetContext(server, vault, searchIndex);

  // Resources
  registerVaultTree(server, vault);
  registerNoteResource(server, vault);

  return server;
}
