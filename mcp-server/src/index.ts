#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Agent {
  slug: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  vibe: string;
  category: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Agent directories (relative to repo root)
// ---------------------------------------------------------------------------

const AGENT_DIRS = [
  "design",
  "engineering",
  "game-development",
  "marketing",
  "paid-media",
  "product",
  "project-management",
  "testing",
  "support",
  "spatial-computing",
  "specialized",
];

const CATEGORIES = AGENT_DIRS.map((d) => d.replace(/-/g, " "));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getRepoRoot(): string {
  if (process.env.AGENCY_AGENTS_ROOT) {
    return process.env.AGENCY_AGENTS_ROOT;
  }
  // dist/index.js -> mcp-server/ -> repo root
  return path.resolve(__dirname, "..", "..");
}

function parseFrontmatter(content: string): {
  fields: Record<string, string>;
  body: string;
} {
  const lines = content.split("\n");
  if (lines[0] !== "---") return { fields: {}, body: content };

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return { fields: {}, body: content };

  const fields: Record<string, string> = {};
  for (let i = 1; i < endIdx; i++) {
    const colonIdx = lines[i].indexOf(": ");
    if (colonIdx > 0) {
      const key = lines[i].slice(0, colonIdx).trim();
      const value = lines[i].slice(colonIdx + 2).trim();
      fields[key] = value;
    }
  }

  const body = lines.slice(endIdx + 1).join("\n").trim();
  return { fields, body };
}

function loadAgents(repoRoot: string): Agent[] {
  const agents: Agent[] = [];

  for (const dir of AGENT_DIRS) {
    const dirPath = path.join(repoRoot, dir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith(".md"))
      .sort();

    for (const file of files) {
      const content = fs.readFileSync(path.join(dirPath, file), "utf-8");
      const { fields, body } = parseFrontmatter(content);
      if (!fields.name) continue;

      agents.push({
        slug: slugify(fields.name),
        name: fields.name,
        description: fields.description || "",
        emoji: fields.emoji || "",
        color: fields.color || "",
        vibe: fields.vibe || "",
        category: dir,
        body,
      });
    }
  }

  return agents;
}

// ---------------------------------------------------------------------------
// Load agents once at startup
// ---------------------------------------------------------------------------

const repoRoot = getRepoRoot();
const agents = loadAgents(repoRoot);

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "agency-agents",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tool: list_agents
// ---------------------------------------------------------------------------

server.tool(
  "list_agents",
  "List all available AI agents from The Agency. Returns name, slug, description, emoji, and category for each agent. Optionally filter by category.",
  {
    category: z
      .string()
      .optional()
      .describe(
        `Filter by category: ${AGENT_DIRS.join(", ")}`
      ),
  },
  async ({ category }) => {
    let filtered = agents;
    if (category) {
      const q = category.toLowerCase().replace(/\s+/g, "-");
      filtered = agents.filter((a) => a.category === q);
    }

    const lines = filtered.map(
      (a) => `${a.emoji} **${a.name}** (\`${a.slug}\`) — ${a.category}\n  ${a.description}`
    );

    const header = category
      ? `## Agents in "${category}" (${filtered.length})`
      : `## All Agents (${filtered.length})`;

    return {
      content: [
        {
          type: "text" as const,
          text: `${header}\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: get_agent
// ---------------------------------------------------------------------------

server.tool(
  "get_agent",
  "Get the full personality, rules, and instructions for a specific AI agent. Use this to adopt an agent's expertise. Pass the agent slug (e.g. 'frontend-developer') or full name.",
  {
    agent: z
      .string()
      .describe(
        "Agent slug (e.g. 'frontend-developer') or name (e.g. 'Frontend Developer')"
      ),
  },
  async ({ agent: query }) => {
    const q = query.toLowerCase();
    const found = agents.find(
      (a) =>
        a.slug === q ||
        a.name.toLowerCase() === q ||
        a.slug === slugify(q)
    );

    if (!found) {
      const suggestions = agents
        .filter(
          (a) =>
            a.slug.includes(q) ||
            a.name.toLowerCase().includes(q) ||
            a.description.toLowerCase().includes(q)
        )
        .slice(0, 5);

      let msg = `Agent '${query}' not found.`;
      if (suggestions.length > 0) {
        msg += ` Did you mean:\n${suggestions.map((a) => `  - ${a.emoji} ${a.name} (\`${a.slug}\`)`).join("\n")}`;
      } else {
        msg += " Use list_agents to see all available agents.";
      }

      return {
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: found.body,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: search_agents
// ---------------------------------------------------------------------------

server.tool(
  "search_agents",
  "Search for agents by keyword. Matches against name, description, category, and vibe.",
  {
    query: z.string().describe("Search keyword or phrase"),
  },
  async ({ query }) => {
    const q = query.toLowerCase();
    const results = agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.category.includes(q) ||
        a.vibe.toLowerCase().includes(q)
    );

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No agents found matching '${query}'. Use list_agents to see all available agents.`,
          },
        ],
      };
    }

    const lines = results.map(
      (a) => `${a.emoji} **${a.name}** (\`${a.slug}\`) — ${a.category}\n  ${a.description}`
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `## Search results for "${query}" (${results.length} matches)\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Resources: each agent exposed as a readable resource
// ---------------------------------------------------------------------------

for (const agent of agents) {
  server.resource(
    agent.slug,
    `agency://agents/${agent.slug}`,
    {
      description: `${agent.emoji} ${agent.name}: ${agent.description}`,
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: `agency://agents/${agent.slug}`,
          mimeType: "text/markdown",
          text: agent.body,
        },
      ],
    })
  );
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
