import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import Ajv from "ajv";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";
import { publicSchemaForId, schemaIdForCommand } from "../src/schemas/registry.js";

const base = "https://oracleapex.cn/ords/test/api/v1";
const supportedVersions = ["0.10.0-candidate", "0.9.1-candidate", "0.9.0-candidate", "0.8.3-candidate", "0.8.0-candidate", "0.7.0-candidate", "0.6.0-candidate"];
const capabilities = {
  kind: "capabilities",
  contractVersion: "0.10.0-candidate",
  supportedContractVersions: supportedVersions,
  requestId: "req_capabilities",
  capabilities: [{ id: "admin-operations-v2", available: true, endpoints: ["/admin/operations/v2"] }]
};
const payload = {
  kind: "admin-operations",
  schemaVersion: 2,
  semanticsId: "AFA-CLI-OPS-1.0",
  requestId: "req_ops_v2",
  window: { from: "2026-06-25", to: "2026-07-01", days: 7, timeZone: "Asia/Shanghai" },
  filter: { client: "apexcn-cli", limit: 20 },
  totals: { calls: 4, successCount: 2, failureCount: 1, unclassifiedCalls: 1, classifiedCalls: 3, distinctUsers: 2, successRate: 66.67, classificationCoverage: 75, freshnessAt: "2026-07-01T09:00:00+08:00" },
  daily: [
    ...Array.from({ length: 6 }, (_, index) => ({ date: `2026-06-${25 + index}`, calls: 0, successCount: 0, failureCount: 0, unclassifiedCalls: 0 })),
    { date: "2026-07-01", calls: 4, successCount: 2, failureCount: 1, unclassifiedCalls: 1 }
  ],
  operations: [{ route: "/api/v1/search", operation: "search", calls: 4, successCount: 2, failureCount: 1, unclassifiedCalls: 1, distinctUsers: 2, successRate: 66.67, avgDurationMs: 15, freshnessAt: "2026-07-01T09:00:00+08:00" }],
  errors: [{ httpStatus: 400, errorCode: "VALIDATION_ERROR", route: "/api/v1/search", operation: "search", calls: 1, distinctUsers: 1, freshnessAt: "2026-07-01T09:00:00+08:00" }]
};
const payloadWithUser = {
  ...payload,
  window: { from: "2026-07-01", to: "2026-07-01", days: 1, timeZone: "Asia/Shanghai" },
  daily: [payload.daily[6]],
  filter: { ...payload.filter, user: { id: 42, nickname: "Alice" } }
};

function exitOverrideTree(command: Command): void {
  command.exitOverride((error) => { throw error; });
  command.commands.forEach(exitOverrideTree);
}

async function setup(fetchImpl: typeof fetch) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const configPath = join(await mkdtemp(join(tmpdir(), "apexcn-v2-test-")), "config.json");
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const program = createProgram({ configPath, stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) });
  exitOverrideTree(program);
  await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test", "--profile", "test@oci"]);
  stdout.length = 0;
  return { program, stdout, stderr, fetch: vi.mocked(fetch) };
}

function mockApi(inventory: unknown = capabilities, result: unknown = payload): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url === `${base}/capabilities`) return Response.json(inventory);
    if (url.startsWith(`${base}/admin/operations/v2`)) return Response.json(result);
    return Response.json({ error: { code: "UNEXPECTED_ROUTE" } }, { status: 500 });
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

describe("administrator operations v2", () => {
  test("preserves v2 JSON and attributes capability and aggregate requests separately", async () => {
    const app = await setup(mockApi(capabilities, payloadWithUser));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--from", "2026-07-01", "--to", "2026-07-01", "--user-id", "42", "--limit", "20", "--json"]);
    expect(JSON.parse(app.stdout.join(""))).toEqual(payloadWithUser);
    expect(app.fetch).toHaveBeenCalledTimes(2);
    expect(app.fetch).toHaveBeenNthCalledWith(1, `${base}/capabilities`, expect.objectContaining({ headers: expect.objectContaining({ "X-APEXCN-CLI-Operation": "me_capabilities" }) }));
    expect(app.fetch).toHaveBeenNthCalledWith(2, `${base}/admin/operations/v2?from=2026-07-01&to=2026-07-01&userId=42&limit=20`, expect.objectContaining({ headers: expect.objectContaining({ "X-APEXCN-CLI-Operation": "admin_operations" }) }));
  });

  test("allows the server to apply its default limit", async () => {
    const app = await setup(mockApi());
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--json"]);
    expect(app.fetch).toHaveBeenLastCalledWith(`${base}/admin/operations/v2`, expect.any(Object));
    expect(JSON.parse(app.stdout.join("")).filter.limit).toBe(20);
  });

  test("preserves zero-filled days and null rates when there are no calls", async () => {
    const empty = {
      ...payload,
      window: { from: "2026-07-01", to: "2026-07-01", days: 1, timeZone: "Asia/Shanghai" },
      totals: { calls: 0, successCount: 0, failureCount: 0, unclassifiedCalls: 0, classifiedCalls: 0, distinctUsers: 0, successRate: null, classificationCoverage: null, freshnessAt: null },
      daily: [{ date: "2026-07-01", calls: 0, successCount: 0, failureCount: 0, unclassifiedCalls: 0 }],
      operations: [],
      errors: []
    };
    const app = await setup(mockApi(capabilities, empty));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--from", "2026-07-01", "--to", "2026-07-01", "--json"]);
    expect(JSON.parse(app.stdout.join(""))).toEqual(empty);
  });

  test("preserves independently collected daily and total counts when concurrent requests arrive", async () => {
    const concurrent = { ...payload, daily: [...payload.daily.slice(0, 6), { date: "2026-07-01", calls: 5, successCount: 3, failureCount: 1, unclassifiedCalls: 1 }] };
    const app = await setup(mockApi(capabilities, concurrent));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--json"]);
    expect(JSON.parse(app.stdout.join(""))).toEqual(concurrent);
  });

  test("preserves compatible additional response fields", async () => {
    const extended = { ...payload, note: "additional aggregate metadata", totals: { ...payload.totals, sampleCount: 4 } };
    const app = await setup(mockApi(capabilities, extended));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--json"]);
    expect(JSON.parse(app.stdout.join(""))).toEqual(extended);
    const schema = publicSchemaForId("admin-operations-response-v2");
    const validate = new Ajv({ strict: false, formats: { date: /^\d{4}-\d{2}-\d{2}$/, "date-time": /^\d{4}-\d{2}-\d{2}T/ } }).compile(schema);
    expect(validate(extended), JSON.stringify(validate.errors)).toBe(true);
  });

  test("does not round an additional high-precision JSON number", async () => {
    const raw = JSON.stringify(payload).replace(/}$/, ',"precise":3.1415926535897931}');
    const app = await setup(async (input) => String(input) === `${base}/capabilities`
      ? Response.json(capabilities)
      : new Response(raw, { headers: { "content-type": "application/json" } }));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--json"]);
    expect(app.stdout.join("")).toContain('"precise": 3.1415926535897931');
  });

  test("preserves a high-precision average duration allowed by the response schema", async () => {
    const raw = JSON.stringify(payload).replace('"avgDurationMs":15', '"avgDurationMs":3.1415926535897931');
    const app = await setup(async (input) => String(input) === `${base}/capabilities`
      ? Response.json(capabilities)
      : new Response(raw, { headers: { "content-type": "application/json" } }));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--json"]);
    expect(app.stdout.join("")).toContain('"avgDurationMs": 3.1415926535897931');
  });

  test("preserves large aggregate counts without precision loss", async () => {
    const big = {
      ...payload,
      totals: { calls: "BIG_CALLS", successCount: "BIG_SUCCESS", failureCount: 1, unclassifiedCalls: 0, classifiedCalls: "BIG_CALLS", distinctUsers: 1, successRate: 100, classificationCoverage: 100, freshnessAt: null },
      daily: [...payload.daily.slice(0, 6), { date: "2026-07-01", calls: "BIG_CALLS", successCount: "BIG_SUCCESS", failureCount: 1, unclassifiedCalls: 0 }],
      operations: [], errors: []
    };
    const raw = JSON.stringify(big).replaceAll('"BIG_CALLS"', "9007199254740993").replaceAll('"BIG_SUCCESS"', "9007199254740992");
    const app = await setup(async (input) => String(input) === `${base}/capabilities`
      ? Response.json(capabilities)
      : new Response(raw, { headers: { "content-type": "application/json" } }));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--json"]);
    expect(app.stdout.join("")).toContain('"calls": 9007199254740993');
    expect(process.exitCode).toBeUndefined();
  });

  test.each([10, 20, 50, 100])("forwards valid limit %i", async (limit) => {
    const app = await setup(mockApi(capabilities, { ...payload, filter: { ...payload.filter, limit } }));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--limit", String(limit), "--json"]);
    expect(app.fetch).toHaveBeenLastCalledWith(`${base}/admin/operations/v2?limit=${limit}`, expect.any(Object));
  });

  test.each(["0", "11", "25", "101", "abc", "10.0000000000000001", "1e1"])("rejects invalid limit %s before a request", async (limit) => {
    const app = await setup(mockApi());
    await expect(app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--limit", limit])).rejects.toMatchObject({ code: "commander.invalidArgument" });
    expect(app.fetch).not.toHaveBeenCalled();
  });

  test.each([
    ["--from", "2026-07-01"],
    ["--to", "2026-07-01"],
    ["--from", "2026-07-02", "--to", "2026-07-01"],
    ["--from", "2026-01-01", "--to", "2026-04-01"]
  ])("rejects incomplete, reversed, or overlong date ranges", async (...args) => {
    const app = await setup(mockApi());
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", ...args, "--json"]);
    expect(process.exitCode).toBe(1);
    expect(app.stderr.join("")).not.toBe("");
    expect(app.fetch).not.toHaveBeenCalled();
  });

  test("forwards an inclusive 90-day window and preserves every daily row", async () => {
    const days = Array.from({ length: 90 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
      return { date, calls: 0, successCount: 0, failureCount: 0, unclassifiedCalls: 0 };
    });
    const result = {
      ...payload,
      window: { from: "2026-01-01", to: "2026-03-31", days: 90, timeZone: "Asia/Shanghai" },
      totals: { calls: 0, successCount: 0, failureCount: 0, unclassifiedCalls: 0, classifiedCalls: 0, distinctUsers: 0, successRate: null, classificationCoverage: null, freshnessAt: null },
      daily: days,
      operations: [],
      errors: []
    };
    const app = await setup(mockApi(capabilities, result));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--from", "2026-01-01", "--to", "2026-03-31", "--json"]);
    expect(app.fetch).toHaveBeenLastCalledWith(`${base}/admin/operations/v2?from=2026-01-01&to=2026-03-31`, expect.any(Object));
    expect(JSON.parse(app.stdout.join(""))).toEqual(result);
  });

  test("rejects a future date without presenting a successful result", async () => {
    const app = await setup(async (input) => String(input) === `${base}/capabilities`
      ? Response.json(capabilities)
      : Response.json({ error: { code: "VALIDATION_ERROR", message: "Future date" } }, { status: 400 }));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--from", "2099-01-01", "--to", "2099-01-01", "--json"]);
    expect(process.exitCode).toBe(1);
    expect(app.stdout.join("")).toBe("");
    expect(app.stderr.join("")).not.toBe("");
  });

  test.each(["0", "-1", "not-a-number", "10000000000000000000000000000", "1.0000000000000001", "1e2"])("rejects invalid user id %s", async (userId) => {
    const app = await setup(mockApi());
    await expect(app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--user-id", userId])).rejects.toMatchObject({ code: "commander.invalidArgument" });
    expect(app.fetch).not.toHaveBeenCalled();
  });

  test.each(["9007199254740993", "9999999999999999999999999999"])("sends and returns large user id %s without precision loss", async (id) => {
    const raw = JSON.stringify(payloadWithUser).replace('"id":42', `"id":${id}`);
    const app = await setup(async (input) => String(input) === `${base}/capabilities`
      ? Response.json(capabilities)
      : new Response(raw, { headers: { "content-type": "application/json" } }));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--from", "2026-07-01", "--to", "2026-07-01", "--user-id", id, "--json"]);
    expect(app.fetch).toHaveBeenLastCalledWith(`${base}/admin/operations/v2?from=2026-07-01&to=2026-07-01&userId=${id}`, expect.any(Object));
    expect(app.stdout.join("")).toContain(`"id": ${id}`);
    expect(process.exitCode).toBeUndefined();
  });

  test("rejects a large response id that differs by one", async () => {
    const raw = JSON.stringify(payloadWithUser).replace('"id":42', '"id":9007199254740992');
    const app = await setup(async (input) => String(input) === `${base}/capabilities`
      ? Response.json(capabilities)
      : new Response(raw, { headers: { "content-type": "application/json" } }));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--from", "2026-07-01", "--to", "2026-07-01", "--user-id", "9007199254740993", "--json"]);
    expect(process.exitCode).toBe(1);
    expect(app.stdout.join("")).toBe("");
  });

  test("preserves a large user id in text output", async () => {
    const id = "9007199254740993";
    const raw = JSON.stringify(payloadWithUser).replace('"id":42', `"id":${id}`);
    const app = await setup(async (input) => String(input) === `${base}/capabilities`
      ? Response.json(capabilities)
      : new Response(raw, { headers: { "content-type": "application/json" } }));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--from", "2026-07-01", "--to", "2026-07-01", "--user-id", id, "--format", "text"]);
    expect(app.stdout.join("")).toContain(`user: ${id} Alice`);
  });

  test("compares an exactly equivalent large exponential JSON number without rounding", async () => {
    const raw = JSON.stringify(payloadWithUser).replace('"id":42', '"id":9.007199254740993e15');
    const app = await setup(async (input) => String(input) === `${base}/capabilities`
      ? Response.json(capabilities)
      : new Response(raw, { headers: { "content-type": "application/json" } }));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--from", "2026-07-01", "--to", "2026-07-01", "--user-id", "9007199254740993", "--json"]);
    expect(app.stdout.join("")).toContain('"id": 9.007199254740993e15');
    expect(process.exitCode).toBeUndefined();
  });

  test.each([
    { argv: ["--from", "2026-01-01", "--to", "2026-01-01"], result: payload },
    { argv: ["--user-id", "42"], result: payload },
    { argv: ["--limit", "10"], result: payload },
    { argv: [], result: { ...payload, filter: { ...payload.filter, limit: 50 } } },
    { argv: [], result: { ...payload, window: payloadWithUser.window, daily: payloadWithUser.daily } }
  ])("rejects a response that does not match requested filters", async ({ argv, result }) => {
    const app = await setup(mockApi(capabilities, result));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", ...argv, "--json"]);
    expect(process.exitCode).toBe(1);
    expect(app.stdout.join("")).toBe("");
    expect(app.stderr.join("")).not.toBe("");
  });

  test.each([
    { ...capabilities, capabilities: [] },
    { ...capabilities, capabilities: [{ id: "admin-operations-v2", available: false, unavailableReason: "FORBIDDEN" }] },
    { ...capabilities, capabilities: [{ id: "admin-operations-v2", available: true, endpoints: ["/admin/operations"] }] },
    { ...capabilities, capabilities: [capabilities.capabilities[0], { id: "admin-operations-v2", available: false, unavailableReason: "FORBIDDEN" }] },
    { ...capabilities, capabilities: [{ id: "admin-operations-v2", available: false, unavailableReason: "FORBIDDEN" }, capabilities.capabilities[0]] },
    { ...capabilities, contractVersion: "99.0.0" }
  ])("fails closed when the declared capability, endpoint, or version is unsuitable", async (inventory) => {
    const app = await setup(mockApi(inventory));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--json"]);
    expect(process.exitCode).toBe(1);
    expect(app.stderr.join("")).not.toBe("");
    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(app.fetch).toHaveBeenCalledWith(`${base}/capabilities`, expect.any(Object));
  });

  test("explains administrator-only access and retains the capability request id", async () => {
    const inventory = { ...capabilities, capabilities: [{ id: "admin-operations-v2", available: false, unavailableReason: "FORBIDDEN" }] };
    const app = await setup(mockApi(inventory));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--json"]);
    expect(JSON.parse(app.stderr.join("")).error).toEqual(expect.objectContaining({
      code: "FORBIDDEN", requestId: "req_capabilities", message: expect.stringMatching(/administrator/i)
    }));
    expect(app.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    { ...payload, schemaVersion: 1 },
    { ...payload, semanticsId: "OTHER" },
    { ...payload, totals: undefined },
    { ...payload, totals: { ...payload.totals, successRate: 100 } },
    { ...payload, totals: { ...payload.totals, classificationCoverage: 0 } },
    { ...payload, totals: { ...payload.totals, freshnessAt: "0" } },
    { ...payload, totals: { ...payload.totals, freshnessAt: "2026-02-30T09:00:00+08:00" } },
    { ...payload, totals: { ...payload.totals, distinctUsers: 5 } },
    { ...payload, operations: [{ ...payload.operations[0], successRate: 0 }] },
    { ...payload, operations: [{ ...payload.operations[0], distinctUsers: 5 }] },
    { ...payload, operations: Array.from({ length: 21 }, () => payload.operations[0]) },
    { ...payload, errors: [{ ...payload.errors[0], httpStatus: 200 }] },
    { ...payload, errors: [{ ...payload.errors[0], distinctUsers: 2 }] },
    { ...payload, errors: Array.from({ length: 21 }, () => payload.errors[0]) },
    { ...payload, totals: { calls: 0, successCount: 0, failureCount: 0, unclassifiedCalls: 0, classifiedCalls: 0, distinctUsers: 0, successRate: 0, classificationCoverage: 0, freshnessAt: null } },
    { ...payload, daily: "not-an-array" },
    { ...payload, keywords: [] },
    { ...payload, totals: { ...payload.totals, metadata: { keyword: "private" } } },
    { ...payload, totals: { ...payload.totals, metadata: { Authorization: "synthetic" } } },
    { ...payload, extra: { _email: "synthetic" } },
    { ...payload, extra: { "Authorization-": "synthetic" } },
    { ...payload, extra: { " api key ": "synthetic" } },
    { ...payload, extra: { emailAddress: "synthetic" } },
    { ...payload, extra: { phoneNumber: "synthetic" } },
    { ...payload, extra: { searchKeyword: "synthetic" } },
    { ...payload, extra: { "X-Forwarded-For": "synthetic" } },
    { ...payload, extra: { apiKeyValue: "synthetic" } }
  ])("rejects malformed or v1-shaped responses", async (result) => {
    const app = await setup(mockApi(capabilities, result));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--json"]);
    expect(process.exitCode).toBe(1);
    expect(app.stderr.join("")).not.toBe("");
    expect(app.stdout.join("")).toBe("");
    expect(app.fetch).toHaveBeenCalledTimes(2);
  });

  test("propagates a server permission error without retrying v1", async () => {
    const app = await setup(async (input) => String(input) === `${base}/capabilities`
      ? Response.json(capabilities)
      : Response.json({ ok: false, error: { code: "FORBIDDEN", message: "Forbidden" }, requestId: "req_forbidden" }, { status: 403 }));
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--json"]);
    expect(process.exitCode).toBe(1);
    expect(app.stderr.join("")).toContain("FORBIDDEN");
    expect(app.fetch).toHaveBeenCalledTimes(2);
    expect(app.fetch).toHaveBeenLastCalledWith(`${base}/admin/operations/v2`, expect.any(Object));
  });

  test("text output distinguishes unclassified calls and omits keywords", async () => {
    const app = await setup(mockApi());
    await app.program.parseAsync(["node", "apexcn", "admin", "operations-v2", "--format", "text"]);
    const text = app.stdout.join("");
    expect(text).toContain("Asia/Shanghai");
    expect(text).toMatch(/unclassified[^\n]*1/i);
    expect(text).toMatch(/classification[^\n]*75/i);
    expect(text).toContain("AFA-CLI-OPS-1.0");
    expect(text).toMatch(/schema.?version[^\n]*2/i);
    expect(text).toMatch(/limit[^\n]*20/i);
    expect(text).toMatch(/operation\s+route\s+calls\s+success/i);
    expect(text).toMatch(/http.?status\s+error.?code/i);
    expect(text).not.toMatch(/keywords:/i);
  });

  test("publishes a separate v2 schema and rejects v1 and keyword-bearing data", () => {
    expect(schemaIdForCommand("admin.operations-v2")).toBe("admin-operations-response-v2");
    const schema = publicSchemaForId("admin-operations-response-v2");
    expect(schema).toBeDefined();
    const ajv = new Ajv({ allErrors: true, strict: false, formats: { date: /^\d{4}-\d{2}-\d{2}$/, "date-time": /^\d{4}-\d{2}-\d{2}T/ } });
    const validate = ajv.compile(schema);
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...payload, schemaVersion: 1 })).toBe(false);
    expect(validate({ ...payload, semanticsId: "OTHER" })).toBe(false);
    expect(validate({ ...payload, keywords: [] })).toBe(false);
    expect(validate({ ...payload, errors: [{ ...payload.errors[0], httpStatus: 200 }] })).toBe(false);
    expect(validate({ ...payload, totals: { ...payload.totals, metadata: { KEYWORD: "private" } } })).toBe(false);
    expect(validate({ ...payload, totals: { ...payload.totals, metadata: { Authorization: "synthetic" } } })).toBe(false);
    for (const key of ["_email", "Authorization-", " api key ", "emailAddress", "phoneNumber", "searchKeyword", "X-Forwarded-For", "apiKeyValue"]) {
      expect(validate({ ...payload, extra: { [key]: "synthetic" } })).toBe(false);
    }
  });
});
