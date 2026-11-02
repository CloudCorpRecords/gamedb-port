# gamedb-port — Build Report

MCP Rebuild 1000, Tranche Batch 4 (builder 4 of 8). Clean-room
rebuild of bielacki/igdb-mcp-server (candidate
ai.smithery/bielacki-igdb-mcp-server, rank 136, 5 stars, tier C),
built from the public README spec captured in
`harness/fixtures/igdb-mcp-server-tools-original.json`. That fixture
is docs-derived: the 4 tools are the full documented set and the
argument schemas are documented reconstructions from the README
tool table plus the IGDB API contract — no original server was
probed. Parity proves the rebuild matches this program's defined
spec, labelled docs-derived. Local build only — nothing pushed or
published.

Identity: repo `gamedb-port`, npm `@reneturcios/gamedb-port`,
MCP name `io.github.CloudCorpRecords/gamedb-port`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `gamedb-port: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "IGDB game database: search games,
  game details, anticipated releases, and custom queries." =
  **89 chars** (≤100 ✓); npm entry carries `version: 0.1.0`; OCI
  entry `ghcr.io/cloudcorprecords/gamedb-port:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/gamedb-port"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`search`, `details`, `anticipated`,
  `query`, `mcp`, `--version`; exit 2 usage / 1 API or credential
  error), `src/mcp.ts`, `src/types.ts`, `src/gamedb.ts` (core
  logic, `VERSION = "0.1.0"`)
- `test/gamedb.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to gamedb-port)

## Tools implemented (4)

`search_games`, `get_game_details`, `get_most_anticipated_games`,
`custom_query` — the full documented set, as recorded in the
fixture `_source`.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals, per the standing fleet rule: `McpServer`'s
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys that are absent from the defined spec
  and break exact schema parity. Zod still validates every
  `tools/call`.
- Authentication follows the documented IGDB contract: a Twitch
  OAuth client-credentials token is POSTed from
  `https://id.twitch.tv/oauth2/token` with
  `client_id`/`client_secret`/`grant_type=client_credentials`
  form fields, using env `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET`.
  Missing or blank either credential throws before any request is
  made (verified by tests and by a no-credential CLI/MCP smoke).
  The token is cached in-process on the shared `GameDbClient` and
  reused until 60 seconds before its `expires_in` lifetime ends.
- Data calls POST to `https://api.igdb.com/v4/<endpoint>` with
  `Client-ID` and `Authorization: Bearer <token>` headers and an
  Apicalypse text body the rebuild constructs:
  - `search_games` → `search "<query>"; fields <fields>; limit <n>;`
    (query escaped for quotes/backslashes; limit 1–500, default 10)
  - `get_game_details` → `fields <fields>; where id = <game_id>;`
  - `get_most_anticipated_games` → `fields <fields>; where
    first_release_date > <now> & hypes >= <min_hypes>; sort hypes
    desc; limit <n>;` (limit default 25, min_hypes default 25)
  - `custom_query` → the caller's `query` body verbatim to
    `/<endpoint>` (leading slash stripped)
  When `fields` is omitted, the default field set
  `name,cover.url,first_release_date,genres.name,platforms.name,rating,summary`
  is used — a documented local choice (see Gaps).
- Validation runs before any request: empty query/endpoint,
  non-positive game_id, limit outside 1–500, and negative
  min_hypes all fail in the core (and are double-checked by the
  zod schemas in the MCP layer).
- HTTP failures surface the status plus the upstream `message` or
  `error` string when present, or the `title` of IGDB's
  array-shaped error payloads.
- All HTTP flows through an injectable `FetchFn` (types.ts). The
  test suite uses a fake fetch that routes the token endpoint and
  the IGDB endpoint to hand-written fixtures; no live call is made
  in tests.

## Verification (foreground, exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced, including `dist/cli.js`.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 24
ℹ pass 24
ℹ fail 0
```
Covers: credential resolution and both missing-credential errors
(zero requests made); token request shape (URL, POST, form fields
incl. `grant_type=client_credentials`) and Client-ID/Bearer header
propagation; token caching and refetch at the expiry boundary;
token response without `access_token`; token HTTP error surfacing;
search body with defaults, with caller fields/limit, and with
quote/backslash escaping; empty-query and limit-range (0 and 501)
rejection before any request; details body with defaults and
caller fields; non-positive game_id rejection; anticipated body
with defaults at an injected `now` and with fields/limit/min_hypes
overrides; negative min_hypes and over-range limit rejection;
custom query verbatim body, endpoint routing, and leading-slash
stripping; empty endpoint/query rejection; API HTTP 401 surfacing
the upstream message; array-shaped error payload surfacing its
title; network failure wrapping.

### 3. CLI / MCP smoke
`--version` → `0.1.0` (exit 0); unknown command exits 2 with
Usage; `search zelda` with credentials unset → exit 1 with
`IGDB_CLIENT_ID is not set` (no request attempted). MCP
`initialize` over stdio → `serverInfo: {"name":"gamedb-port","version":"0.1.0"}`;
stdio `tools/list` returned the 4 tools; a stdio `tools/call` for
`search_games` with credentials unset returned an `isError` result
carrying the missing-credential message. No live IGDB or Twitch
call was made in smoke, and no live result is claimed.

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
```
$ python3 parity.py --original fixtures/igdb-mcp-server-tools-original.json \
    --rebuild "stdio:node .../builds/gamedb-port/dist/cli.js mcp" \
    --out .../builds/gamedb-port/parity-out
verdict=PASS parity_pct=100.0 original_tools=4 rebuild_tools=4 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
(parity.json: identical_tools 4/4.) Original side is tools-file
mode, so `fixture_results` records `SKIPPED-TOOLS-FILE-MODE` —
expected harness semantics, not an error.

## Lockfile status

`package-lock.json` was generated clean via Route 3: a temp copy
(`/tmp/gamedb-port-lock/`) holding only `package.json` (no
`node_modules`), offline
`npm install --package-lock-only --ignore-scripts`, verified after
generation — parses as JSON, top-level `name` is
`@reneturcios/gamedb-port`, version `0.1.0`, `lockfileVersion` 3,
128 package entries — then only the lockfile was copied back.
Local `node_modules` is a sibling copy (fxrates) used only for the
local build/test; it is not part of the lockfile generation.

## Gaps / honest notes

- Docs-derived spec: the argument schemas are documented
  reconstructions from the public README tool table and the IGDB
  API contract, per the task spec — no original igdb-mcp-server
  was probed, so parity proves the rebuild matches this program's
  defined spec, not a hand-probed original.
- The README documents tool names, parameters, and defaults but
  not the default field set used when `fields` is omitted; the
  rebuild's `name,cover.url,first_release_date,genres.name,platforms.name,rating,summary`
  default is a documented local choice.
- No live call was made: every endpoint is fake-fetch tested
  only, so live behaviour against id.twitch.tv / api.igdb.com
  (including real token lifetimes and IGDB response shapes) is
  unverified until the publish wave.
- The anticipated-games `now` is the current Unix time at call
  time (an injectable parameter exists for tests); the original's
  exact clock semantics are not in the public spec.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
