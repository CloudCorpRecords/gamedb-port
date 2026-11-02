/**
 * gamedb-port types.
 *
 * Shapes follow the public IGDB API contract: every data call is a
 * POST of an Apicalypse query body to https://api.igdb.com/v4/<endpoint>,
 * authorised by a Twitch OAuth client-credentials token. HTTP access
 * is described by a minimal response surface so tests can inject a
 * fake fetch and never touch the network.
 */

export interface SearchGamesOptions {
  query: string;
  fields?: string;
  limit?: number;
}

export interface GameDetailsOptions {
  game_id: number;
  fields?: string;
}

export interface MostAnticipatedOptions {
  fields?: string;
  limit?: number;
  min_hypes?: number;
}

export interface CustomQueryOptions {
  endpoint: string;
  query: string;
}

/** Twitch/IGDB application credentials, read from the environment. */
export interface IgdbCredentials {
  clientId: string;
  clientSecret: string;
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;
