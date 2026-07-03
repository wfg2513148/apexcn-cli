import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { createProgram, isCliEntrypoint } from "../src/index.js";
import type { Command } from "commander";

describe("CLI entrypoint detection", () => {
  test("prints the package version", async () => {
    const output: string[] = [];
    const program = createProgram({
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });
    program.exitOverride();

    await expect(program.parseAsync(["node", "apexcn", "--version"])).rejects.toMatchObject({ code: "commander.version" });

    expect(output.join("")).toBe("5.0.0\n");
  });

  test("prints a machine-readable command manifest", async () => {
    const output: string[] = [];
    const program = createProgram({
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "commands", "--json"]);

    const manifest = JSON.parse(output.join(""));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.version).toBe("5.0.0");
    expect(manifest.schema).toEqual({
      safetyEffects: ["read", "api-write", "destructive", "config-read", "config-write", "auth", "secret", "diagnostic", "manifest"],
      previewPolicies: ["required", "available", "none"],
      exampleModes: ["read", "preview", "execute"]
    });
    expect(manifest.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "topic create",
        aliases: expect.arrayContaining(["thread create"]),
        options: expect.arrayContaining(["--json", "--dry-run", "--preview"]),
        safety: expect.objectContaining({ effects: expect.arrayContaining(["api-write"]), preview: "available" }),
        examples: expect.arrayContaining([
          expect.objectContaining({ command: 'apexcn topic create --category-id 4 --title "标题" --content-file ./post.md --preview', mode: "preview" })
        ])
      }),
      expect.objectContaining({
        path: "topic update",
        aliases: expect.arrayContaining(["topic edit", "thread update", "thread edit"]),
        options: expect.arrayContaining(["--content <text>", "--content-file <path>"]),
        safety: expect.objectContaining({ effects: expect.arrayContaining(["api-write"]), preview: "available" })
      }),
      expect.objectContaining({
        path: "ask",
        aliases: [],
        options: expect.not.arrayContaining(["--preview", "--dry-run"]),
        safety: expect.objectContaining({ effects: ["read"], preview: "none" })
      }),
      expect.objectContaining({
        path: "search",
        options: expect.not.arrayContaining(["--offset <n>"]),
        examples: expect.arrayContaining([
          expect.objectContaining({ command: 'apexcn search "REST API" --page-size 5 --json', mode: "read" })
        ])
      }),
      expect.objectContaining({
        path: "commands",
        options: expect.arrayContaining(["--json"]),
        safety: expect.objectContaining({ effects: ["manifest"], preview: "none" })
      }),
      expect.objectContaining({
        path: "draft question",
        options: expect.arrayContaining(["--research-file <path>", "--format <format>"]),
        safety: expect.objectContaining({ effects: ["read"], preview: "none" }),
        examples: expect.arrayContaining([
          expect.objectContaining({ command: 'apexcn draft question --title "标题" --problem "问题描述" --research-file ./research.json --format text', mode: "read" })
        ])
      }),
      expect.objectContaining({
        path: "draft reply",
        options: expect.arrayContaining(["--topic-id <id>", "--answer <text>", "--topic-file <path>", "--research-file <path>", "--format <format>"]),
        safety: expect.objectContaining({ effects: ["read"], preview: "none" }),
        examples: expect.arrayContaining([
          expect.objectContaining({ command: 'apexcn draft reply --topic-id 30549 --answer "回复建议" --format text', mode: "read" })
        ])
      }),
      expect.objectContaining({
        path: "review topic",
        options: expect.arrayContaining(["--content-file <path>", "--draft-file <path>", "--category-id <id>", "--format <format>"]),
        safety: expect.objectContaining({ effects: ["read"], preview: "none" }),
        examples: expect.arrayContaining([
          expect.objectContaining({ command: 'apexcn review topic --title "标题" --content-file ./question.md --category-id 4 --json', mode: "read" })
        ])
      }),
      expect.objectContaining({
        path: "workflow plan",
        options: expect.arrayContaining(["--goal <goal>", "--problem <text>", "--answer <text>", "--content-file <path>", "--include-execute", "--format <format>"]),
        safety: expect.objectContaining({ effects: ["read"], preview: "none" }),
        examples: expect.arrayContaining([
          expect.objectContaining({ command: 'apexcn workflow plan --goal ask-question --keyword "REST API" --title "标题" --problem "问题描述" --category-id 4 --json', mode: "read" })
        ])
      })
    ]));
  });

  test("command manifest covers all leaf commands", async () => {
    const output: string[] = [];
    const program = createProgram({
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "commands", "--json"]);

    const manifest = JSON.parse(output.join(""));
    expect(manifest.commands.map((command: { path: string }) => command.path).sort()).toEqual(leafCommandPaths(createProgram()).sort());
  });

  test("command manifest descriptions are stable and non-empty", async () => {
    const output: string[] = [];
    const program = createProgram({
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "commands", "--json"]);

    const manifest = JSON.parse(output.join(""));
    expect(manifest.commands.every((command: { description: string }) => command.description.trim().length > 0)).toBe(true);
    expect(manifest.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "draft question", description: "draft a local community question from structured inputs and research links" }),
      expect.objectContaining({ path: "draft reply", description: "draft a local community reply from structured inputs and references" }),
      expect.objectContaining({ path: "review topic", description: "review a local topic draft before API preview or publish" }),
      expect.objectContaining({ path: "workflow plan", description: "plan a local, reviewable APEX Chinese Community workflow" }),
      expect.objectContaining({ path: "search", description: "search community topics" }),
      expect.objectContaining({ path: "topic create", description: "create a community topic" }),
      expect.objectContaining({ path: "reply delete", description: "delete a reply after explicit confirmation" })
    ]));
  });

  test("command manifest includes stable agent guidance for every leaf command", async () => {
    const output: string[] = [];
    const program = createProgram({
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "commands", "--json"]);

    const manifest = JSON.parse(output.join(""));
    const paths = leafCommandPaths(createProgram()).sort();
    const safetyEffects = new Set(manifest.schema.safetyEffects);
    const previewPolicies = new Set(manifest.schema.previewPolicies);
    const exampleModes = new Set(manifest.schema.exampleModes);
    expect(manifest.commands.map((command: { path: string }) => command.path).sort()).toEqual(paths);
    expect(manifest.commands.every((command: ManifestCommand) => command.safety.effects.length > 0)).toBe(true);
    expect(manifest.commands.every((command: ManifestCommand) => command.examples.length > 0)).toBe(true);
    expect(manifest.commands.every((command: ManifestCommand) => command.safety.effects.every((effect) => safetyEffects.has(effect)))).toBe(true);
    expect(manifest.commands.every((command: ManifestCommand) => previewPolicies.has(command.safety.preview))).toBe(true);
    expect(manifest.commands.every((command: ManifestCommand) => command.examples.every((example) => exampleModes.has(example.mode)))).toBe(true);
    expect(manifest.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "topic delete",
        safety: expect.objectContaining({
          effects: expect.arrayContaining(["api-write", "destructive"]),
          preview: "required",
          confirmation: ["--yes", "--force", "--confirm-title"]
        }),
        examples: expect.arrayContaining([
          expect.objectContaining({ command: 'apexcn topic delete 30549 --yes --force --confirm-title "精确标题" --preview', mode: "preview" })
        ])
      }),
      expect.objectContaining({
        path: "reply delete",
        safety: expect.objectContaining({
          effects: expect.arrayContaining(["api-write", "destructive"]),
          preview: "required",
          confirmation: ["--yes", "--force"]
        }),
        examples: expect.arrayContaining([
          expect.objectContaining({ command: "apexcn reply delete 67890 --yes --force --preview", mode: "preview" })
        ])
      }),
      expect.objectContaining({
        path: "auth set-token",
        safety: expect.objectContaining({
          effects: expect.arrayContaining(["config-write", "auth", "secret"]),
          preview: "none"
        }),
        examples: expect.arrayContaining([
          expect.objectContaining({ command: 'apexcn auth set-token --profile agent-prod --base-url https://oracleapex.cn/ords/api --token "$APEXCN_API_KEY"', mode: "execute" })
        ])
      })
    ]));
  });

  test("command manifest examples match registered command arguments", async () => {
    const output: string[] = [];
    const program = createProgram({
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "commands", "--json"]);

    const manifest = JSON.parse(output.join(""));
    const reference = createProgram();
    for (const command of manifest.commands as ManifestCommand[]) {
      for (const example of command.examples) {
        const parsed = commandFromExample(reference, example.command);
        expect(parsed.path).toBe(command.path);
        expect(example.mode).toMatch(/^(read|preview|execute)$/);
        expect(positionalsFromExample(parsed.command, parsed.pathLength, example.command).length).toBe(argumentCount(parsed.command));
      }
    }
  });

  test("command manifest does not read config or call the API", async () => {
    const output: string[] = [];
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const program = createProgram({
      configPath: "/tmp/apexcn-missing-config-for-commands.json",
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "commands", "--json"]);

    expect(JSON.parse(output.join("")).commands.length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test("prints a text command manifest", async () => {
    const output: string[] = [];
    const program = createProgram({
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "commands"]);

    expect(output.join("")).toContain("topic create\t");
    expect(output.join("")).toContain("--preview");
    expect(output.join("")).toContain("commands\t--json");
  });

  test("matches file URLs against argv script paths", () => {
    expect(isCliEntrypoint(pathToFileURL("/tmp/apexcn/dist/index.js").href, "/tmp/apexcn/dist/index.js")).toBe(true);
    expect(isCliEntrypoint(pathToFileURL("/tmp/apexcn with space/dist/index.js").href, "/tmp/apexcn with space/dist/index.js")).toBe(true);
    expect(isCliEntrypoint(pathToFileURL("/tmp/apexcn/dist/index.js").href, "/tmp/other/dist/index.js")).toBe(false);
    expect(isCliEntrypoint(pathToFileURL("/tmp/apexcn/dist/index.js").href, undefined)).toBe(false);
  });

  test("matches equivalent real paths when argv uses a symlinked path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apexcn-entry-"));
    const realDir = join(dir, "real");
    const linkDir = join(dir, "link");
    await mkdir(realDir);
    await writeFile(join(realDir, "index.js"), "");
    await symlink(realDir, linkDir, "dir");

    expect(isCliEntrypoint(pathToFileURL(join(realDir, "index.js")).href, join(linkDir, "index.js"))).toBe(true);
  });
});

function leafCommandPaths(command: Command, prefix: string[] = [], includeCurrent = false): string[] {
  const names = [command.name()];
  const nextPrefixes = includeCurrent ? names.map((name) => [...prefix, name]) : [prefix];
  if (command.commands.length === 0) {
    return nextPrefixes.map((parts) => parts.join(" ")).filter(Boolean);
  }
  return nextPrefixes.flatMap((parts) => command.commands.flatMap((child) => leafCommandPaths(child, parts, true)));
}

type ManifestCommand = {
  path: string;
  safety: {
    effects: string[];
    preview: string;
    confirmation: string[];
  };
  examples: Array<{
    command: string;
    mode: string;
  }>;
};

function commandFromExample(program: Command, example: string): { command: Command; path: string; pathLength: number } {
  const tokens = tokenizeExample(example);
  expect(tokens[0]).toBe("apexcn");
  let current = program;
  let index = 1;
  const path: string[] = [];
  while (index < tokens.length) {
    const next = current.commands.find((command) => command.name() === tokens[index] || command.aliases().includes(tokens[index]));
    if (!next) {
      break;
    }
    path.push(next.name());
    current = next;
    index += 1;
  }
  expect(path.length).toBeGreaterThan(0);
  return { command: current, path: path.join(" "), pathLength: index };
}

function positionalsFromExample(command: Command, pathLength: number, example: string): string[] {
  const tokens = tokenizeExample(example);
  const valueOptions = new Set(command.options.filter((option) => option.required || option.optional).map((option) => option.long));
  const positionals: string[] = [];
  for (let index = pathLength; index < tokens.length;) {
    const token = tokens[index];
    const [optionName] = token.split("=", 1);
    if (token.startsWith("--")) {
      if (!token.includes("=") && valueOptions.has(optionName) && tokens[index + 1] && !tokens[index + 1].startsWith("-")) {
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    positionals.push(token);
    index += 1;
  }
  return positionals;
}

function argumentCount(command: Command): number {
  return (command as unknown as { registeredArguments: unknown[] }).registeredArguments.length;
}

function tokenizeExample(example: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(example)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}
