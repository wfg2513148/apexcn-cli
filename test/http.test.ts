import { afterEach, describe, expect, test, vi } from "vitest";
import { HttpError, joinUrl, NetworkError, redactSecret, requestJson, TimeoutError } from "../src/http.js";

describe("http", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.APEXCN_HTTP_TIMEOUT_MS;
  });

  test("joinUrl appends API paths without dropping the ORDS prefix", () => {
    expect(joinUrl("https://oracleapex.cn/ords/apexcn", "/api/v1/me")).toBe(
      "https://oracleapex.cn/ords/apexcn/api/v1/me"
    );
  });

  test("requestJson sends bearer auth and user agent headers", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    await requestJson("https://oracleapex.cn/ords/apexcn", "/api/v1/me", {
      token: "abc123",
      userAgent: "apexcn-test"
    });

    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/apexcn/api/v1/me", {
      headers: {
        Authorization: "Bearer abc123",
        "X-APEXCN-API-Key": "abc123",
        "User-Agent": "apexcn-test"
      }
    });
  });

  test("requestJson sends method, JSON body, and query parameters", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    await requestJson("https://oracleapex.cn/ords/dev", "/api/v1/search", {
      token: "abc123",
      method: "POST",
      query: { keyword: "APEX", pageSize: 2 },
      body: { title: "Hello" }
    });

    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/dev/api/v1/search?keyword=APEX&pageSize=2", {
      method: "POST",
      headers: {
        Authorization: "Bearer abc123",
        "X-APEXCN-API-Key": "abc123",
        "User-Agent": "apexcn-cli/0.18.10",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title: "Hello" })
    });
  });

  test("requestJson can set a request timeout signal", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    await requestJson("https://oracleapex.cn/ords/dev", "/api/v1/me", {
      token: "abc123",
      timeoutMs: 1000
    });

    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/dev/api/v1/me", {
      headers: expect.any(Object),
      signal: expect.any(AbortSignal)
    });
  });

  test("requestJson can use the default timeout from the environment", async () => {
    process.env.APEXCN_HTTP_TIMEOUT_MS = "2500";
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    await requestJson("https://oracleapex.cn/ords/dev", "/api/v1/me", {
      token: "abc123"
    });

    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/dev/api/v1/me", {
      headers: expect.any(Object),
      signal: expect.any(AbortSignal)
    });
  });

  test("explicit timeout overrides invalid environment defaults", async () => {
    process.env.APEXCN_HTTP_TIMEOUT_MS = "nope";
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    await requestJson("https://oracleapex.cn/ords/dev", "/api/v1/me", {
      token: "abc123",
      timeoutMs: 1000
    });

    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/dev/api/v1/me", {
      headers: expect.any(Object),
      signal: expect.any(AbortSignal)
    });
  });

  test("requestJson parses successful JSON responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ username: "kwang" })));

    await expect(requestJson("https://oracleapex.cn/ords/apexcn", "/api/v1/me", { token: "abc123" })).resolves.toEqual({
      username: "kwang"
    });
  });

  test("requestJson preserves empty response bodies as null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    await expect(requestJson("https://oracleapex.cn/ords/apexcn", "/api/v1/no-content", { token: "abc123" })).resolves.toBeNull();
  });

  test("requestJson propagates structured errors with requestId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, error: { code: "INVALID_TOKEN", message: "Invalid API token", requestId: "req-123" } },
          { status: 401 }
        )
      )
    );

    await expect(requestJson("https://oracleapex.cn/ords/apexcn", "/api/v1/me", { token: "bad" })).rejects.toMatchObject({
      name: "HttpError",
      message: "Invalid API token",
      status: 401,
      requestId: "req-123",
      body: { ok: false, error: { code: "INVALID_TOKEN", message: "Invalid API token", requestId: "req-123" } }
    } satisfies Partial<HttpError>);
  });

  test("requestJson converts non-JSON error responses into HttpError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<html>temporary outage</html>", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "x-request-id": "req-html" }
        })
      )
    );

    await expect(requestJson("https://oracleapex.cn/ords/apexcn", "/api/v1/me", { token: "abc123" })).rejects.toMatchObject({
      name: "HttpError",
      message: "Service Unavailable",
      status: 503,
      statusText: "Service Unavailable",
      requestId: "req-html",
      body: null
    } satisfies Partial<HttpError>);
    await expect(requestJson("https://oracleapex.cn/ords/apexcn", "/api/v1/me", { token: "abc123" })).rejects.not.toThrow(SyntaxError);
  });

  test("requestJson converts non-JSON successful responses into stable HttpError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<html>not json</html>", {
          status: 200,
          statusText: "OK",
          headers: { "x-request-id": "req-ok-html" }
        })
      )
    );

    await expect(requestJson("https://oracleapex.cn/ords/apexcn", "/api/v1/me", { token: "abc123" })).rejects.toMatchObject({
      name: "HttpError",
      message: "Invalid JSON response from server",
      status: 200,
      statusText: "OK",
      requestId: "req-ok-html",
      body: null
    } satisfies Partial<HttpError>);
  });

  test("requestJson converts fetch failures into NetworkError", async () => {
    const cause = new TypeError("fetch failed");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw cause;
    }));

    await expect(requestJson("https://oracleapex.cn/ords/apexcn", "/api/v1/me", { token: "abc123" })).rejects.toMatchObject({
      name: "NetworkError",
      message: "Network error: failed to reach https://oracleapex.cn/ords/apexcn/api/v1/me",
      url: "https://oracleapex.cn/ords/apexcn/api/v1/me",
      cause
    } satisfies Partial<NetworkError>);
  });

  test("requestJson converts aborts into TimeoutError when timeout is configured", async () => {
    const cause = new Error("timed out");
    cause.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw cause;
    }));

    await expect(requestJson("https://oracleapex.cn/ords/apexcn", "/api/v1/me", {
      token: "abc123",
      timeoutMs: 5
    })).rejects.toMatchObject({
      name: "TimeoutError",
      message: "Request timed out after 5ms: https://oracleapex.cn/ords/apexcn/api/v1/me",
      url: "https://oracleapex.cn/ords/apexcn/api/v1/me",
      timeoutMs: 5
    } satisfies Partial<TimeoutError>);
  });

  test("redactSecret replaces exact secret values", () => {
    expect(redactSecret("token abc123 failed: abc123", "abc123")).toBe("token [redacted] failed: [redacted]");
    expect(redactSecret("token abc123 failed", undefined)).toBe("token abc123 failed");
  });
});
