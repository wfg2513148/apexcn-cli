import { afterEach, describe, expect, test, vi } from "vitest";
import { HttpError, joinUrl, requestJson } from "../src/http.js";

describe("http", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
        "User-Agent": "apexcn-cli/0.1.2",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title: "Hello" })
    });
  });

  test("requestJson parses successful JSON responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ username: "kwang" })));

    await expect(requestJson("https://oracleapex.cn/ords/apexcn", "/api/v1/me", { token: "abc123" })).resolves.toEqual({
      username: "kwang"
    });
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
});
