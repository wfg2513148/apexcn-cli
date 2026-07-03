import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

async function tempPath(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-draft-"));
  return join(dir, name);
}

function draftProgram(options: { readStdin?: () => Promise<string> } = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = createProgram({
    configPath: "/tmp/apexcn-draft-missing-config.json",
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    ...options
  });
  return { program, stdout, stderr };
}

describe("draft commands", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
    delete process.env.APEXCN_CONFIG_PATH;
    delete process.env.APEXCN_ERROR_FORMAT;
  });

  test("draft question prints a stable local JSON contract", async () => {
    process.env.APEXCN_CONFIG_PATH = "/tmp/apexcn-draft-env-config-should-not-be-read.json";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { program, stdout, stderr } = draftProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "draft",
      "question",
      "--title",
      "APEX REST 调用失败",
      "--problem",
      "页面进程调用 REST API 报错。",
      "--environment",
      "APEX 24.1",
      "--tried",
      "检查过 ORDS URL。",
      "--expected",
      "返回 JSON 数据。",
      "--actual",
      "返回 403。"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    const data = JSON.parse(stdout.join(""));
    expect(data).toEqual({
      kind: "question-draft",
      schemaVersion: 1,
      title: "APEX REST 调用失败",
      content: expect.stringContaining("## 问题\n\n页面进程调用 REST API 报错。"),
      sections: {
        problem: "页面进程调用 REST API 报错。",
        environment: "APEX 24.1",
        tried: "检查过 ORDS URL。",
        expected: "返回 JSON 数据。",
        actual: "返回 403。"
      },
      references: []
    });
  });

  test("draft question text output includes fixed Markdown sections and deduped research links", async () => {
    const researchPath = await tempPath("research.json");
    await writeFile(researchPath, JSON.stringify({
      links: [
        { id: 42, title: "REST API", url: "https://oracleapex.cn/t/42", originalUrl: "https://oracleapex.cn/original/42" },
        { topicId: 42, topicTitle: "Duplicate", threadUrl: "https://oracleapex.cn/t/42" }
      ],
      topics: [
        { id: 43, title: "ORDS", threadUrl: "https://oracleapex.cn/t/43" }
      ]
    }));
    const { program, stdout, stderr } = draftProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "draft",
      "question",
      "--title",
      "REST 问题",
      "--problem",
      "调用失败",
      "--research-file",
      researchPath,
      "--format",
      "text"
    ]);

    const text = stdout.join("");
    expect(stderr.join("")).toBe("");
    expect(text).toContain("# REST 问题\n");
    expect(text).toContain("## 问题\n\n调用失败");
    expect(text).toContain("## 环境\n\n待补充");
    expect(text).toContain("## 已尝试\n\n待补充");
    expect(text).toContain("## 期望结果\n\n待补充");
    expect(text).toContain("## 实际结果\n\n待补充");
    expect(text).toContain("## 参考链接\n\n1. REST API - https://oracleapex.cn/t/42 | original: https://oracleapex.cn/original/42\n2. ORDS - https://oracleapex.cn/t/43");
    expect(text).not.toContain("Duplicate");
  });

  test("draft question works with a broken config file because it is local only", async () => {
    const configPath = await tempPath("config.json");
    await writeFile(configPath, "{broken");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "draft",
      "question",
      "--title",
      "Local",
      "--problem",
      "No auth needed",
      "--format",
      "text"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("# Local\n");
  });

  test("draft question reads research JSON from stdin", async () => {
    const { program, stdout } = draftProgram({
      readStdin: async () => JSON.stringify({
        links: [{ id: 7, title: "stdin source", url: "https://oracleapex.cn/t/7" }]
      })
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "draft",
      "question",
      "--title",
      "stdin",
      "--problem",
      "problem",
      "--research-file",
      "-",
      "--json"
    ]);

    const data = JSON.parse(stdout.join(""));
    expect(data.references).toEqual([{ id: "7", title: "stdin source", url: "https://oracleapex.cn/t/7" }]);
  });

  test("draft question rejects invalid research JSON", async () => {
    const researchPath = await tempPath("bad.json");
    await writeFile(researchPath, "{not json");
    const { program, stdout, stderr } = draftProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "draft",
      "question",
      "--title",
      "Title",
      "--problem",
      "Problem",
      "--research-file",
      researchPath
    ]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe(`Invalid research file: ${researchPath}\n`);
    expect(process.exitCode).toBe(1);
  });

  test("draft question rejects research JSON that is not an object", async () => {
    const { program, stdout, stderr } = draftProgram({
      readStdin: async () => "[]"
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "draft",
      "question",
      "--title",
      "Title",
      "--problem",
      "Problem",
      "--research-file",
      "-"
    ]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("Invalid research file: - must contain a JSON object\n");
    expect(process.exitCode).toBe(1);
  });

  test("draft question rejects blank required fields before local file reads", async () => {
    const { program, stdout, stderr } = draftProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "draft",
      "question",
      "--title",
      "   ",
      "--problem",
      "Problem",
      "--research-file",
      "/tmp/does-not-matter.json"
    ]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("--title must not be blank\n");
    expect(process.exitCode).toBe(1);
  });
});
