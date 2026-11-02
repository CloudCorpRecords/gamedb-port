# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `gamedb-port search|details|anticipated|query` and
  `gamedb-port mcp`.
- MCP server (`gamedb-port mcp`, stdio) with four tools:
  `search_games`, `get_game_details`, `get_most_anticipated_games`,
  and `custom_query`.
- Authentication follows the IGDB contract: a Twitch OAuth
  client-credentials token is fetched from
  `https://id.twitch.tv/oauth2/token` using `IGDB_CLIENT_ID` and
  `IGDB_CLIENT_SECRET`, cached in-process, and sent as a Bearer
  token with a `Client-ID` header to `https://api.igdb.com/v4`.
  Missing credentials fail before any request.
- The shaped tools construct their Apicalypse bodies locally
  (search clause, `where id = ...`, and the future-release hype
  filter with `sort hypes desc`); `custom_query` sends the caller's
  body verbatim to the named endpoint.
- HTTP failures surface the status plus the upstream `message`,
  `error`, or array-shaped `title` when present.
- All HTTP goes through an injectable fetch function, so the test
  suite runs entirely on hand-written fixtures with no network access.
