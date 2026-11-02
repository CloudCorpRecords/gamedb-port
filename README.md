# gamedb-port

gamedb-port queries the IGDB video-game database: search games by
name, pull the full record for one game, list the most anticipated
upcoming releases ranked by hype, or send a raw Apicalypse query to
any IGDB endpoint. One binary serves a command-line interface and a
stdio MCP server.

Access uses the documented IGDB contract. IGDB is authenticated
through Twitch OAuth: set `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`
to your Twitch application credentials. The tool exchanges them for
a client-credentials access token, caches it in-process, and sends
it with a `Client-ID` header on every call. If either variable is
missing, commands fail before any request is made.

## Install

```bash
IGDB_CLIENT_ID=... IGDB_CLIENT_SECRET=... npx @reneturcios/gamedb-port search zelda
```

Or run the container image:

```bash
docker run -i -e IGDB_CLIENT_ID=... -e IGDB_CLIENT_SECRET=... ghcr.io/cloudcorprecords/gamedb-port
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
gamedb-port search zelda --limit 5
gamedb-port search "final fantasy" --fields name,rating --limit 20
gamedb-port details 1942
gamedb-port details 1942 --fields name,summary,genres.name
gamedb-port anticipated
gamedb-port anticipated --limit 10 --min-hypes 50
gamedb-port query genres "fields name,slug; limit 5;"

gamedb-port --version
```

Commands print the upstream JSON payload. Exit codes: `0` on
success, `1` when a call fails (missing credentials, an upstream
API error, or invalid argument values), `2` for usage errors.

When no `--fields` is given, queries request a default field set:
`name,cover.url,first_release_date,genres.name,platforms.name,rating,summary`.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/gamedb-port mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "gamedb-port": {
      "command": "npx",
      "args": ["-y", "@reneturcios/gamedb-port", "mcp"],
      "env": {
        "IGDB_CLIENT_ID": "your-twitch-client-id",
        "IGDB_CLIENT_SECRET": "your-twitch-client-secret"
      }
    }
  }
}
```

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `search_games` | `query` (required), `fields`, `limit` (1–500, default 10) | Games matching the name search. |
| `get_game_details` | `game_id` (required), `fields` | The full IGDB record for one game. |
| `get_most_anticipated_games` | `fields`, `limit` (1–500, default 25), `min_hypes` (default 25) | Upcoming games with a future release date, sorted by hype descending. |
| `custom_query` | `endpoint`, `query` (both required) | Whatever the caller's Apicalypse query returns from that endpoint. |

The three shaped tools build their Apicalypse bodies for you:
`search_games` becomes `search "<query>"; fields ...; limit ...;`,
`get_game_details` becomes `fields ...; where id = <game_id>;`, and
`get_most_anticipated_games` filters `first_release_date > now &
hypes >= <min_hypes>` and sorts by `hypes desc`. `custom_query`
sends its `query` body verbatim to `https://api.igdb.com/v4/<endpoint>`.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
