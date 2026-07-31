import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createProgram } from "../src/index.js";

type Route = {
  id: string;
  category: string;
  network: "local" | "remote-read" | "remote-write";
  commands: string[];
  preflightCommands: string[];
  mutationCommand?: string;
  requiresPreview: boolean;
  requiresConfirmation: boolean;
  examples: string[];
};

type Catalog = {
  schemaVersion: number;
  release: string;
  policy: {
    localTasksRequireAuthPreflight: boolean;
    remotePreflightIsIntentSpecific: boolean;
    communityMutationsRequirePreview: boolean;
    previewedMutationsRequireExplicitConfirmation: boolean;
  };
  routes: Route[];
};

const repoRoot = join(__dirname, "..");
const catalog = JSON.parse(readFileSync(join(repoRoot, "agent-skill", "intent-routes.json"), "utf8")) as Catalog;

async function publicCommands() {
  const stdout: string[] = [];
  const program = createProgram({
    stdout: (text) => stdout.push(text),
    stderr: () => undefined
  });
  await program.parseAsync(["node", "apexcn", "commands", "--json"]);
  return JSON.parse(stdout.join("")).commands as Array<{
    path: string;
    safety: { effects: string[]; preview: "required" | "available" | "none" };
  }>;
}

describe("v1.1.0 agent intent routes", () => {
  test("is versioned and covers novice prompts across at least twelve categories", () => {
    const examples = catalog.routes.flatMap((route) => route.examples);

    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.release).toBe("1.1.0");
    expect(new Set(catalog.routes.map((route) => route.id)).size).toBe(catalog.routes.length);
    expect(new Set(catalog.routes.map((route) => route.category)).size).toBeGreaterThanOrEqual(12);
    expect(examples.length).toBeGreaterThanOrEqual(25);
    expect(new Set(examples).size).toBe(examples.length);
  });

  test("maps every route step and preflight to an existing public command", async () => {
    const manifest = await publicCommands();
    const commandPaths = new Set(manifest.map((command) => command.path));
    const referenced = catalog.routes.flatMap((route) => [...route.commands, ...route.preflightCommands]);

    expect(referenced.filter((path) => !commandPaths.has(path))).toEqual([]);
  });

  test("routes administrator operations monitoring through capability-aware readonly preflight", () => {
    expect(catalog.routes).toContainEqual(expect.objectContaining({
      id: "monitor-cli-operations",
      category: "admin-operations",
      network: "remote-read",
      commands: ["auth audit", "me capabilities", "admin operations"],
      preflightCommands: ["auth audit", "me capabilities"],
      requiresPreview: false,
      requiresConfirmation: false,
      examples: expect.arrayContaining([
        "查看最近七天 apexcn-cli 调用量和失败情况",
        "按用户查看 CLI 调用异常和搜索关键词"
      ])
    }));
  });

  test("keeps local drafting and review paths free of auth and API preflight", () => {
    const localRoutes = catalog.routes.filter((route) => route.network === "local");

    expect(catalog.policy.localTasksRequireAuthPreflight).toBe(false);
    expect(localRoutes.length).toBeGreaterThan(0);
    expect(localRoutes.every((route) => route.preflightCommands.length === 0)).toBe(true);
    expect(localRoutes.flatMap((route) => route.commands).some((path) => path.startsWith("auth ") || path.startsWith("me "))).toBe(false);
  });

  test("requires preview and explicit confirmation for every community mutation route", async () => {
    const manifest = await publicCommands();
    const commandByPath = new Map(manifest.map((command) => [command.path, command]));
    const writeRoutes = catalog.routes.filter((route) => route.network === "remote-write");

    expect(catalog.policy.communityMutationsRequirePreview).toBe(true);
    expect(catalog.policy.previewedMutationsRequireExplicitConfirmation).toBe(true);
    expect(writeRoutes.length).toBeGreaterThan(0);

    for (const route of writeRoutes) {
      const mutation = commandByPath.get(route.mutationCommand ?? "");
      expect(route.requiresPreview, route.id).toBe(true);
      expect(route.requiresConfirmation, route.id).toBe(true);
      expect(route.commands.at(-1), route.id).toBe("confirm");
      expect(mutation?.safety.effects, route.id).toContain("api-write");
      expect(mutation?.safety.preview, route.id).not.toBe("none");
    }
  });

  test("documents the catalog and intent-specific preflight policy in the shipped skill", () => {
    const skill = readFileSync(join(repoRoot, "agent-skill", "SKILL.md"), "utf8");

    expect(skill).toContain("intent-routes.json");
    expect(skill).toContain("Intent Router");
    expect(skill).toContain("Local-only routes");
    expect(skill).toContain("Remote read routes");
    expect(skill).toContain("Remote write routes");
  });
});
