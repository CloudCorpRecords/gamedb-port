import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  API_BASE_URL,
  createClient,
  DEFAULT_FIELDS,
  escapeSearchTerm,
  GameDbClient,
  resolveCredentials,
  TOKEN_URL,
} from "../src/gamedb.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

function jsonResponse(body: unknown, status = 200, statusText = "OK"): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

interface Call {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface FakeOptions {
  tokenBody?: unknown;
  tokenStatus?: number;
  tokenStatusText?: string;
  apiBody?: unknown;
  apiStatus?: number;
  apiStatusText?: string;
}

/** Fake fetch: token endpoint answers a token, IGDB answers games. */
function fakeFetch(calls: Call[], opts: FakeOptions = {}): FetchFn {
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    if (url === TOKEN_URL) {
      return jsonResponse(
        opts.tokenBody ?? { access_token: "tok-123", expires_in: 5099, token_type: "bearer" },
        opts.tokenStatus ?? 200,
        opts.tokenStatusText ?? "OK",
      );
    }
    return jsonResponse(
      opts.apiBody ?? [{ id: 1942, name: "The Legend of Zelda" }],
      opts.apiStatus ?? 200,
      opts.apiStatusText ?? "OK",
    );
  };
}

const CREDS = { clientId: "cid-1", clientSecret: "secret-1" };
const ENV = { IGDB_CLIENT_ID: "cid-1", IGDB_CLIENT_SECRET: "secret-1" };

describe("credentials", () => {
  it("resolves a complete credential pair from the env", () => {
    assert.deepEqual(resolveCredentials(ENV), CREDS);
  });

  it("missing client id errors before any request", async () => {
    const calls: Call[] = [];
    assert.throws(
      () => createClient(fakeFetch(calls), { IGDB_CLIENT_SECRET: "secret-1" }),
      /IGDB_CLIENT_ID is not set/,
    );
    assert.equal(calls.length, 0);
  });

  it("missing client secret errors before any request", async () => {
    const calls: Call[] = [];
    assert.throws(
      () => createClient(fakeFetch(calls), { IGDB_CLIENT_ID: "cid-1", IGDB_CLIENT_SECRET: "  " }),
      /IGDB_CLIENT_SECRET is not set/,
    );
    assert.equal(calls.length, 0);
  });
});

describe("token flow", () => {
  it("requests a client-credentials token before the first API call", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await client.searchGames({ query: "zelda" });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, TOKEN_URL);
    assert.equal(calls[0].method, "POST");
    const params = new URLSearchParams(calls[0].body ?? "");
    assert.equal(params.get("client_id"), "cid-1");
    assert.equal(params.get("client_secret"), "secret-1");
    assert.equal(params.get("grant_type"), "client_credentials");
    assert.equal(calls[1].headers?.["Client-ID"], "cid-1");
    assert.equal(calls[1].headers?.Authorization, "Bearer tok-123");
  });

  it("reuses the cached token across calls until near expiry", async () => {
    const calls: Call[] = [];
    const client = new GameDbClient(fakeFetch(calls), CREDS);
    const t0 = 1_000_000;
    assert.equal(await client.accessToken(t0), "tok-123");
    assert.equal(await client.accessToken(t0 + 60_000), "tok-123");
    assert.equal(calls.length, 1);
    // expires_in 5099 minus the 60s safety margin: at that instant it refetches.
    assert.equal(await client.accessToken(t0 + 5039 * 1000), "tok-123");
    assert.equal(calls.length, 2);
  });

  it("a token response without access_token is an error", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls, { tokenBody: { expires_in: 10 } }), ENV);
    await assert.rejects(() => client.searchGames({ query: "zelda" }), /did not include an access_token/);
    assert.equal(calls.length, 1);
  });

  it("token HTTP failure surfaces status and upstream message", async () => {
    const calls: Call[] = [];
    const client = createClient(
      fakeFetch(calls, { tokenStatus: 400, tokenStatusText: "Bad Request", tokenBody: { message: "invalid client" } }),
      ENV,
    );
    await assert.rejects(() => client.searchGames({ query: "zelda" }), /Twitch OAuth token request failed: HTTP 400.*invalid client/);
  });
});

describe("search_games", () => {
  it("posts the default Apicalypse search body to /games", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    const out = (await client.searchGames({ query: "zelda" })) as Array<Record<string, unknown>>;
    assert.equal(out[0].name, "The Legend of Zelda");
    const api = calls[1];
    assert.equal(api.url, `${API_BASE_URL}/games`);
    assert.equal(api.method, "POST");
    assert.equal(api.body, `search "zelda"; fields ${DEFAULT_FIELDS}; limit 10;`);
  });

  it("honours caller fields and limit", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await client.searchGames({ query: "mario", fields: "name,rating", limit: 5 });
    assert.equal(calls[1].body, `search "mario"; fields name,rating; limit 5;`);
  });

  it("escapes quotes and backslashes in the search term", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await client.searchGames({ query: 'a "b" \\ c' });
    assert.equal(calls[1].body, `search "a \\"b\\" \\\\ c"; fields ${DEFAULT_FIELDS}; limit 10;`);
    assert.equal(escapeSearchTerm('x"y'), 'x\\"y');
  });

  it("rejects an empty query before any request", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await assert.rejects(() => client.searchGames({ query: "  " }), /query must be a non-empty string/);
    assert.equal(calls.length, 0);
  });

  it("rejects out-of-range limits before any request", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await assert.rejects(() => client.searchGames({ query: "x", limit: 0 }), /limit must be a number between 1 and 500/);
    await assert.rejects(() => client.searchGames({ query: "x", limit: 501 }), /between 1 and 500/);
    assert.equal(calls.length, 0);
  });
});

describe("get_game_details", () => {
  it("posts fields plus a where id clause to /games", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await client.getGameDetails({ game_id: 1942 });
    assert.equal(calls[1].url, `${API_BASE_URL}/games`);
    assert.equal(calls[1].body, `fields ${DEFAULT_FIELDS}; where id = 1942;`);
  });

  it("honours caller fields", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await client.getGameDetails({ game_id: 7, fields: "name,summary" });
    assert.equal(calls[1].body, "fields name,summary; where id = 7;");
  });

  it("rejects a non-positive game id before any request", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await assert.rejects(() => client.getGameDetails({ game_id: 0 }), /game_id must be a positive number/);
    assert.equal(calls.length, 0);
  });
});

describe("get_most_anticipated_games", () => {
  it("posts the hype-sorted future-release body with defaults", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await client.getMostAnticipatedGames({}, 1_700_000_000);
    assert.equal(calls[1].url, `${API_BASE_URL}/games`);
    assert.equal(
      calls[1].body,
      `fields ${DEFAULT_FIELDS}; where first_release_date > 1700000000 & hypes >= 25; sort hypes desc; limit 25;`,
    );
  });

  it("honours fields, limit, and min_hypes overrides", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await client.getMostAnticipatedGames({ fields: "name,hypes", limit: 3, min_hypes: 100 }, 1_700_000_000);
    assert.equal(
      calls[1].body,
      "fields name,hypes; where first_release_date > 1700000000 & hypes >= 100; sort hypes desc; limit 3;",
    );
  });

  it("rejects a negative min_hypes and an over-range limit", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await assert.rejects(() => client.getMostAnticipatedGames({ min_hypes: -1 }), /min_hypes/);
    await assert.rejects(() => client.getMostAnticipatedGames({ limit: 999 }), /between 1 and 500/);
    assert.equal(calls.length, 0);
  });
});

describe("custom_query", () => {
  it("posts the caller's Apicalypse body verbatim to the named endpoint", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    const body = "fields name,slug; where rating > 90; limit 2;";
    await client.customQuery({ endpoint: "genres", query: body });
    assert.equal(calls[1].url, `${API_BASE_URL}/genres`);
    assert.equal(calls[1].body, body);
  });

  it("strips a leading slash from the endpoint", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await client.customQuery({ endpoint: "/platforms", query: "fields name;" });
    assert.equal(calls[1].url, `${API_BASE_URL}/platforms`);
  });

  it("rejects an empty endpoint or query before any request", async () => {
    const calls: Call[] = [];
    const client = createClient(fakeFetch(calls), ENV);
    await assert.rejects(() => client.customQuery({ endpoint: " ", query: "fields name;" }), /endpoint must be a non-empty string/);
    await assert.rejects(() => client.customQuery({ endpoint: "games", query: "" }), /query must be a non-empty string/);
    assert.equal(calls.length, 0);
  });
});

describe("errors", () => {
  it("API HTTP failure surfaces status and upstream message", async () => {
    const calls: Call[] = [];
    const client = createClient(
      fakeFetch(calls, { apiStatus: 401, apiStatusText: "Unauthorized", apiBody: { message: "bad token" } }),
      ENV,
    );
    await assert.rejects(() => client.searchGames({ query: "zelda" }), /IGDB API request failed: HTTP 401.*bad token/);
  });

  it("API array-shaped error payload surfaces its title", async () => {
    const calls: Call[] = [];
    const client = createClient(
      fakeFetch(calls, { apiStatus: 400, apiStatusText: "Bad Request", apiBody: [{ title: "Syntax Error" }] }),
      ENV,
    );
    await assert.rejects(() => client.customQuery({ endpoint: "games", query: "bogus;" }), /HTTP 400.*Syntax Error/);
  });

  it("network failure on the API call is wrapped with context", async () => {
    const failing: FetchFn = async (url: string) => {
      if (url === TOKEN_URL) return jsonResponse({ access_token: "tok-123", expires_in: 5099 });
      throw new Error("socket hang up");
    };
    const client = createClient(failing, ENV);
    await assert.rejects(() => client.searchGames({ query: "zelda" }), /IGDB API request failed: socket hang up/);
  });
});
