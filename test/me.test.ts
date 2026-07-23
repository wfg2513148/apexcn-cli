import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-me-"));
  return join(dir, ".apexcn", "config.json");
}

describe("me command", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
    delete process.env.APEXCN_HTTP_TIMEOUT_MS;
    delete process.env.APEXCN_ERROR_FORMAT;
  });

  test("prints privacy-safe authenticated user JSON by default", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          user: { id: 11, email: "test@example.test", nickname: "Tester", roleLevel: 10, isMuted: false },
          requestId: "req-ok"
        })
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "auth",
      "set-token",
      "--token",
      "abcdefghijklmnopqrstuvwxyz",
      "--base-url",
      "https://oracleapex.cn/ords/test",
      "--profile",
      "test@oci"
    ]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "--json"]);

    expect(JSON.parse(stdout.join(""))).toEqual({
      user: { id: 11, email: "t***@example.test", nickname: "Tester", roleLevel: 10, isMuted: false },
      requestId: "req-ok"
    });
    expect(stdout.join("")).not.toContain("test@example.test");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  test("can redact email for privacy-safe JSON output", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          user: { id: 11, email: "test@example.test", nickname: "Tester", roleLevel: 10, isMuted: false },
          requestId: "req-ok"
        })
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "--json", "--redact"]);

    expect(JSON.parse(stdout.join(""))).toEqual({
      user: { id: 11, email: "t***@example.test", nickname: "Tester", roleLevel: 10, isMuted: false },
      requestId: "req-ok"
    });
    expect(stdout.join("")).not.toContain("test@example.test");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  test("includes private profile fields only after explicit opt-in", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          user: {
            id: 11,
            email: "test@example.test",
            phone: "13800000000",
            nickname: "Tester",
            apiToken: "server-should-never-return-this"
          },
          requestId: "req-private"
        })
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "--json", "--include-private"]);

    expect(JSON.parse(stdout.join(""))).toEqual({
      user: {
        id: 11,
        email: "test@example.test",
        phone: "13800000000",
        nickname: "Tester",
        apiToken: "[redacted]"
      },
      requestId: "req-private"
    });
    expect(stdout.join("")).not.toContain("server-should-never-return-this");
    expect(stderr.join("")).toBe("");
  });

  test("supports text format while preserving verbose diagnostics", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          user: { id: 11, email: "test@example.test", nickname: "Test\ter", roleLevel: 10, isMuted: false },
          requestId: "req-ok"
        })
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "auth",
      "set-token",
      "--token",
      "abcdefghijklmnopqrstuvwxyz",
      "--base-url",
      "https://oracleapex.cn/ords/test",
      "--profile",
      "test@oci"
    ]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "--format", "text", "--verbose"]);

    expect(stdout.join("")).toBe([
      "id: 11",
      "name: Test er",
      "email: t***@example.test",
      "roleLevel: 10",
      "isMuted: false",
      "requestId: req-ok",
      ""
    ].join("\n"));
    expect(stderr.join("")).toBe("GET https://oracleapex.cn/ords/test/api/v1/me\n");
  });

  test("prints current user aggregate stats", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          kind: "me-stats",
          user: { id: 11, nickname: "Tester" },
          authoredTopicCount: 3,
          authoredFeaturedTopicCount: 1,
          authoredReplyCount: 5,
          favoriteCount: 2,
          subscriptionCount: 4,
          requestId: "req-stats"
        })
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test", "--profile", "test@oci"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "stats", "--format", "text"]);

    expect(fetch).toHaveBeenLastCalledWith("https://oracleapex.cn/ords/test/api/v1/me/stats", expect.any(Object));
    expect(stdout.join("")).toContain("authoredTopicCount: 3\n");
    expect(stdout.join("")).toContain("subscriptionCount: 4\n");
    expect(stderr.join("")).toBe("");
  });

  test("shows a personal dashboard with all four personal content sections", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const responses: Record<string, unknown> = {
      "/api/v1/me/stats": { kind: "me-stats", authoredTopicCount: 1, authoredReplyCount: 1, favoriteCount: 1, subscriptionCount: 1 },
      "/api/v1/me/topics?pageSize=2": { kind: "me-topics", items: [{ id: 11, title: "Created", url: "https://oracleapex.cn/ords/test/api/v1/topics/11/visual" }] },
      "/api/v1/me/replies?pageSize=2": { kind: "me-replies", items: [{ id: 21, topicId: 12, topic: { title: "Replied" }, replyUrl: "https://oracleapex.cn/ords/test/api/v1/topics/12/visual#post_21" }] },
      "/api/v1/me/favorites?pageSize=2": { kind: "me-favorites", items: [{ topicId: 13, title: "Favorited", url: "https://oracleapex.cn/ords/test/api/v1/topics/13/visual", originalUrl: "https://example.com/source-13" }] },
      "/api/v1/me/subscriptions?pageSize=2": { kind: "me-subscriptions", items: [{ topicId: 14, title: "Subscribed", url: "https://oracleapex.cn/ords/test/api/v1/topics/14/visual" }] }
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const key = String(url).replace("https://oracleapex.cn/ords/test", "");
      return Response.json(responses[key] ?? { error: { message: `unexpected ${key}` } }, { status: responses[key] ? 200 : 500 });
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "dashboard", "--page-size", "2", "--json"]);

    expect(JSON.parse(stdout.join(""))).toEqual({
      kind: "me-dashboard",
      pageSize: 2,
      stats: responses["/api/v1/me/stats"],
      created: responses["/api/v1/me/topics?pageSize=2"],
      replied: responses["/api/v1/me/replies?pageSize=2"],
      favorited: responses["/api/v1/me/favorites?pageSize=2"],
      subscribed: responses["/api/v1/me/subscriptions?pageSize=2"]
    });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(stderr.join("")).toBe("");
  });

  test("searches only the personal dashboard after capability preflight", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/api/v1/capabilities")) {
        return Response.json({
          kind: "capabilities",
          contractVersion: "0.8.0-candidate",
          supportedContractVersions: ["0.8.0-candidate", "0.7.0-candidate", "0.6.0-candidate"],
          capabilities: [{ id: "personal-community", available: true, endpoints: ["/me", "/me/search"] }],
          requestId: "req-capabilities"
        });
      }
      if (value.endsWith("/api/v1/me/search?keyword=APEX&scope=created%2Cfavorited&pageSize=2&cursor=next.cursor")) {
        return Response.json({
          kind: "me-search",
          items: [{
            id: 42,
            title: "Personal APEX result",
            matchedScopes: ["created", "favorited"],
            url: "https://oracleapex.cn/ords/test/api/v1/topics/42/visual",
            originalUrl: "https://example.com/source-42"
          }],
          page: { pageSize: 2, count: 1, hasMore: false, nextCursor: null },
          filters: { keyword: "APEX", scope: "created,favorited" },
          requestId: "req-personal-search"
        });
      }
      return Response.json({ error: { message: `unexpected ${value}` } }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "search", "APEX", "--scope", "created,favorited", "--page-size", "2", "--cursor", "next.cursor", "--format", "text"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toEqual(expect.arrayContaining([
      expect.stringContaining("/api/v1/search")
    ]));
    expect(stdout.join("")).toContain("communityUrl: https://oracleapex.cn/ords/test/api/v1/topics/42/visual\n");
    expect(stdout.join("")).toContain("originalUrl: https://example.com/source-42\n");
    expect(stdout.join("")).toContain("matchedScopes: created,favorited\n");
    expect(stderr.join("")).toBe("");
  });

  test("fails closed when personal dashboard search is not advertised", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const fetchMock = vi.fn(async () => Response.json({
      kind: "capabilities",
      contractVersion: "0.8.0-candidate",
      supportedContractVersions: ["0.8.0-candidate", "0.7.0-candidate", "0.6.0-candidate"],
      capabilities: [{ id: "personal-community", available: true, endpoints: ["/me", "/me/topics"] }],
      requestId: "req-capabilities"
    }));
    vi.stubGlobal("fetch", fetchMock);
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "search", "APEX", "--json"]);

    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      kind: "me-search",
      available: false,
      status: "UNAVAILABLE",
      unavailableReason: "CAPABILITY_NOT_ADVERTISED"
    }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toEqual(expect.arrayContaining([
      expect.stringContaining("/api/v1/search")
    ]));
    expect(process.exitCode).toBe(1);
  });

  test("discovers capabilities and preserves truthful unavailable responses", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const responses: Record<string, unknown> = {
      "/api/v1/capabilities": {
        kind: "capabilities",
        contractVersion: "0.6.0-candidate",
        capabilities: [
          { id: "personal-community", available: true, endpoints: ["/me", "/me/topics"] },
          { id: "notifications", available: false, endpoints: ["/notifications"], unavailableReason: "NOT_IMPLEMENTED" },
          { id: "inbox", available: false, endpoints: ["/inbox"], unavailableReason: "NOT_IMPLEMENTED" },
          { id: "community-rules", available: false, endpoints: ["/community/rules"], unavailableReason: "NOT_IMPLEMENTED" },
          { id: "privacy-policy", available: false, endpoints: ["/privacy-policy"], unavailableReason: "NOT_IMPLEMENTED" }
        ],
        requestId: "req-capabilities"
      },
      "/api/v1/notifications": { kind: "notifications", available: false, status: "UNAVAILABLE", unavailableReason: "NOT_IMPLEMENTED", requestId: "req-notifications" },
      "/api/v1/inbox": { kind: "inbox", available: false, status: "UNAVAILABLE", unavailableReason: "NOT_IMPLEMENTED", requestId: "req-inbox" },
      "/api/v1/community/rules": { kind: "community-rules", available: false, status: "UNAVAILABLE", unavailableReason: "NOT_IMPLEMENTED", requestId: "req-rules" },
      "/api/v1/privacy-policy": { kind: "privacy-policy", available: false, status: "UNAVAILABLE", unavailableReason: "NOT_IMPLEMENTED", requestId: "req-privacy" }
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const path = String(url).replace("https://oracleapex.cn/ords/test", "");
      return Response.json(responses[path] ?? { error: { message: `unexpected ${path}` } }, { status: responses[path] ? 200 : 500 });
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test"]);
    for (const command of ["capabilities", "notifications", "inbox", "rules", "privacy"]) {
      stdout.length = 0;
      await program.parseAsync(["node", "apexcn", "me", command, "--json"]);
      const output = JSON.parse(stdout.join(""));
      const expected = responses[
        command === "capabilities"
          ? "/api/v1/capabilities"
          : command === "rules"
            ? "/api/v1/community/rules"
            : command === "privacy"
              ? "/api/v1/privacy-policy"
              : `/api/v1/${command}`
      ];
      if (command === "capabilities") {
        expect(output).toEqual(expect.objectContaining({
          ...(expected as Record<string, unknown>),
          clientCompatibility: expect.objectContaining({ ok: true, status: "compatible", negotiationMode: "legacy" })
        }));
      } else {
        expect(output).toEqual({
          ...(expected as Record<string, unknown>),
          requestId: "req-capabilities"
        });
      }
      if (command !== "capabilities") {
        expect(output.available).toBe(false);
        expect(output.status).toBe("UNAVAILABLE");
        expect(output.unavailableReason).toBe("NOT_IMPLEMENTED");
        expect(output.items).toBeUndefined();
        expect(output.content).toBeUndefined();
      }
    }

    expect(fetch).toHaveBeenCalledTimes(5);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).not.toContain("https://oracleapex.cn/ords/test/api/v1/inbox");
    expect(stderr.join("")).toBe("");
  });

  test("capability negotiation fails closed for unavailable required capabilities", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      kind: "capabilities",
      contractVersion: "0.8.0-candidate",
      supportedContractVersions: ["0.8.0-candidate", "0.7.0-candidate", "0.6.0-candidate"],
      capabilities: [{ id: "notifications", available: false, unavailableReason: "NOT_IMPLEMENTED" }],
      requestId: "req-capabilities"
    })));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });
    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test"]);
    stdout.length = 0;

    await program.parseAsync(["node", "apexcn", "me", "capabilities", "--require-capability", "notifications", "--json"]);

    expect(JSON.parse(stdout.join("")).clientCompatibility).toEqual(expect.objectContaining({
      ok: false,
      status: "missing-capability",
      missingCapabilities: ["notifications"]
    }));
    expect(process.exitCode).toBe(1);
  });

  test("prints current user activity lists with offset pagination", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const responses: Record<string, unknown> = {
      "/api/v1/me/topics?pageSize=2&offset=4": { kind: "me-topics", items: [{ id: 42, title: "Topic", version: 3, canEdit: true, canDelete: true, createdDate: "2026-07-01", updatedDate: "2026-07-02", url: "https://oracleapex.cn/ords/test/api/v1/topics/42/visual", originalUrl: "https://example.com/topic-42" }], page: { pageSize: 2, offset: 4, count: 1, hasMore: false } },
      "/api/v1/me/replies?pageSize=2&offset=4": { kind: "me-replies", items: [{ id: 90, replyId: 90, topicId: 42, parentPostId: 80, version: 2, canEdit: true, canDelete: true, topic: { title: "Topic", originalUrl: "https://example.com/topic-42" }, createdDate: "2026-07-02", updatedDate: "2026-07-03", url: "https://oracleapex.cn/ords/f?p=100:14:old-checksum", replyUrl: "https://oracleapex.cn/ords/test/api/v1/topics/42/visual#post_90" }], page: { pageSize: 2, offset: 4, count: 1, hasMore: false } },
      "/api/v1/me/favorites?pageSize=2&offset=4": { kind: "me-favorites", items: [{ topicId: 43, title: "Favorite", relationCreatedDate: "2026-07-04", updatedDate: "2026-07-05", url: "https://oracleapex.cn/ords/test/api/v1/topics/43/visual", originalUrl: "https://example.com/topic-43" }], page: { pageSize: 2, offset: 4, count: 1, hasMore: false } },
      "/api/v1/me/subscriptions?pageSize=2&offset=4": { kind: "me-subscriptions", items: [{ topicId: 44, title: "Subscription", relationCreatedDate: "2026-07-04", updatedDate: "2026-07-05", url: "https://oracleapex.cn/ords/test/api/v1/topics/44/visual" }], page: { pageSize: 2, offset: 4, count: 1, hasMore: false } }
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const key = String(url).replace("https://oracleapex.cn/ords/test", "");
      return Response.json(responses[key] ?? { error: { message: `unexpected ${key}` } }, { status: responses[key] ? 200 : 500 });
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test", "--profile", "test@oci"]);
    const textByCommand: Record<string, string> = {};
    for (const command of ["topics", "replies", "favorites", "subscriptions"]) {
      stdout.length = 0;
      await program.parseAsync(["node", "apexcn", "me", command, "--page-size", "2", "--offset", "4", "--format", "text"]);
      textByCommand[command] = stdout.join("");
    }
    expect(textByCommand.topics).toContain("\t3\ttrue\ttrue\t");
    expect(textByCommand.topics).toContain("https://oracleapex.cn/ords/test/api/v1/topics/42/visual\thttps://example.com/topic-42");
    expect(textByCommand.replies).toContain("90\t42\t80\t2\ttrue\ttrue\t");
    expect(textByCommand.replies).toContain("https://oracleapex.cn/ords/test/api/v1/topics/42/visual#post_90\thttps://example.com/topic-42");
    expect(textByCommand.replies).not.toContain("old-checksum");
    expect(textByCommand.favorites).toContain("https://oracleapex.cn/ords/test/api/v1/topics/43/visual\thttps://example.com/topic-43");
    expect(textByCommand.subscriptions).toContain("https://oracleapex.cn/ords/test/api/v1/topics/44/visual\t");

    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/me/topics?pageSize=2&offset=4", expect.any(Object));
    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/me/replies?pageSize=2&offset=4", expect.any(Object));
    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/me/favorites?pageSize=2&offset=4", expect.any(Object));
    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/me/subscriptions?pageSize=2&offset=4", expect.any(Object));
    expect(stderr.join("")).toBe("");
  });

  test("passes opaque personal-list cursors and rejects mixed pagination modes", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const fetchMock = vi.fn(async () => Response.json({
      kind: "me-topics",
      items: [],
      page: { pageSize: 2, count: 0, hasMore: false, nextCursor: null },
      requestId: "req-cursor"
    }));
    vi.stubGlobal("fetch", fetchMock);
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "topics", "--page-size", "2", "--cursor", "opaque.next.cursor", "--json"]);

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/me/topics?pageSize=2&cursor=opaque.next.cursor",
      expect.any(Object)
    );
    expect(JSON.parse(stdout.join("")).page.nextCursor).toBeNull();

    fetchMock.mockClear();
    stdout.length = 0;
    stderr.length = 0;
    process.exitCode = undefined;
    const mixedProgram = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });
    await mixedProgram.parseAsync(["node", "apexcn", "me", "topics", "--offset", "2", "--cursor", "opaque.next.cursor", "--json"]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "validation",
        message: "--offset cannot be combined with --cursor",
        exitCode: 1
      }
    });
    expect(process.exitCode).toBe(1);
  });

  test("favorite and subscription lists tolerate unavailable targets", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({
        kind: "me-favorites",
        items: [{ targetId: 404, unavailableReason: "TOPIC_NOT_FOUND", relationCreatedDate: "2026-07-04" }],
        page: { pageSize: 10, offset: 0, count: 1, hasMore: false }
      })
    ));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test", "--profile", "test@oci"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "favorites", "--format", "text"]);

    expect(stdout.join("")).toBe("404\t\t2026-07-04\t\tTOPIC_NOT_FOUND\t\t\n");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  test("recursively redacts private and secret fields from personal lists", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({
        kind: "me-topics",
        items: [{
          id: 42,
          title: "Topic",
          email: "private@example.test",
          author: {
            phone: "13800000000",
            lastLoginIp: "192.0.2.1",
            apiKey: "server-secret-value"
          }
        }],
        requestId: "req-private-list"
      })
    ));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "topics", "--json"]);

    expect(JSON.parse(stdout.join(""))).toEqual({
      kind: "me-topics",
      items: [{
        id: 42,
        title: "Topic",
        email: "p***@example.test",
        author: {
          phone: "[redacted]",
          lastLoginIp: "[redacted]",
          apiKey: "[redacted]"
        }
      }],
      requestId: "req-private-list"
    });
    expect(stdout.join("")).not.toContain("private@example.test");
    expect(stdout.join("")).not.toContain("13800000000");
    expect(stdout.join("")).not.toContain("192.0.2.1");
    expect(stdout.join("")).not.toContain("server-secret-value");
    expect(stderr.join("")).toBe("");
  });

  test("keeps credentials, requests, and outputs isolated across three profiles", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const profiles = [
      { name: "alpha", baseUrl: "https://alpha.example.test/ords", token: "a".repeat(26), userId: 101 },
      { name: "beta", baseUrl: "https://beta.example.test/ords", token: "b".repeat(26), userId: 202 },
      { name: "gamma", baseUrl: "https://gamma.example.test/ords", token: "c".repeat(26), userId: 303 }
    ];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const profile = profiles.find((item) => String(url).startsWith(item.baseUrl));
      const authorization = new Headers(init?.headers).get("Authorization");
      if (!profile || authorization !== `Bearer ${profile.token}`) {
        return Response.json({ error: { message: "cross-profile request" } }, { status: 403 });
      }
      return Response.json({
        user: { id: profile.userId, nickname: profile.name, email: `${profile.name}@example.test` },
        requestId: `req-${profile.name}`
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    for (const profile of profiles) {
      await program.parseAsync([
        "node",
        "apexcn",
        "auth",
        "set-token",
        "--profile",
        profile.name,
        "--base-url",
        profile.baseUrl,
        "--token",
        profile.token
      ]);
      stdout.length = 0;
    }

    for (const profile of profiles) {
      await program.parseAsync(["node", "apexcn", "auth", "use", profile.name]);
      stdout.length = 0;
      await program.parseAsync(["node", "apexcn", "me", "--json"]);
      const output = stdout.join("");
      expect(JSON.parse(output)).toEqual({
        user: { id: profile.userId, nickname: profile.name, email: `${profile.name.slice(0, 1)}***@example.test` },
        requestId: `req-${profile.name}`
      });
      for (const candidate of profiles) {
        expect(output).not.toContain(candidate.token);
        if (candidate !== profile) {
          expect(output).not.toContain(candidate.name);
          expect(output).not.toContain(String(candidate.userId));
        }
      }
      stdout.length = 0;
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(stderr.join("")).toBe("");
  });

  test("rejects ambiguous format options before making API requests", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "me", "--json", "--format", "text"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "validation",
        message: "--json can only be combined with --format pretty",
        exitCode: 1
      }
    });
    expect(process.exitCode).toBe(1);
  });

  test("can print format validation errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "me", "--json", "--format", "text"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "validation",
        message: "--json can only be combined with --format pretty",
        exitCode: 1
      }
    });
    expect(process.exitCode).toBe(1);
  });

  test("prints requestId on API errors and exits non-zero", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, error: { code: "INVALID_TOKEN", message: "Invalid API token", requestId: "req-bad" } },
          { status: 401 }
        )
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "bad-token"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("HTTP 401: Invalid API token requestId=req-bad\n");
    expect(stderr.join("")).toContain("Auth diagnosis: A local API token is configured, but the server rejected it.");
    expect(stderr.join("")).toContain("apexcn auth show --json");
    expect(stderr.join("")).toContain("apexcn auth set-token");
    expect(process.exitCode).toBe(1);
  });

  test("prints actionable remediation for server-rejected tokens in JSON", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, error: { code: "INVALID_TOKEN", message: "Invalid API token", requestId: "req-json-401" } },
          { status: 401 }
        )
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "bad-token"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "--json"]);

    const output = JSON.parse(stderr.join(""));
    expect(output).toEqual({
      ok: false,
      error: expect.objectContaining({
        type: "http",
        message: "Invalid API token",
        status: 401,
        requestId: "req-json-401",
        remediation: {
          code: "TOKEN_REJECTED_BY_SERVER",
          message: "A local API token is configured, but the server rejected it.",
          actions: expect.arrayContaining([
            "Run `apexcn auth show --json` to confirm the active profile and baseUrl."
          ])
        }
      })
    });
    expect(stderr.join("")).not.toContain("bad-token");
    expect(process.exitCode).toBe(1);
  });

  test("redacts the active token from API error messages", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "token abcdefghijklmnopqrstuvwxyz is not allowed", requestId: "req-token" } },
          { status: 403 }
        )
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("HTTP 403: token [redacted] is not allowed requestId=req-token\n");
    expect(stderr.join("")).toContain("apexcn auth audit --json");
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("can print API errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "token abcdefghijklmnopqrstuvwxyz is not allowed", requestId: "req-token" } },
          { status: 403 }
        )
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: expect.objectContaining({
        type: "http",
        message: "token [redacted] is not allowed",
        status: 403,
        requestId: "req-token"
      })
    });
    expect(JSON.parse(stderr.join("")).error.remediation.code).toBe("PERMISSION_DENIED");
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("reports timeout failures from the default HTTP timeout", async () => {
    process.env.APEXCN_HTTP_TIMEOUT_MS = "5";
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw timeout;
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Request timed out after 5ms: https://oracleapex.cn/ords/api/api/v1/me\n");
    expect(stderr.join("")).toContain("APEXCN_HTTP_TIMEOUT_MS");
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("can print timeout errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    process.env.APEXCN_HTTP_TIMEOUT_MS = "5";
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw timeout;
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: expect.objectContaining({
        type: "timeout",
        message: "Request timed out after 5ms: https://oracleapex.cn/ords/api/api/v1/me"
      })
    });
    expect(JSON.parse(stderr.join("")).error.remediation.code).toBe("REQUEST_TIMEOUT");
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("prints clean errors for non-JSON API failures", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<html>outage</html>", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "x-request-id": "req-html" }
        })
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("HTTP 503: Service Unavailable requestId=req-html\n");
    expect(stderr.join("")).toContain("apexcn doctor --json");
    expect(stderr.join("")).not.toContain("SyntaxError");
    expect(stderr.join("")).not.toContain("<html>");
    expect(process.exitCode).toBe(1);
  });

  test("prints clean errors for network failures", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Network error: failed to reach https://oracleapex.cn/ords/api/api/v1/me\n");
    expect(stderr.join("")).toContain("apexcn doctor --json");
    expect(stderr.join("")).not.toContain("TypeError");
    expect(stderr.join("")).not.toContain("fetch failed");
    expect(stderr.join("")).not.toContain("src/");
    expect(process.exitCode).toBe(1);
  });

  test("can print network errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: expect.objectContaining({
        type: "network",
        message: "Network error: failed to reach https://oracleapex.cn/ords/api/api/v1/me"
      })
    });
    expect(JSON.parse(stderr.join("")).error.remediation.code).toBe("NETWORK_UNREACHABLE");
    expect(stderr.join("")).not.toContain("TypeError");
    expect(stderr.join("")).not.toContain("fetch failed");
    expect(process.exitCode).toBe(1);
  });

  test("exits non-zero when no profile is configured", async () => {
    const stderr: string[] = [];
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stderr.join("")).toBe("No active profile\n");
    expect(process.exitCode).toBe(1);
  });

  test("rejects a legacy placeholder token before fetch instead of reporting a network error", async () => {
    const configPath = await tempConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      current: "agent-prod",
      profiles: {
        "agent-prod": {
          baseUrl: "https://oracleapex.cn/ords/api",
          token: "你的_API_KEY"
        }
      }
    }));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "me", "--json"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "NO_CREDENTIAL",
        message: "No credential is available for profile agent-prod"
      })
    });
    expect(stderr.join("")).not.toContain("network");
    expect(process.exitCode).toBe(1);
  });

  test("reports invalid config without making API requests", async () => {
    const configPath = await tempConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "{not-json", "utf8");
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "me"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe(`Invalid config file: ${configPath}. Run apexcn auth set-token to reconfigure.\n`);
    expect(stderr.join("")).not.toContain("SyntaxError");
    expect(process.exitCode).toBe(1);
  });

  test("can print config errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const configPath = await tempConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "{not-json", "utf8");
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "me"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "config",
        message: `Invalid config file: ${configPath}. Run apexcn auth set-token to reconfigure.`
      }
    });
    expect(stderr.join("")).not.toContain("SyntaxError");
    expect(process.exitCode).toBe(1);
  });

  test("can print auth errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const stderr: string[] = [];
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "me"]);

    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "no-profile",
        code: "NO_ACTIVE_PROFILE",
        message: "No active profile",
        remediation: {
          code: "PROFILE_CONFIGURATION_REQUIRED",
          message: "Select or configure an authenticated profile before using personal commands.",
          actions: [
            "Run `apexcn auth show --json` to inspect configured profiles.",
            "Run `apexcn auth use <profile>` to select an existing profile.",
            "Run `apexcn auth set-token --token <token> --profile <profile>` to configure a profile."
          ]
        }
      }
    });
    expect(process.exitCode).toBe(1);
  });
});
