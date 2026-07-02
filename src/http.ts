export type RequestJsonOptions = {
  token: string;
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  userAgent?: string;
};

export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly requestId?: string;
  readonly body: unknown;

  constructor(message: string, status: number, statusText: string, requestId: string | undefined, body: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.requestId = requestId;
    this.body = body;
  }
}

export class NetworkError extends Error {
  readonly url: string;
  readonly cause: unknown;

  constructor(url: string, cause: unknown) {
    super(`Network error: failed to reach ${url}`);
    this.name = "NetworkError";
    this.url = url;
    this.cause = cause;
  }
}

import { DEFAULT_USER_AGENT } from "./version.js";

export { DEFAULT_USER_AGENT };

export function joinUrl(baseUrl: string, path: string): string {
  const left = baseUrl.replace(/\/+$/, "");
  const right = path.replace(/^\/+/, "");
  return `${left}/${right}`;
}

export function addQuery(url: string, query?: RequestJsonOptions["query"]): string {
  if (!query) {
    return url;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `${url}?${text}` : url;
}

export async function requestJson<T = unknown>(
  baseUrl: string,
  path: string,
  options: RequestJsonOptions
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
    "X-APEXCN-API-Key": options.token,
    "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT
  };
  const init: RequestInit = { headers };

  if (options.method) {
    init.method = options.method;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const url = addQuery(joinUrl(baseUrl, path), options.query);
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new NetworkError(url, error);
  }
  const body = await parseJson(response);

  if (!response.ok) {
    const requestId = requestIdFrom(body) ?? response.headers.get("x-request-id") ?? undefined;
    throw new HttpError(errorMessageFrom(body, response), response.status, response.statusText, requestId, body);
  }

  return body as T;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const requestId = response.headers.get("x-request-id") ?? undefined;
    const message = response.ok ? "Invalid JSON response from server" : response.statusText || `HTTP ${response.status}`;
    throw new HttpError(message, response.status, response.statusText, requestId, null);
  }
}

function requestIdFrom(body: unknown): string | undefined {
  if (isRecord(body) && typeof body.requestId === "string") {
    return body.requestId;
  }
  if (isRecord(body) && isRecord(body.error) && typeof body.error.requestId === "string") {
    return body.error.requestId;
  }
  return undefined;
}

function errorMessageFrom(body: unknown, response: Response): string {
  if (isRecord(body)) {
    if (typeof body.error === "string") {
      return body.error;
    }
    if (isRecord(body.error) && typeof body.error.message === "string") {
      return body.error.message;
    }
    if (typeof body.message === "string") {
      return body.message;
    }
  }
  return response.statusText || `HTTP ${response.status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
