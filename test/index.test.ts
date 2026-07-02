import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { createProgram, isCliEntrypoint } from "../src/index.js";

describe("CLI entrypoint detection", () => {
  test("prints the package version", async () => {
    const output: string[] = [];
    const program = createProgram({
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });
    program.exitOverride();

    await expect(program.parseAsync(["node", "apexcn", "--version"])).rejects.toMatchObject({ code: "commander.version" });

    expect(output.join("")).toBe("0.2.0\n");
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
