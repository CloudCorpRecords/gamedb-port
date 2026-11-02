/**
 * gamedb-port MCP server. Tools: search_games, get_game_details,
 * get_most_anticipated_games, custom_query.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys that
 * are not in this tool's public spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schemas as explicit literals, while zod still
 * validates every tools/call argument set.
 *
 * Credentials are read from IGDB_CLIENT_ID / IGDB_CLIENT_SECRET at
 * call time; a missing credential fails the call before any request.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createClient,
  formatPayload,
  VERSION,
  type GameDbClient,
} from "./gamedb.js";
import type { FetchFn } from "./types.js";

const SearchArgs = z.object({
  query: z.string(),
  fields: z.string().optional(),
  limit: z.number().min(1).max(500).optional(),
});
const DetailsArgs = z.object({
  game_id: z.number(),
  fields: z.string().optional(),
});
const AnticipatedArgs = z.object({
  fields: z.string().optional(),
  limit: z.number().min(1).max(500).optional(),
  min_hypes: z.number().min(0).optional(),
});
const CustomArgs = z.object({
  endpoint: z.string(),
  query: z.string(),
});

const TOOLS = [
  {
    name: "search_games",
    description: "Search for games by name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Game name to search for." },
        fields: { type: "string", description: "Comma-separated IGDB fields to return." },
        limit: { type: "number", description: "Maximum number of results to return, from 1 to 500." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_game_details",
    description: "Get comprehensive game information.",
    inputSchema: {
      type: "object" as const,
      properties: {
        game_id: { type: "number", description: "IGDB ID of the game to retrieve." },
        fields: { type: "string", description: "Comma-separated IGDB fields to return." },
      },
      required: ["game_id"],
    },
  },
  {
    name: "get_most_anticipated_games",
    description: "Find upcoming games by hype.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fields: { type: "string", description: "Comma-separated IGDB fields to return." },
        limit: { type: "number", description: "Maximum number of results to return, from 1 to 500." },
        min_hypes: { type: "number", description: "Minimum hype count for included games." },
      },
    },
  },
  {
    name: "custom_query",
    description: "Execute Apicalypse queries.",
    inputSchema: {
      type: "object" as const,
      properties: {
        endpoint: { type: "string", description: "IGDB API endpoint to query, such as games." },
        query: { type: "string", description: "Apicalypse query body to execute." },
      },
      required: ["endpoint", "query"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

let client: GameDbClient | undefined;

/** One shared client per process, so the OAuth token stays cached. */
function getClient(): GameDbClient {
  if (!client) {
    client = createClient(globalThis.fetch as unknown as FetchFn, process.env);
  }
  return client;
}

const server = new Server(
  { name: "gamedb-port", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "search_games") {
      out = await getClient().searchGames(SearchArgs.parse(args ?? {}));
    } else if (name === "get_game_details") {
      out = await getClient().getGameDetails(DetailsArgs.parse(args ?? {}));
    } else if (name === "get_most_anticipated_games") {
      out = await getClient().getMostAnticipatedGames(AnticipatedArgs.parse(args ?? {}));
    } else if (name === "custom_query") {
      out = await getClient().customQuery(CustomArgs.parse(args ?? {}));
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
