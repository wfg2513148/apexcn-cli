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

    expect(output.join("")).toBe("0.10.0\n");
  });

  test("prints a machine-readable command manifest", async () => {
    const output: string[] = [];
    const program = createProgram({
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "commands", "--json"]);

    const manifest = JSON.parse(output.join(""));
    expect(manifest.version).toBe("0.10.0");
    expect(manifest.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "topic create",
        aliases: expect.arrayContaining(["thread create"]),
        options: expect.arrayContaining(["--json", "--dry-run", "--preview"])
      }),
      expect.objectContaining({
        path: "topic update",
        aliases: expect.arrayContaining(["topic edit", "thread update", "thread edit"]),
        options: expect.arrayContaining(["--content <text>", "--content-file <path>"])
      }),
      expect.objectContaining({
        path: "ask",
        aliases: [],
        options: expect.not.arrayContaining(["--preview", "--dry-run"])
      }),
      expect.objectContaining({
        path: "search",
        options: expect.not.arrayContaining(["--offset <n>"])
      }),
      expect.objectContaining({
        path: "commands",
        options: expect.arrayContaining(["--json"])
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
      expect.objectContaining({ path: "search", description: "search community topics" }),
      expect.objectContaining({ path: "topic create", description: "create a community topic" }),
      expect.objectContaining({ path: "reply delete", description: "delete a reply after explicit confirmation" })
    ]));
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
