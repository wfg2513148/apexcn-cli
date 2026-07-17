import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  expectedReferenceMatch,
  expectedTopicMatch,
  p95Seconds,
  searchEvidenceText
} from "../scripts/retrieval-eval-score.mjs";

const repoRoot = join(__dirname, "..");

describe("live readonly retrieval eval", () => {
  test("scores all user-visible search evidence but ignores transport metadata", () => {
    const evidence = searchEvidenceText([{
      title: "ORDS 身份认证排查",
      snippet: "检查 OAuth 客户端和权限。",
      tags: ["ORDS", "Security"],
      categoryName: "问题排查",
      matchedTerms: ["OAuth"],
      matchEvidence: "OAuth:body",
      requestId: "fabricated-request-term",
      url: "https://example.invalid/fabricated-url-term"
    }]);

    expect(evidence).toContain("ords");
    expect(evidence).toContain("oauth");
    expect(evidence).toContain("oauth:body");
    expect(evidence).not.toContain("fabricated-request-term");
    expect(evidence).not.toContain("fabricated-url-term");
  });

  test("matches compound visible terms and exact expected topic ids", () => {
    const items = [{
      id: 23421,
      title: "Oracle APEX 中实现交互式网格变更预览功能",
      matchedTerms: "grid, interactive, 保存",
      matchEvidence: "grid:body, interactive:body, 保存:body"
    }];

    expect(expectedReferenceMatch(items, ["Interactive Grid", "保存"], 2)).toEqual({
      matchedTerms: ["Interactive Grid", "保存"],
      hit: true
    });
    expect(expectedTopicMatch(items, [23421])).toEqual({
      matchedTopicIds: [23421],
      hit: true
    });
    expect(expectedTopicMatch(items, [23133])).toEqual({
      matchedTopicIds: [],
      hit: false
    });
  });

  test("requires cited source titles or tags to match the expected reference terms", () => {
    expect(expectedReferenceMatch([
      { title: "ORDS OAuth2 身份认证", tags: ["REST", "Security"] }
    ], ["ORDS", "认证", "OAuth"], 2)).toEqual({
      matchedTerms: ["ORDS", "认证", "OAuth"],
      hit: true
    });

    expect(expectedReferenceMatch([
      { title: "Oracle APEX 安装入门", url: "https://oracleapex.cn/t/1" }
    ], ["REST API", "OAuth"], 2)).toEqual({
      matchedTerms: [],
      hit: false
    });
  });

  test("keeps ask and research latency percentiles independently measurable", () => {
    const askLatencies = [...Array(14).fill(9_000), 30_000];
    const researchLatencies = Array(45).fill(500);

    expect(p95Seconds([...askLatencies, ...researchLatencies])).toBe(9);
    expect(p95Seconds(askLatencies)).toBe(30);
    expect(p95Seconds(researchLatencies)).toBe(0.5);
  });

  test("declares a RAG path for every answerable question", () => {
    const questions = readFileSync(join(repoRoot, "eval/retrieval/questions.zh.jsonl"), "utf8")
      .trim()
      .split(/\n/)
      .map((line) => JSON.parse(line));
    const answerable = questions.filter((item) => item.answerability !== "unanswerable");

    expect(answerable).toHaveLength(50);
    expect(answerable.every((item) => ["ask", "research"].includes(item.ragMode))).toBe(true);
    expect(answerable.every((item) => Array.isArray(item.expectedTopicIds) && item.expectedTopicIds.length > 0)).toBe(true);
    expect(answerable.every((item) => item.minimumMatchedTerms >= 2)).toBe(true);
    expect(answerable.filter((item) => item.ragMode === "ask")).toHaveLength(5);
    expect(answerable.filter((item) => item.ragMode === "research")).toHaveLength(45);
  });

  test("does not use a default profile when no explicit config or dev environment is provided", () => {
    const output = execFileSync("node", ["scripts/eval-retrieval.mjs", "--report"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        APEXCN_LIVE_EVAL_CONFIG: ""
      }
    });
    const report = JSON.parse(output);

    expect(report).toEqual(expect.objectContaining({
      kind: "live-retrieval-eval-report",
      mode: "live-readonly-unavailable",
      doesNotCallWriteApi: true,
      reason: expect.stringContaining("--config"),
      ok: false
    }));
    expect(report.dataset).toEqual(expect.objectContaining({
      questionCount: 60
    }));
  });

  test("rejects a live run without the explicit dev@oci environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-retrieval-eval-"));
    const config = join(dir, "config.json");
    writeFileSync(config, "{}\n");

    const output = execFileSync("node", [
      "scripts/eval-retrieval.mjs",
      "--report",
      "--config",
      config
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        APEXCN_LIVE_EVAL_CONFIG: "",
        APEXCN_LIVE_EVAL_ENVIRONMENT: ""
      }
    });
    const report = JSON.parse(output);

    expect(report).toEqual(expect.objectContaining({
      mode: "live-readonly-unavailable",
      reason: "--environment dev@oci is required for live retrieval evaluation",
      ok: false
    }));
  });

  test("rejects a config that targets a non-dev ORDS base URL before retrieval", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-retrieval-eval-"));
    const config = join(dir, "config.json");
    writeFileSync(config, JSON.stringify({
      current: "unsafe",
      profiles: {
        unsafe: {
          baseUrl: "https://oracleapex.cn/ords/apexcn",
          token: "test-token-not-a-real-secret"
        }
      }
    }));

    const output = execFileSync("node", [
      "scripts/eval-retrieval.mjs",
      "--report",
      "--config",
      config,
      "--environment",
      "dev@oci"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        APEXCN_API_KEY: ""
      }
    });
    const report = JSON.parse(output);

    expect(output).not.toContain("test-token-not-a-real-secret");
    expect(report).toEqual(expect.objectContaining({
      mode: "live-readonly-unavailable",
      reason: "configured profile must target the dev@oci ORDS base URL",
      ok: false
    }));
  });

  test("strict mode rejects an incomplete or duplicate dataset before requiring config", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-retrieval-eval-"));
    const questions = join(dir, "questions.jsonl");
    writeFileSync(questions, [
      JSON.stringify({
        id: "dup",
        question: "ORDS 401?",
        searchQuery: "ORDS 401",
        expectedReferenceTerms: ["ORDS"],
        minimumMatchedTerms: 1,
        answerability: "answerable",
        ragMode: "ask"
      }),
      JSON.stringify({
        id: "dup",
        question: "ORDS 403?",
        searchQuery: "ORDS 403",
        expectedReferenceTerms: ["ORDS"],
        minimumMatchedTerms: 1,
        answerability: "answerable",
        ragMode: "ask"
      })
    ].join("\n") + "\n");

    const result = spawnSync("node", [
      "scripts/eval-retrieval.mjs",
      "--strict",
      "--questions",
      questions
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        APEXCN_LIVE_EVAL_CONFIG: ""
      }
    });

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.mode).toBe("live-readonly-unavailable");
    expect(report.reason).toContain("invalid dataset");
    expect(report.datasetProblems).toEqual(expect.arrayContaining([
      expect.stringContaining("duplicate id"),
      expect.stringContaining("at least 50 answerable"),
      expect.stringContaining("at least 10 unanswerable")
    ]));
  });
});
