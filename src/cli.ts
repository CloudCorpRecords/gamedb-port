#!/usr/bin/env node
/**
 * gamedb-port CLI.
 *
 *   gamedb-port search <query> [--fields name,rating] [--limit 10]
 *   gamedb-port details <game_id> [--fields name,summary]
 *   gamedb-port anticipated [--fields name,hypes] [--limit 25] [--min-hypes 25]
 *   gamedb-port query <endpoint> <apicalypse>
 *   gamedb-port mcp
 *
 * Credentials come from IGDB_CLIENT_ID and IGDB_CLIENT_SECRET; both
 * must be set or every data command fails before any request.
 * Exit codes: 0 success, 1 API/credential error, 2 usage error.
 */
import { createClient, formatPayload, VERSION } from "./gamedb.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  gamedb-port search <query> [--fields name,rating] [--limit 10]
  gamedb-port details <game_id> [--fields name,summary]
  gamedb-port anticipated [--fields name,hypes] [--limit 25] [--min-hypes 25]
  gamedb-port query <endpoint> <apicalypse>
  gamedb-port mcp
  gamedb-port --version`);
  process.exit(2);
}

function flag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

function numberFlag(rest: string[], name: string): number | undefined {
  const raw = flag(rest, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) usage();
  return n;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const known = ["search", "details", "anticipated", "query"];
  if (!known.includes(cmd)) usage();
  try {
    const client = createClient(globalThis.fetch as unknown as FetchFn, process.env);
    let out: unknown;
    if (cmd === "search") {
      if (!rest[0]) usage();
      out = await client.searchGames({
        query: rest[0],
        fields: flag(rest, "--fields"),
        limit: numberFlag(rest, "--limit"),
      });
    } else if (cmd === "details") {
      if (!rest[0]) usage();
      const gameId = Number(rest[0]);
      if (!Number.isFinite(gameId)) usage();
      out = await client.getGameDetails({ game_id: gameId, fields: flag(rest, "--fields") });
    } else if (cmd === "anticipated") {
      out = await client.getMostAnticipatedGames({
        fields: flag(rest, "--fields"),
        limit: numberFlag(rest, "--limit"),
        min_hypes: numberFlag(rest, "--min-hypes"),
      });
    } else {
      if (!rest[0] || !rest[1]) usage();
      out = await client.customQuery({ endpoint: rest[0], query: rest[1] });
    }
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
