import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");

function execNpm(args: string[]): string {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe"
    });
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe"
  });
}

function preparePackage(dir: string, checksum?: string): NodeJS.ProcessEnv {
  const version = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }).version;
  execNpm(["pack", "--pack-destination", dir]);
  const archive = join(dir, "apexcn-cli.tgz");
  cpSync(join(dir, `apexcn-cli-${version}.tgz`), archive);
  const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const checksums = join(dir, "checksums.txt");
  writeFileSync(checksums, `${checksum ?? actual}  apexcn-cli.tgz\n`);
  return {
    ...process.env,
    HOME: join(dir, "home"),
    APEXCN_CLI_PACKAGE_URL: `file://${archive}`,
    APEXCN_CLI_CHECKSUMS_URL: `file://${checksums}`,
    APEXCN_CLI_INSTALL_ROOT: join(dir, "install"),
    APEXCN_CLI_BIN_DIR: join(dir, "bin")
  };
}

describe("install-agent checksum verification", () => {
  test("shell installer accepts a matching package", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-install-checksum-ok-"));
    const result = spawnSync("bash", ["scripts/install-agent.sh"], {
      cwd: repoRoot,
      env: preparePackage(dir),
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Verified package checksum.");
  }, 30_000);

  test("shell installer fails when checksums.txt is unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-install-checksum-missing-"));
    const env = preparePackage(dir);
    env.APEXCN_CLI_CHECKSUMS_URL = `file://${join(dir, "missing-checksums.txt")}`;
    const result = spawnSync("bash", ["scripts/install-agent.sh"], {
      cwd: repoRoot,
      env,
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unable to download checksums.txt");
  }, 30_000);

  test("shell installer rejects a checksum mismatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-install-checksum-bad-"));
    const result = spawnSync("bash", ["scripts/install-agent.sh"], {
      cwd: repoRoot,
      env: preparePackage(dir, "0".repeat(64)),
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Checksum verification failed");
  }, 30_000);

  test("PowerShell installer enforces the same checksum policy", () => {
    const script = readFileSync(join(repoRoot, "scripts/install-agent.ps1"), "utf8");

    expect(script).toContain("checksums.txt");
    expect(script).toContain("Checksum verification failed");
    expect(script).not.toContain("SKIP_CHECKSUM");
  });
});
