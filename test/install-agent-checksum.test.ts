import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");

describe("install-agent checksum verification", () => {
  test("shell installer rejects a package when checksums.txt does not match", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-install-checksum-"));
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
    const tarball = `apexcn-cli-${packageJson.version}.tgz`;
    execFileSync("npm", ["pack", "--pack-destination", dir], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
    const tgzPath = join(dir, tarball);
    const actual = createHash("sha256").update(readFileSync(tgzPath)).digest("hex");
    const wrong = `${actual.slice(0, -1)}${actual.endsWith("0") ? "1" : "0"}`;
    writeFileSync(join(dir, "checksums.txt"), `${wrong}  apexcn-cli.tgz\n`);
    cpSync(tgzPath, join(dir, "apexcn-cli.tgz"));

    const result = spawnSync("bash", [
      "scripts/install-agent.sh",
      "--package-url", `file://${join(dir, "apexcn-cli.tgz")}`,
      "--install-root", join(dir, "install"),
      "--bin-dir", join(dir, "bin"),
      "--yes"
    ], {
      cwd: repoRoot,
      env: { ...process.env, APEXCN_CLI_CHECKSUMS_URL: `file://${join(dir, "checksums.txt")}` },
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Checksum verification failed");
  }, 30000);
});
