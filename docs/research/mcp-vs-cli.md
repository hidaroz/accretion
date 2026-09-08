# Research: MCP tools versus a CLI behind a skill versus context-injecting hooks

**Question.** For an agent-memory tool used by coding agents (Claude Code, Codex CLI, Cursor,
Claude Desktop), what does primary-source evidence say about exposing capabilities as MCP tools,
as a CLI invoked from a skill, or as hooks that inject context automatically? Factors to weigh,
not an opinion.

**Date.** Sources fetched 2026-09-07.

**Method.** Primary sources: Anthropic engineering posts and platform docs, the MCP specification
(2025-06-18 and 2026-07-28), Claude Code / Codex / Cursor docs, agentskills.io, and papers.
Practitioner opinion is labelled as such. Anything not confirmed at a primary source is under
"Unverified."

## 1. Factor by factor

### Context cost

| Mechanism | What the sources say |
|---|---|
| MCP tools | Tool definitions are sent in the system-prompt prefix on every request unless the client defers them. Anthropic: *"Tool descriptions occupy more context window space, increasing response time and costs. In cases where agents are connected to thousands of tools, they'll need to process hundreds of thousands of tokens before reading a request."* ([Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)). Platform docs quantify a five-server setup at ~55k tokens before any work happens ([tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)). MCP's own client guidance: *"those definitions alone can consume the majority of the context window before the model has even read the user's message"* ([MCP client best practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices)). |
| Skill + CLI | Three-level progressive disclosure. Level 1 metadata ~100 tokens per skill (always loaded), Level 2 SKILL.md body under 5k tokens (on trigger), Level 3 bundled resources "None until accessed" ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)). *"When Claude runs `validate_form.py`, the script's code never loads into the context window. Only its output... consumes tokens."* Claude Code caps the skill listing at ~1% of the context window and truncates `description` + `when_to_use` at 1,536 characters ([Claude Code skills](https://code.claude.com/docs/en/skills)). Codex caps its skill listing at 2% of context or 8,000 characters ([Codex build skills](https://learn.chatgpt.com/docs/build-skills)). |
| Hooks | Injected context is unconditional. Codex: *"Keep hook and plugin context concise. Context from multiple hooks and plugins adds up and can degrade model performance,"* default `additionalContextLimit` 2,500 tokens per handler with spill-to-disk above that ([Codex hooks](https://learn.chatgpt.com/docs/hooks)). Claude Code's `UserPromptSubmit` has no documented token cap; stdout and `additionalContext` are both added to context ([Claude Code hooks](https://code.claude.com/docs/en/hooks)). |
| Cross-cutting | Anthropic's context-engineering post: find *"the smallest possible set of high-signal tokens that maximize the likelihood of some desired outcome,"* and *"as the number of tokens in the context window increases, the model's ability to accurately recall information from that context decreases"* ([Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). |

### Discoverability / recall by the model

| Mechanism | Evidence |
|---|---|
| MCP tools | *"Claude's ability to pick the right tool degrades once you exceed 30–50 available tools"* ([tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)); Agent SDK repeats *"Tool selection accuracy degrades with more than 30-50 tools loaded at once"* ([Agent SDK tool search](https://code.claude.com/docs/en/agent-sdk/tool-search)). *"The most common failures are wrong tool selection and incorrect parameters, especially when tools have similar names"* ([Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)). |
| Skill + CLI | Discovery is mediated by the `description` string: *"The `description` is what Claude matches your request against when determining whether to trigger the Skill, so it must say both what the Skill does and when to use it"* ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)). Claude Code adds `when_to_use` and `paths` globs ([Claude Code skills](https://code.claude.com/docs/en/skills)). Failure is silent non-invocation; `/skill-doctor` reports *"which skills are unused and their token cost."* A loaded skill body persists across turns and is carried through compaction in a 25,000-token shared budget. |
| Hooks | No discovery problem: injection is deterministic and event-driven. The model never gets a say in whether the memory is relevant. |

### Output shaping

| Mechanism | Evidence |
|---|---|
| MCP tools | Author controls the envelope. Anthropic recommends a `response_format` enum: the detailed Slack response was 206 tokens, the concise one 72 ([Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)). Also *"pagination, range selection, filtering, and/or truncation with sensible default parameter values."* Claude Code warns above 10,000 tokens of MCP output and caps at 25,000 by default (`MAX_MCP_OUTPUT_TOKENS`), with a per-tool `_meta: {"anthropic/maxResultSizeChars"}` ceiling of 500,000 characters ([Claude Code MCP](https://code.claude.com/docs/en/mcp)). Codex has per-tool `output_token_limit` ([Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)). |
| Skill + CLI | Shaping happens outside the model: filter in code so *"the agent sees five rows instead of 10,000."* Skills doc: *"only their output enters context."* Whatever the CLI prints lands raw unless the skill instructs otherwise; no protocol-level truncation guard. |
| Hooks | Truncation only. Codex spills over-limit output to disk with a truncated preview ([Codex hooks](https://learn.chatgpt.com/docs/hooks)). |

### Input validation

| Mechanism | Evidence |
|---|---|
| MCP tools | `inputSchema` (JSON Schema) and optional `outputSchema`; *"Servers MUST provide structured results that conform to this schema"* and *"Validate all tool inputs"* ([MCP tools spec](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)). Tool-use examples improved *"accuracy from 72% to 90% on complex parameter handling"* ([Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)). |
| Skill + CLI | No schema layer; validation is runtime. Simon Willison (opinion): *"LLMs know how to call `cli-tool --help`"* ([simonwillison.net, 16 Oct 2025](https://simonwillison.net/2025/Oct/16/claude-skills/)). |
| Hooks | Not applicable. Claude Code: *"Always validate hook input on untrusted sources. The `if` field uses permission rule syntax but is best-effort"* ([hooks](https://code.claude.com/docs/en/hooks)). |

### Client reach

MCP has the broadest documented reach (Claude Code, Claude Desktop, Cursor, Codex CLI/IDE/ChatGPT
desktop and web). Skills now have comparable reach: agentskills.io lists Claude Code, Cursor,
ChatGPT and Codex, VS Code/Copilot, Gemini CLI, Amp, OpenCode, Goose, Factory, Kiro and ~30 more
([agentskills.io](https://agentskills.io/)). Hooks are the narrowest and least portable: every
client has its own schema and event names. See the matrix in section 2.

### State / long-lived process

| Mechanism | Evidence |
|---|---|
| MCP stdio | A persistent local process. Claude Code documents stdio idle timeout of 30 minutes versus 5 minutes for HTTP/SSE/WebSocket, a `MCP_TOOL_TIMEOUT` default of ~28 hours, and automatic backgrounding past 2 minutes ([Claude Code MCP](https://code.claude.com/docs/en/mcp)). MCP is *"a stateless protocol"* at the data layer as of 2026-07-28 ([MCP architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture)). |
| Skill + CLI | Process per invocation; state must live in files. Anthropic frames the filesystem as the state layer ([Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp); [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). Startup cost per call is on the author. |
| Hooks | Fire-and-exit with hard timeouts: Claude Code defaults 30s on `UserPromptSubmit` (600s for most command hooks). Claude Code plugins separately offer `monitors/` as the long-running primitive ([plugins](https://code.claude.com/docs/en/plugins)). |

### Security surface

| Mechanism | Evidence |
|---|---|
| MCP tools | *"there SHOULD always be a human in the loop with the ability to deny tool invocations,"* clients SHOULD *"Show tool inputs to the user before calling the server,"* and *"clients MUST consider tool annotations to be untrusted unless they come from trusted servers"* ([MCP tools spec](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)). Claude Code: *"Verify you trust each server before connecting it"* plus `_meta: {"anthropic/requiresUserInteraction": true}` overriding `bypassPermissions` ([Claude Code MCP](https://code.claude.com/docs/en/mcp)). Cursor asks for approval before using MCP tools by default ([Cursor MCP](https://cursor.com/docs/context/mcp)). |
| Skill + CLI | Skills are executable content: *"Use Skills only from trusted sources... Treat like installing software"* ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)). Claude Code adds `` !`command` `` pre-execution that runs before the model sees the skill, killable by `disableSkillShellExecution`. |
| Hooks | Highest ambient privilege, lowest model visibility. Project hooks *"require you to trust the workspace folder before they run"*; enterprise `allowManagedHooksOnly` ([hooks](https://code.claude.com/docs/en/hooks)). A hook that injects retrieved memory is an injection vector: retrieved text enters context with no tool-result framing and no approval step. |
| Cross-server | *"Tool results from one server are untrusted input to another... output truncation alone does not prevent exfiltration"* ([client best practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices)). |

### Packaging / distribution

| Mechanism | Evidence |
|---|---|
| MCP tools | Per-client config: `.mcp.json` / `~/.claude.json` (Claude Code); `.cursor/mcp.json` (Cursor); `[mcp_servers.<name>]` in `config.toml` (Codex). Claude Desktop adds `.mcpb` extensions and `managedMcpServers` ([Claude Desktop extensions](https://claude.com/docs/third-party/claude-desktop/extensions)). |
| Skill + CLI | A folder. Directory conventions differ per client: `~/.claude/skills` / `.claude/skills`; Codex `$HOME/.agents/skills` / `$REPO_ROOT/.agents/skills`; Cursor scans `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/`, `~/.cursor/skills/` plus legacy dirs ([Cursor skills](https://cursor.com/docs/context/skills)). |
| Bundled | Claude Code plugins bundle `skills/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `monitors/`, `bin/` (added to Bash `PATH`) and `settings.json` in one installable directory ([plugins](https://code.claude.com/docs/en/plugins)). Codex has an analogous manifest with `agents/openai.yaml` declaring MCP tool dependencies. |
| Anthropic's own split | *"Use MCP when: You need real-time data from external services... Use skills when: You're encoding procedures, reference docs, or orchestrating Claude's built-in tools"* ([Claude Code skills](https://code.claude.com/docs/en/skills)). |

### Multi-client consistency

- MCP is one wire protocol but client behaviour diverges: Claude Code supports stdio, HTTP, SSE
  (deprecated), WebSocket; Cursor stdio, SSE, Streamable HTTP; Codex stdio and Streamable HTTP
  only. Deferred loading, output caps, timeouts and approval UX are per-client.
- Skills have a published spec and a cross-vendor client list ([agentskills.io](https://agentskills.io/)).
  Superset fields are client-specific: Claude Code's `context: fork`, `agent`, `model`,
  `effort`, `allowed-tools`, `hooks`, `` !`command` ``; Codex's `agents/openai.yaml`; Cursor's
  `icon`/`color`. A skill written to the minimal spec (`name`, `description`, body, `scripts/`)
  is the portable subset.
- Hooks have no cross-vendor spec. Claude Code lists ~30 events; Codex 12; Cursor uses
  `hooks.json` with `sessionStart`/`beforeSubmitPrompt`/`postToolUse` and `additional_context`
  (snake_case, versus Claude Code's `additionalContext`).
- Claude Skills do not sync across Anthropic's own surfaces ([Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)).

## 2. Client support matrix

| | MCP stdio | MCP HTTP | Skills (SKILL.md) | Hooks with context injection | Shell access |
|---|---|---|---|---|---|
| Claude Code | Yes | Yes (HTTP recommended; SSE deprecated; WebSocket via JSON) | Yes: `~/.claude/skills`, `.claude/skills`, plugin, enterprise, nested | Yes: `UserPromptSubmit` `additionalContext` + stdout; also `SessionStart`, `UserPromptExpansion`, `PostModelSwitch` | Yes |
| Codex CLI | Yes | Yes (Streamable HTTP) | Yes: `$HOME/.agents/skills`, `$REPO_ROOT/.agents/skills`, `/etc/codex/skills` | Yes: `UserPromptSubmit`/`SessionStart`/`PreToolUse`/`PostToolUse`/`Subagent*`/`Stop`, `additionalContext`, default limit 2,500 tokens | Yes (sandboxed) |
| Cursor | Yes | Yes (SSE + Streamable HTTP) | Yes: `.agents/skills`, `.cursor/skills`, `~/.agents/skills`, `~/.cursor/skills` + legacy dirs | Yes: `hooks.json`; `additional_context` on `sessionStart` and `postToolUse`; `beforeSubmitPrompt` injection UNVERIFIED | Yes |
| Claude Desktop | Yes (local servers / `.mcpb` / `managedMcpServers`) | Yes (remote connectors) | Yes (requires code execution enabled) | Bundled in plugins; hooks-in-plain-chat UNVERIFIED | Only inside the code-execution/Cowork VM |
| claude.ai / ChatGPT web | No | Yes (connectors / remote MCP) | Yes (zip upload; Codex plugin-bundled skills) | No | Sandboxed code execution only |

Claude Desktop, Cursor Cloud Agents and the Claude API have restricted or no local shell, which
is the load-bearing assumption behind the CLI-in-a-skill approach.

### Deferred / lazy tool loading by client

| Client | Deferred MCP tool loading? | Threshold |
|---|---|---|
| Claude Code / Agent SDK | Yes, on by default via server-side `ToolSearch` | `ENABLE_TOOL_SEARCH` unset = on; `auto` activates when deferrable definitions reach 10% of the context window; disabled on non-first-party `ANTHROPIC_BASE_URL`, Azure Foundry, pre-4.5 Google Agent Platform models. Max 10,000 tools; 5 results per search by default ([Agent SDK tool search](https://code.claude.com/docs/en/agent-sdk/tool-search)) |
| Codex | Yes, default since June 2026 | PR [openai/codex#29486](https://github.com/openai/codex/pull/29486), merged 22 Jun 2026: *"unconditionally defers all MCP tools behind `tool_search`"* when model and provider support it; previously gated on a flag or 100+ tools. OpenAI API side: *"aim to keep each namespace to fewer than 10 functions"* ([OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search)) |
| Cursor | Yes, filesystem-based discovery | *"The agent now only receives a small bit of static context, including names of the tools, prompting it to look up tools when the task calls for it"* ([Cursor, Dynamic context discovery, 6 Jan 2026](https://cursor.com/blog/dynamic-context-discovery)) |
| Claude Desktop | UNVERIFIED | Not documented on the pages fetched |

## 3. Quoted numbers

### Token cost / savings

| Number | Claim | Source |
|---|---|---|
| 150,000 → 2,000 tokens, 98.7% saving | Google Drive → Salesforce workflow via code execution instead of direct tool calls | [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) |
| ~50,000 tokens | Extra cost of a 2-hour transcript passing through the model twice | same |
| 10,000 rows → 5 rows | Filtering in code before returning | same |
| ~55k tokens | Definitions for GitHub + Slack + Sentry + Grafana + Splunk before any work | [tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) |
| GitHub 35 tools / ~26K; Slack 11 / ~21K; Sentry 5 / ~3K; Grafana 5 / ~3K; Splunk 2 / ~2K | Per-server breakdown | [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) |
| 85% reduction | *"an 85% reduction in token usage while maintaining access to your full tool library"*; *"preserves 191,300 tokens of context compared to 122,800"* | same |
| over 85% | *"Tool search typically reduces this by over 85 percent, loading only the 3–5 tools Claude needs"* | [tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) |
| 43,588 → 27,297 tokens, 37% | Programmatic tool calling on complex research tasks | [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) |
| 46.9% | Cursor A/B: *"in runs that called an MCP tool, this strategy reduced total agent tokens by 46.9%"*; no accuracy metrics reported | [Cursor, Dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery) |
| 206 → 72 tokens | Detailed versus concise `response_format` on a Slack tool | [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) |
| ~100 / <5k / 0 tokens | Skill Level 1 / 2 / 3 costs | [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) |
| ~150,000 vs ~2,000 tokens | MCP spec's progressive-discovery diagram caption | [MCP client best practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices) |
| ~100K+ tokens vs ~200-token script + ~15-token summary | MCP spec's programmatic-tool-calling diagram | same |

### Tool-count thresholds

| Number | Claim | Source |
|---|---|---|
| 30–50 tools | *"Claude's ability to pick the right tool degrades once you exceed 30–50 available tools"* | [tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) |
| 50 tools = 10-20K tokens | *"Tool definitions can consume large portions of the context window (50 tools can use 10-20K tokens)"* | [Agent SDK tool search](https://code.claude.com/docs/en/agent-sdk/tool-search) |
| ≥10 tools, or >10k tokens of definitions, or 200+ tools | When Anthropic says to use tool search; standard calling is better *"when you have fewer than 10 tools"* | [tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) |
| ~10 tools | *"loading everything upfront is typically faster"*; tool search adds one round-trip | [Agent SDK tool search](https://code.claude.com/docs/en/agent-sdk/tool-search) |
| 1%–5% of context | MCP spec's recommended threshold for progressive discovery | [MCP client best practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices) |
| <10 functions per namespace | OpenAI's recommendation | [OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search) |
| 10,000 | Max deferred tools per request | [tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) |

### Accuracy

| Number | Claim | Source |
|---|---|---|
| 49% → 74% (Opus 4); 79.5% → 88.1% (Opus 4.5) | MCP evaluations with Tool Search Tool enabled | [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) |
| 25.6% → 28.5%; 46.5% → 51.2% | Programmatic tool calling | same |
| 72% → 90% | Tool use examples, complex parameter handling | same |
| 20.5 → 15.5 | OSWorld-MCP: removing RAG tool filtering across 158 tools | [arXiv 2510.24563](https://arxiv.org/pdf/2510.24563) |
| 43.13% vs 13.62%; >50% prompt-token cut | RAG-MCP retrieval-based tool selection | [arXiv 2505.03275](https://arxiv.org/html/2505.03275v1) |
| 87.4% at 500 tools → 65% at 2,000 | HumanMCP | [arXiv 2602.23367](https://arxiv.org/pdf/2602.23367) |

### Client operational limits

| Number | Claim | Source |
|---|---|---|
| 10,000 warn / 25,000 default max / 500,000 chars per-tool ceiling | Claude Code MCP output | [Claude Code MCP](https://code.claude.com/docs/en/mcp) |
| 1,536 chars | Claude Code skill `description` + `when_to_use` in listings | [Claude Code skills](https://code.claude.com/docs/en/skills) |
| ~1% of context | Claude Code skill listing budget | same |
| 25,000 tokens | Shared budget for carrying skills through auto-compaction | same |
| 64 chars / 1024 chars | Agent Skills spec `name` / `description` max | [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) |
| 2% of context or 8,000 chars | Codex skill-listing cap | [Codex build skills](https://learn.chatgpt.com/docs/build-skills) |
| 2,500 tokens | Codex hook `additionalContextLimit` default | [Codex hooks](https://learn.chatgpt.com/docs/hooks) |
| 30s / 600s | Claude Code hook timeout on `UserPromptSubmit` versus standard command hooks | [Claude Code hooks](https://code.claude.com/docs/en/hooks) |
| 500 lines | Cursor's guidance for rule length | [Cursor rules](https://cursor.com/docs/context/rules) |

## 4. Practitioner opinion (labelled)

Simon Willison, *"Claude Skills are awesome, maybe a bigger deal than MCP,"* 16 Oct 2025
([source](https://simonwillison.net/2025/Oct/16/claude-skills/)). Opinion, not measurement:

- *"each skill only takes up a few dozen extra tokens, with the full details only loaded in should
  the user request a task that the skill can help solve"*; GitHub's official MCP *"famously
  consumes tens of thousands of tokens of context."*
- *"Almost everything I might achieve with an MCP can be handled by a CLI tool instead. LLMs
  know how to call `cli-tool --help`."*
- His own caveat: Skills' power derives entirely from access to filesystems and command
  execution.
- Follow-up, 12 Dec 2025: OpenAI adopting skills ([source](https://simonwillison.net/2025/Dec/12/openai-skills/)).

Cursor's hedge: *"It's not clear if files will be the final interface for LLM-based tools"*
([Dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery)).

## 5. Two structural findings

**(a) The "MCP vs CLI" framing is partly obsolete in these clients.** All three coding-agent
clients converge on deferring tool definitions and discovering on demand, inside the client, so
the tool author does not choose it. The MCP spec codifies this as progressive tool discovery with
a 1–5% threshold. This narrows the token-cost gap Willison's argument rested on, though the gap
closes only where the client implements deferral; custom `ANTHROPIC_BASE_URL`, Azure Foundry and
older models fall back to upfront loading.

**(b) The mechanisms compose.** MCP spec: *"Combined with agent skills, a skill file can declare
which MCP servers it needs, and the host connects them only when that skill is invoked."* Codex
implements this via `agents/openai.yaml` `dependencies.tools`. Claude Code plugins bundle
`skills/` + `.mcp.json` + `hooks/hooks.json` + `bin/`. Anthropic: *"Skills can complement Model
Context Protocol (MCP) servers by teaching agents more complex workflows that involve external
tools and software"* ([Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)).

## 6. Decision taken for accretion

Recorded in [ADR-001](../ADR-001-engine-cli-skill.md). What the evidence means here:

1. The token-cost case for dropping MCP is mostly gone for the clients in use (Claude Code,
   Codex). It survives only on non-deferring configurations.
2. The only thing a CLI cannot do is reach a client with no shell (Claude Desktop chat, web).
3. MCP stdio is the cheapest way to keep the embedding model warm; the CLI needs an on-disk index
   snapshot to be comparably fast and stays keyword-only by default.
4. Twenty-one tools was the wrong number regardless: Anthropic's guidance is under ten.
5. Whatever is kept must not be a second implementation. One command spec generates both the CLI
   subcommand and the MCP tool.
6. Passive recall via hooks needs a mitigation the other surfaces get for free: the injected block
   is framed as retrieved data, and raw session notes are never injected.

**Option A, adopted:** a thin stdio MCP adapter, at most six tools (`search`, `brief`,
`context`, `read`, `list`, `propose`), generated from the CLI's command spec. Lifecycle stays
CLI-only. The HTTP transport, bearer auth, CORS, rate limiting, session TTL, DNS-rebinding guard,
server launchd template and Dockerfile server target are removed. No evidence supports a
long-running HTTP server for a single-user localhost tool.

Option B (remove MCP entirely) was rejected on reach grounds; it remains reversible from the same
command spec.

## Unverified

1. Cursor's 40-tool cap. Widely repeated, but not present in current Cursor docs
   ([cursor.com/docs/mcp](https://cursor.com/docs/mcp), [cursor.com/docs/context/mcp](https://cursor.com/docs/context/mcp)).
   Only [Cursor community forum threads](https://forum.cursor.com/t/tools-limited-to-40-total/67976)
   and secondary blogs. Community reports of a raise to 80 are also unconfirmed. Likely obsolete
   after the January 2026 dynamic-context-discovery shift.
2. "Claude Code's quality degradation point at 50" / "OpenAI Tools API limit at 128" / "Claude's
   tool-list capacity near 120" appear in a [third-party blog](https://getunblocked.com/blog/mcp-tool-overload/);
   only the 30–50 figure is confirmed in Anthropic docs.
3. "Hooks and sub-agents run only in Cowork, so they appear grayed out in chat" could not be
   confirmed in [support.claude.com/en/articles/12512180](https://support.claude.com/en/articles/12512180-use-skills-in-claude).
   Treat Claude Desktop hook support as unverified; what is confirmed is that Claude Desktop
   plugins can bundle a `hooks/` directory.
4. The "191,300 vs 122,800 tokens" figure is quoted verbatim from Anthropic but stated without a
   defined baseline; prefer the "85%" and "~55k" figures.
5. Cursor `beforeSubmitPrompt` context injection: the event exists, but docs only document
   `additional_context` on `sessionStart` and `postToolUse`.
6. Claude Code "10K tokens" activation threshold for tool search: the 10% of context figure is
   primary (`ENABLE_TOOL_SEARCH=auto`); the "10K tokens" variant is from
   [secondary blogs](https://claudelog.com/faqs/what-is-tool-search-in-claude-code/). The "147
   tool definitions ≈ 90,000 tokens → ~15,000" numbers are secondary and unverified.
7. `defer_loading` in `.claude.json` `mcpServers`: an [open issue (#26844)](https://github.com/anthropics/claude-code/issues/26844)
   reports it has no effect; Claude Code documents `alwaysLoad` to exempt a server. In flux.
8. BFCL-specific tool-count scaling numbers ("79-100% accuracy drops from ~50 to ~740 tools")
   came from a [Medium post](https://achan2013.medium.com/how-tool-complexity-impacts-ai-agents-selection-accuracy-a3b6280ddce5),
   not the [BFCL paper](https://proceedings.mlr.press/v267/patil25a.html). The chance-correction
   paper ([arXiv 2605.24660](https://arxiv.org/pdf/2605.24660), Repantis et al., June 2026)
   argues part of the observed degradation is an artifact of the rising random-selection baseline.

## Sources

- [Anthropic, Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Anthropic, Writing effective tools for agents (11 Sep 2025)](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic, Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Anthropic, Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- [Claude Platform, Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Claude Platform, Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- [Claude Code, MCP](https://code.claude.com/docs/en/mcp) · [Skills](https://code.claude.com/docs/en/skills) · [Hooks](https://code.claude.com/docs/en/hooks) · [Plugins](https://code.claude.com/docs/en/plugins) · [Agent SDK tool search](https://code.claude.com/docs/en/agent-sdk/tool-search)
- [Claude Desktop, MCP, plugins, skills, and hooks](https://claude.com/docs/third-party/claude-desktop/extensions) · [Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude)
- [MCP, Tools spec (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) · [Architecture (2026-07-28)](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) · [Client best practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices)
- [Agent Skills, agentskills.io](https://agentskills.io/)
- [Codex, MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) · [Build skills](https://learn.chatgpt.com/docs/build-skills) · [Hooks](https://learn.chatgpt.com/docs/hooks) · [PR #29486](https://github.com/openai/codex/pull/29486) · [OpenAI tool search guide](https://developers.openai.com/api/docs/guides/tools-tool-search)
- [Cursor, MCP](https://cursor.com/docs/context/mcp) · [Skills](https://cursor.com/docs/context/skills) · [Rules](https://cursor.com/docs/context/rules) · [Hooks](https://cursor.com/docs/agent/hooks) · [Dynamic context discovery (6 Jan 2026)](https://cursor.com/blog/dynamic-context-discovery)
- [Simon Willison, Claude Skills are awesome, maybe a bigger deal than MCP](https://simonwillison.net/2025/Oct/16/claude-skills/) · [OpenAI are quietly adopting skills](https://simonwillison.net/2025/Dec/12/openai-skills/)
- Papers: [BFCL (ICML 2025)](https://proceedings.mlr.press/v267/patil25a.html) · [RAG-MCP](https://arxiv.org/html/2505.03275v1) · [OSWorld-MCP](https://arxiv.org/pdf/2510.24563) · [HumanMCP](https://arxiv.org/pdf/2602.23367) · [How Many Tools Should an LLM Agent See?](https://arxiv.org/pdf/2605.24660)
- Secondary (unverified items only): [Cursor forum](https://forum.cursor.com/t/tools-limited-to-40-total/67976) · [getunblocked.com](https://getunblocked.com/blog/mcp-tool-overload/) · [claudelog.com](https://claudelog.com/faqs/what-is-tool-search-in-claude-code/) · [Medium](https://achan2013.medium.com/how-tool-complexity-impacts-ai-agents-selection-accuracy-a3b6280ddce5) · [claude-code#26844](https://github.com/anthropics/claude-code/issues/26844)

## Related surveys

Three further surveys of the memory landscape, gathered 2026-09-08 from primary sources:

- [memory-products-2026.md](memory-products-2026.md): Mem0, Zep/Graphiti, Letta (MemFS), LangMem, A-MEM, Cognee, Supermemory, Memori, and what the LoCoMo, LongMemEval and BEAM benchmarks actually measure.
- [agent-native-memory-2026.md](agent-native-memory-2026.md): how Claude Code, Codex, ChatGPT, Cursor, Windsurf and Gemini CLI handle memory and compaction, plus named practitioner setups.
- [llm-wiki-landscape-2026.md](llm-wiki-landscape-2026.md): implementations that followed Karpathy's llm-wiki gist, what broke for them, and the 2025 to 2026 research on memory architectures and their evaluation.
