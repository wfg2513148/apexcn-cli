import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

const GOOD_CONTENT = [
  "# APEX REST API returns 403",
  "",
  "## 问题",
  "",
  "页面进程调用 REST API 时返回 403，需要确认认证配置。",
  "",
  "## 环境",
  "",
  "APEX 24.1 / ORDS 24 / Autonomous Database。",
  "",
  "## 已尝试",
  "",
  "确认 URL 能访问，也检查过 Web Credential 名称。",
  "",
  "## 期望结果",
  "",
  "页面进程能返回 JSON 数据。",
  "",
  "## 实际结果",
  "",
  "调用时返回 403。",
  "",
  "## 参考链接",
  "",
  "1. REST API - https://oracleapex.cn/t/42"
].join("\n");

const GOOD_REPLY = [
  "## 简短回应",
  "",
  "这个 403 更像是认证或 Web Credential 配置问题，可以先确认 ORDS URL 和凭据映射。",
  "",
  "## 建议步骤",
  "",
  "1. 在 APEX 中确认 Web Credential 名称。",
  "2. 用同一个 URL 单独测试接口权限。",
  "",
  "## 参考链接",
  "",
  "https://oracleapex.cn/t/42"
].join("\n");

async function tempPath(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-review-"));
  return join(dir, name);
}

function reviewProgram(options: { readStdin?: () => Promise<string>; configPath?: string } = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = createProgram({
    configPath: options.configPath ?? "/tmp/apexcn-review-missing-config.json",
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    readStdin: options.readStdin
  });
  return { program, stdout, stderr };
}

describe("review commands", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
    delete process.env.APEXCN_CONFIG_PATH;
  });

  test("review topic builds a local request plan for a Markdown file", async () => {
    const contentPath = await tempPath("question.md");
    await writeFile(contentPath, GOOD_CONTENT);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { program, stdout, stderr } = reviewProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "review",
      "topic",
      "--title",
      "APEX REST API returns 403",
      "--content-file",
      contentPath,
      "--category-id",
      "4",
      "--tags",
      "APEX,REST",
      "--json"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(true);
    expect(data.issues).toEqual([]);
    expect(data.requestPlan).toEqual({
      method: "POST",
      path: "/api/v1/topics",
      body: {
        categoryId: 4,
        title: "APEX REST API returns 403",
        content: GOOD_CONTENT,
        tags: "APEX,REST"
      }
    });
    expect(data.suggestedCommand.command).toContain(`--content-file ${contentPath}`);
    expect(data.suggestedCommand.command).toContain("--preview");
  });

  test("review topic accepts novice-friendly inline --content", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { program, stdout, stderr } = reviewProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "review",
      "topic",
      "--title",
      "APEX REST API returns 403",
      "--content",
      GOOD_CONTENT,
      "--category-id",
      "4",
      "--json"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(true);
    expect(data.requestPlan.body.content).toBe(GOOD_CONTENT);
    expect(data.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsaved-content-file" })
    ]));
    expect(data.suggestedCommand).toBeNull();
  });

  test("review topic supports text output and stdin content without suggesting a publish command", async () => {
    const { program, stdout, stderr } = reviewProgram({
      readStdin: async () => GOOD_CONTENT
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "review",
      "topic",
      "--title",
      "APEX REST API returns 403",
      "--content-file",
      "-",
      "--format",
      "text"
    ]);

    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("Status: ok");
    expect(stdout.join("")).toContain("Warnings:");
    expect(stdout.join("")).toContain("unsaved-content-file");
    expect(stdout.join("")).toContain("Suggested preview: unavailable until content is saved as Markdown");
  });

  test("review topic reads question-draft JSON without treating it as publishable content file", async () => {
    const draftPath = await tempPath("draft.json");
    await writeFile(draftPath, JSON.stringify({
      kind: "question-draft",
      schemaVersion: 1,
      title: "Draft title",
      content: GOOD_CONTENT
    }));
    const { program, stdout, stderr } = reviewProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "review",
      "topic",
      "--draft-file",
      draftPath,
      "--category-id",
      "4"
    ]);

    const data = JSON.parse(stdout.join(""));
    expect(stderr.join("")).toBe("");
    expect(data.ok).toBe(true);
    expect(data.suggestedCommand).toBeNull();
    expect(data.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsaved-content-file", severity: "warning" })
    ]));
    expect(data.requestPlan.body.title).toBe("Draft title");
    expect(data.requestPlan.body.content).toBe(GOOD_CONTENT);
  });

  test("review topic rejects invalid draft schemas", async () => {
    const draftPath = await tempPath("bad-draft.json");
    await writeFile(draftPath, JSON.stringify({ kind: "note", schemaVersion: 1, title: "T", content: GOOD_CONTENT }));
    const { program, stdout, stderr } = reviewProgram();

    await program.parseAsync(["node", "apexcn", "review", "topic", "--draft-file", draftPath]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe(`Invalid draft file: ${draftPath} must contain a question-draft schema\n`);
    expect(process.exitCode).toBe(1);
  });

  test("review topic reports hard issues and redacts possible secrets from request plan", async () => {
    const content = `${GOOD_CONTENT}\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz\npassword=super-secret`;
    const { program, stdout, stderr } = reviewProgram({
      readStdin: async () => content
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "review",
      "topic",
      "--title",
      "APEX REST API returns 403",
      "--content-file",
      "-"
    ]);

    const data = JSON.parse(stdout.join(""));
    expect(stderr.join("")).toBe("");
    expect(data.ok).toBe(false);
    expect(data.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "possible-secret", severity: "issue" })
    ]));
    expect(data.requestPlan.body.content).toContain("Authorization: Bearer [redacted]");
    expect(data.requestPlan.body.content).toContain("password=[redacted]");
    expect(data.requestPlan.body.content).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(data.requestPlan.body.content).not.toContain("super-secret");
    expect(process.exitCode).toBe(1);
  });

  test("review topic reports blank titles as review issues", async () => {
    const { program, stdout, stderr } = reviewProgram({
      readStdin: async () => GOOD_CONTENT
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "review",
      "topic",
      "--title",
      "   ",
      "--content-file",
      "-"
    ]);

    const data = JSON.parse(stdout.join(""));
    expect(stderr.join("")).toBe("");
    expect(data.ok).toBe(false);
    expect(data.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "blank-title", severity: "issue" })
    ]));
    expect(data.requestPlan.body.title).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("review topic validates missing title before reading content files", async () => {
    const { program, stdout, stderr } = reviewProgram({
      readStdin: async () => {
        throw new Error("stdin should not be read");
      }
    });

    await program.parseAsync(["node", "apexcn", "review", "topic", "--content-file", "-"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("--title is required when using --content or --content-file\n");
    expect(process.exitCode).toBe(1);
  });

  test("review topic works with a broken config file because it is local only", async () => {
    const configPath = await tempPath("config.json");
    const contentPath = await tempPath("question.md");
    await writeFile(configPath, "{broken");
    await writeFile(contentPath, GOOD_CONTENT);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { program, stdout, stderr } = reviewProgram({ configPath });

    await program.parseAsync([
      "node",
      "apexcn",
      "review",
      "topic",
      "--title",
      "APEX REST API returns 403",
      "--content-file",
      contentPath,
      "--category-id",
      "4"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join("")).ok).toBe(true);
  });

  test("review reply builds a local request plan for a Markdown file without calling the API", async () => {
    const replyPath = await tempPath("reply.md");
    await writeFile(replyPath, GOOD_REPLY);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { program, stdout, stderr } = reviewProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "review",
      "reply",
      "--topic-id",
      "30549",
      "--parent-post-id",
      "201480",
      "--content-file",
      replyPath,
      "--json"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    const data = JSON.parse(stdout.join(""));
    expect(data).toEqual(expect.objectContaining({
      kind: "reply-review",
      schemaVersion: 1,
      ok: true
    }));
    expect(data.issues).toEqual([]);
    expect(data.requestPlan).toEqual({
      method: "POST",
      path: "/api/v1/topics/30549/replies",
      body: {
        content: GOOD_REPLY,
        parentPostId: 201480
      }
    });
    expect(data.suggestedCommand.command).toContain(`apexcn reply create 30549 --parent-post-id 201480 --content-file ${replyPath} --dry-run --json`);
  });

  test("review reply reads reply-draft JSON without suggesting a content-file command", async () => {
    const draftPath = await tempPath("reply-draft.json");
    await writeFile(draftPath, JSON.stringify({
      kind: "reply-draft",
      schemaVersion: 1,
      topicId: 30549,
      parentPostId: null,
      content: GOOD_REPLY,
      references: [],
      metadata: { tone: "friendly" }
    }));
    const { program, stdout, stderr } = reviewProgram();

    await program.parseAsync(["node", "apexcn", "review", "reply", "--draft-file", draftPath, "--format", "text"]);

    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("Status: ok");
    expect(stdout.join("")).toContain("unsaved-content-file");
    expect(stdout.join("")).toContain("Suggested preview: unavailable until content is saved as Markdown");
  });

  test("review reply reports draft topic mismatches as schema issues", async () => {
    const draftPath = await tempPath("reply-draft.json");
    await writeFile(draftPath, JSON.stringify({
      kind: "reply-draft",
      schemaVersion: 1,
      topicId: 30549,
      parentPostId: 201480,
      content: GOOD_REPLY,
      references: [],
      metadata: { tone: "friendly" }
    }));
    const { program, stdout, stderr } = reviewProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "review",
      "reply",
      "--topic-id",
      "999",
      "--parent-post-id",
      "777",
      "--draft-file",
      draftPath
    ]);

    const data = JSON.parse(stdout.join(""));
    expect(stderr.join("")).toBe("");
    expect(data.ok).toBe(false);
    expect(data.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "topic-id-mismatch", severity: "issue" }),
      expect.objectContaining({ code: "parent-post-id-mismatch", severity: "issue" })
    ]));
    expect(process.exitCode).toBe(1);
  });

  test("review reply reports input contract problems in reply-review JSON", async () => {
    const { program, stdout, stderr } = reviewProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "review",
      "reply",
      "--topic-id",
      "0",
      "--content-file",
      "reply.md",
      "--draft-file",
      "draft.json"
    ]);

    const data = JSON.parse(stdout.join(""));
    expect(stderr.join("")).toBe("");
    expect(data.kind).toBe("reply-review");
    expect(data.ok).toBe(false);
    expect(data.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-topic-id" }),
      expect.objectContaining({ code: "input-conflict" }),
      expect.objectContaining({ code: "blank-content" })
    ]));
    expect(data.requestPlan).toBeNull();
    expect(data.suggestedCommand).toBeNull();
    expect(process.exitCode).toBe(1);
  });

  test("review reply redacts possible secrets from the request plan", async () => {
    const content = `${GOOD_REPLY}\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz\ntoken=super-secret`;
    const { program, stdout, stderr } = reviewProgram({
      readStdin: async () => content
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "review",
      "reply",
      "--topic-id",
      "30549",
      "--content-file",
      "-"
    ]);

    const data = JSON.parse(stdout.join(""));
    expect(stderr.join("")).toBe("");
    expect(data.ok).toBe(false);
    expect(data.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "possible-secret", severity: "issue" })
    ]));
    expect(data.requestPlan.body.content).toContain("Authorization: Bearer [redacted]");
    expect(data.requestPlan.body.content).toContain("token=[redacted]");
    expect(data.requestPlan.body.content).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(data.requestPlan.body.content).not.toContain("super-secret");
    expect(process.exitCode).toBe(1);
  });
});
