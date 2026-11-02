/**
 * gamedb-port core: four tools against the IGDB API.
 *
 *   search_games               POST /v4/games, Apicalypse search body
 *   get_game_details           POST /v4/games, fields + where id = ...
 *   get_most_anticipated_games POST /v4/games, future releases sorted
 *                              by hypes above a minimum threshold
 *   custom_query               POST /v4/<endpoint>, caller-supplied
 *                              Apicalypse body sent verbatim
 *
 * Authentication follows the documented IGDB contract: a Twitch
 * OAuth client-credentials token is fetched from
 * https://id.twitch.tv/oauth2/token using IGDB_CLIENT_ID and
 * IGDB_CLIENT_SECRET, then sent as a Bearer token together with a
 * Client-ID header on every API call. When either credential is
 * missing, every tool fails before any request is made. Tokens are
 * cached in-process and reused until shortly before they expire.
 * All HTTP goes through an injected FetchFn so everything is
 * testable offline.
 */
import type {
  CustomQueryOptions,
  FetchFn,
  GameDetailsOptions,
  IgdbCredentials,
  MostAnticipatedOptions,
  SearchGamesOptions,
} from "./types.js";

export const VERSION = "0.1.0";

export const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

export const API_BASE_URL = "https://api.igdb.com/v4";

export const CLIENT_ID_ENV = "IGDB_CLIENT_ID";

export const CLIENT_SECRET_ENV = "IGDB_CLIENT_SECRET";

/** Field set used when a caller does not supply its own `fields`. */
export const DEFAULT_FIELDS =
  "name,cover.url,first_release_date,genres.name,platforms.name,rating,summary";

/** Default result cap for search_games. */
export const DEFAULT_SEARCH_LIMIT = 10;

/** Default result cap for get_most_anticipated_games. */
export const DEFAULT_ANTICIPATED_LIMIT = 25;

/** Default minimum hype count for get_most_anticipated_games. */
export const DEFAULT_MIN_HYPES = 25;

/**
 * Read the IGDB credentials from an environment map. Throws before
 * any request is made when either value is missing or blank.
 */
export function resolveCredentials(
  env: Record<string, string | undefined>,
): IgdbCredentials {
  const clientId = typeof env[CLIENT_ID_ENV] === "string" ? env[CLIENT_ID_ENV].trim() : "";
  if (!clientId) {
    throw new Error(`${CLIENT_ID_ENV} is not set: an IGDB (Twitch) client id is required`);
  }
  const clientSecret =
    typeof env[CLIENT_SECRET_ENV] === "string" ? env[CLIENT_SECRET_ENV].trim() : "";
  if (!clientSecret) {
    throw new Error(
      `${CLIENT_SECRET_ENV} is not set: an IGDB (Twitch) client secret is required`,
    );
  }
  return { clientId, clientSecret };
}

function requireNonEmpty(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new Error(`${field} must be a non-empty string`);
  return v;
}

function optionalFields(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  return v ? v : DEFAULT_FIELDS;
}

function requireLimit(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 500) {
    throw new Error("limit must be a number between 1 and 500");
  }
  return Math.trunc(value);
}

function requireMinHypes(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_MIN_HYPES;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("min_hypes must be a number greater than or equal to 0");
  }
  return value;
}

function requireGameId(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("game_id must be a positive number");
  }
  return Math.trunc(value);
}

/** Escape a free-text term for an Apicalypse `search "..."` clause. */
export function escapeSearchTerm(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorDetail(payload: unknown): string {
  if (isRecord(payload)) {
    if (typeof payload.message === "string" && payload.message) return `: ${payload.message}`;
    if (typeof payload.error === "string" && payload.error) return `: ${payload.error}`;
  }
  if (Array.isArray(payload) && payload.length > 0 && isRecord(payload[0])) {
    const first = payload[0];
    if (typeof first.title === "string" && first.title) return `: ${first.title}`;
    if (typeof first.message === "string" && first.message) return `: ${first.message}`;
  }
  return "";
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/**
 * Stateful IGDB client: owns the credential pair and the in-process
 * OAuth token cache. One client per process is the intended usage.
 */
export class GameDbClient {
  private readonly fetchFn: FetchFn;
  private readonly credentials: IgdbCredentials;
  private cached: CachedToken | undefined;

  constructor(fetchFn: FetchFn, credentials: IgdbCredentials) {
    this.fetchFn = fetchFn;
    this.credentials = credentials;
  }

  /** Fetch (or reuse) the Twitch OAuth access token. */
  async accessToken(nowMs: number = Date.now()): Promise<string> {
    if (this.cached && nowMs < this.cached.expiresAtMs) {
      return this.cached.accessToken;
    }
    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      grant_type: "client_credentials",
    }).toString();
    let response;
    try {
      response = await this.fetchFn(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      throw new Error(
        `Twitch OAuth token request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      let detail = "";
      try {
        detail = errorDetail(await response.json());
      } catch {
        // A non-JSON error body still reports its HTTP status below.
      }
      throw new Error(
        `Twitch OAuth token request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail}`,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Twitch OAuth token response was not valid JSON");
    }
    if (!isRecord(payload) || typeof payload.access_token !== "string" || !payload.access_token) {
      throw new Error("Twitch OAuth token response did not include an access_token");
    }
    const expiresIn =
      typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
        ? payload.expires_in
        : 3600;
    // Refresh a minute early so a token never expires mid-flight.
    const lifetimeMs = Math.max(0, expiresIn - 60) * 1000;
    this.cached = { accessToken: payload.access_token, expiresAtMs: nowMs + lifetimeMs };
    return payload.access_token;
  }

  /** POST an Apicalypse body to one IGDB endpoint and return its JSON. */
  async query(endpoint: string, apicalypseBody: string): Promise<unknown> {
    const token = await this.accessToken();
    const url = `${API_BASE_URL}/${endpoint.replace(/^\/+/, "")}`;
    let response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Client-ID": this.credentials.clientId,
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
          Accept: "application/json",
        },
        body: apicalypseBody,
      });
    } catch (err) {
      throw new Error(
        `IGDB API request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      let detail = "";
      try {
        detail = errorDetail(await response.json());
      } catch {
        // A non-JSON error body still reports its HTTP status below.
      }
      throw new Error(
        `IGDB API request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail}`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new Error("IGDB API returned a response that was not valid JSON");
    }
  }

  /** Search for games by name. */
  async searchGames(options: SearchGamesOptions): Promise<unknown> {
    const query = requireNonEmpty(options.query, "query");
    const fields = optionalFields(options.fields);
    const limit = requireLimit(options.limit, DEFAULT_SEARCH_LIMIT);
    const body = `search "${escapeSearchTerm(query)}"; fields ${fields}; limit ${limit};`;
    return this.query("games", body);
  }

  /** Get comprehensive information for one game by its IGDB id. */
  async getGameDetails(options: GameDetailsOptions): Promise<unknown> {
    const gameId = requireGameId(options.game_id);
    const fields = optionalFields(options.fields);
    const body = `fields ${fields}; where id = ${gameId};`;
    return this.query("games", body);
  }

  /** Find upcoming games ordered by hype, above a hype threshold. */
  async getMostAnticipatedGames(
    options: MostAnticipatedOptions = {},
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): Promise<unknown> {
    const fields = optionalFields(options.fields);
    const limit = requireLimit(options.limit, DEFAULT_ANTICIPATED_LIMIT);
    const minHypes = requireMinHypes(options.min_hypes);
    const body =
      `fields ${fields}; where first_release_date > ${Math.trunc(nowSeconds)}` +
      ` & hypes >= ${minHypes}; sort hypes desc; limit ${limit};`;
    return this.query("games", body);
  }

  /** Execute a caller-supplied Apicalypse query against an endpoint. */
  async customQuery(options: CustomQueryOptions): Promise<unknown> {
    const endpoint = requireNonEmpty(options.endpoint, "endpoint");
    const query = requireNonEmpty(options.query, "query");
    return this.query(endpoint, query);
  }
}

/** Build a client from environment credentials, erroring if unset. */
export function createClient(
  fetchFn: FetchFn,
  env: Record<string, string | undefined>,
): GameDbClient {
  return new GameDbClient(fetchFn, resolveCredentials(env));
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
