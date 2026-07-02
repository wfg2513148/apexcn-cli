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

export const DEFAULT_USER_AGENT = "apexcn-cli/0.1.6";

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

  const response = await fetch(addQuery(joinUrl(baseUrl, path), options.query), init);
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
  return JSON.parse(text) as unknown;
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
