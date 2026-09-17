import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createUpdateCommand } from "../src/commands/update.js";
import { createProgram } from "../src/index.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  process.exitCode = undefined;
});

function setup(managed = true, body = 'printf "operation=%s\\nroot=%s\\nbin=%s\\n" "$1" "$APEXCN_CLI_INSTALL_ROOT" "$APEXCN_CLI_BIN_DIR"') {
  const root = mkdtempSync(join(tmpdir(), "apexcn-update-"));
  roots.push(root);
  const packageRoot = join(root, "install", "package");
  mkdirSync(join(packageRoot, "scripts"), { recursive: true });
  if (managed) {
    writeFileSync(join(packageRoot, ".apexcn-install-root"), join(root, "install"));
    writeFileSync(join(packageRoot, ".apexcn-bin-dir"), join(root, "bin"));
  }
  writeFileSync(join(packageRoot, "scripts", "lifecycle-agent.sh"), body);
  let stdout = "";
  let stderr = "";
  const command = createUpdateCommand({
    packageRoot,
    platform: "darwin",
    env: { ...process.env, APEXCN_CLI_INSTALL_ROOT: "/must-not-update", APEXCN_CLI_BIN_DIR: "/must-not-replace" },
    stdout: (value) => { stdout += value; },
    stderr: (value) => { stderr += value; }
  });
  return { root, packageRoot, command, output: () => ({ stdout, stderr }) };
}

describe("update", () => {
  test("is discoverable as a high-risk release download without authentication", async () => {
    let output = "";
    await createProgram({ stdout: (text) => { output += text; }, stderr: () => {} }).parseAsync(["commands", "--json"], { from: "user" });
    const update = JSON.parse(output).commands.find((item: { id: string }) => item.id === "update");
    expect(update).toMatchObject({ path: "update", authRequired: false, apiEffect: "release-download", riskLevel: "high", supportsJson: false });
    expect(update.examples[0].command).toBe("apexcn update");
  });

  test("refuses an unmanaged checkout without starting the upgrade", async () => {
    const fixture = setup(false);
    await fixture.command.parseAsync([], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(fixture.output().stderr).toContain("not managed by the official installer");
    expect(fixture.output().stdout).toBe("");
  });

  test("rejects markers pointing at another installation", async () => {
    const fixture = setup();
    writeFileSync(join(fixture.packageRoot, ".apexcn-install-root"), tmpdir());
    await fixture.command.parseAsync([], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(fixture.output().stderr).toContain("Invalid installation markers");
  });

  (process.platform === "win32" ? test.skip : test)("uses the current managed paths and needs no API key", async () => {
    const fixture = setup();
    await fixture.command.parseAsync([], { from: "user" });
    expect(process.exitCode).toBeUndefined();
    expect(fixture.output().stdout).toContain("operation=upgrade");
    expect(fixture.output().stdout).toContain(`root=${join(fixture.root, "install")}`);
    expect(fixture.output().stdout).not.toContain("must-not-update");
  });

  (process.platform === "win32" ? test.skip : test)("propagates upgrade failure without a Node stack", async () => {
    const fixture = setup(true, 'printf "Upgrade failed; restored backup\\n" >&2; exit 7');
    await fixture.command.parseAsync([], { from: "user" });
    expect(process.exitCode).toBe(7);
    expect(fixture.output().stderr).toBe("Upgrade failed; restored backup\n");
  });
});
