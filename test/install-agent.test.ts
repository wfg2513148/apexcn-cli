import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");
const posixTest = process.platform === "win32" ? test.skip : test;

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function execNpm(args: string[]): string {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: repoRoot,
      encoding: "utf8"
    });
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function preparePackage(root: string): { archive: string; checksums: string } {
  const version = (JSON.parse(readRepoFile("package.json")) as { version: string }).version;
  execNpm(["pack", "--pack-destination", root]);
  const archive = join(root, "apexcn-cli.tgz");
  cpSync(join(root, `apexcn-cli-${version}.tgz`), archive);
  const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const checksums = join(root, "checksums.txt");
  writeFileSync(checksums, `${digest}  apexcn-cli.tgz\n`);
  return { archive, checksums };
}

function installEnvironment(
  root: string,
  packagePaths: { archive: string; checksums: string },
  extra: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const home = join(root, "home");
  const bin = join(root, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    APEXCN_CLI_PACKAGE_URL: `file://${packagePaths.archive}`,
    APEXCN_CLI_CHECKSUMS_URL: `file://${packagePaths.checksums}`,
    APEXCN_CLI_INSTALL_ROOT: join(root, "install"),
    APEXCN_CLI_BIN_DIR: bin,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    ...extra
  };
}

function defaultInstallEnvironment(
  root: string,
  packagePaths: { archive: string; checksums: string },
  extra: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    APEXCN_CLI_PACKAGE_URL: `file://${packagePaths.archive}`,
    APEXCN_CLI_CHECKSUMS_URL: `file://${packagePaths.checksums}`,
    ...extra
  };
}

describe("zero-argument one-click installers", () => {
  test("shell installer keeps a minimal public surface and mandatory checksum verification", () => {
    const script = readRepoFile("scripts/install-agent.sh");

    expect(script.split("\n").length).toBeLessThanOrEqual(180);
    expect(script).toContain('[[ "$#" -eq 0 ]]');
    expect(script).toContain("takes no arguments");
    expect(script).toContain("checksums.txt");
    expect(script).toContain("Checksum verification failed");
    expect(script).toContain("Verified package checksum");
    expect(script).toContain("releases/latest/download/apexcn-cli.tgz");
    expect(script).not.toContain("APEXCN_API_KEY");
    for (const option of [
      "--yes",
      "--dry-run",
      "--source-dir",
      "--package-url",
      "--repo",
      "--ref",
      "--install-root",
      "--bin-dir",
      "--install-agent-skills"
    ]) {
      expect(script).not.toContain(option);
    }
  });

  test("PowerShell installer keeps the same zero-argument security contract", () => {
    const script = readRepoFile("scripts/install-agent.ps1");

    expect(script.split("\n").length).toBeLessThanOrEqual(180);
    expect(script).toContain("$args.Count");
    expect(script).toContain("takes no arguments");
    expect(script).toContain("checksums.txt");
    expect(script).toContain("Checksum verification failed");
    expect(script).toContain("Verified package checksum");
    expect(script).toContain("releases/latest/download/apexcn-cli.tgz");
    expect(script).toContain("$UsingDefaultPaths");
    expect(script).toContain("if ($UsingDefaultPaths -and $Resolved");
    expect(script).not.toContain("APEXCN_API_KEY");
    expect(script).not.toContain("param(");
    expect(script).not.toContain("[switch]");
  });

  posixTest("shell installer installs the release package and skills without consuming auth", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-zero-install-"));
    const packagePaths = preparePackage(root);
    const env = installEnvironment(root, packagePaths, {
      APEXCN_API_KEY: "must-not-be-consumed"
    });

    try {
      const result = spawnSync("bash", ["scripts/install-agent.sh"], {
        cwd: repoRoot,
        env,
        encoding: "utf8"
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Verified package checksum");
      expect(result.stdout).toContain("Authentication is configured after installation");
      expect(result.stdout).not.toContain("Configuring apexcn auth");
      expect(execFileSync(join(root, "bin", "apexcn"), ["--version"], {
        env,
        encoding: "utf8"
      })).toBe("1.0.2\n");
      expect(existsSync(join(root, "home", ".apexcn", "config.json"))).toBe(false);
      expect(existsSync(join(root, "home", ".agents", "skills", "apexcn-cli", "SKILL.md"))).toBe(true);
      expect(existsSync(join(root, "home", ".codex", "skills", "apexcn-cli", "SKILL.md"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  posixTest("shell installer rejects every command-line argument", () => {
    const result = spawnSync("bash", ["scripts/install-agent.sh", "--yes"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("takes no arguments");
  });

  posixTest("shell installer fails closed on a checksum mismatch", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-zero-checksum-"));
    const packagePaths = preparePackage(root);
    writeFileSync(packagePaths.checksums, `${"0".repeat(64)}  apexcn-cli.tgz\n`);

    try {
      const result = spawnSync("bash", ["scripts/install-agent.sh"], {
        cwd: repoRoot,
        env: installEnvironment(root, packagePaths),
        encoding: "utf8"
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Checksum verification failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  posixTest("shell installer replaces a working older apexcn-cli launcher", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-zero-shadow-"));
    const packagePaths = preparePackage(root);
    const shadowBin = join(root, "shadow-bin");
    const shadow = join(shadowBin, "apexcn");
    mkdirSync(shadowBin);
    writeFileSync(shadow, `#!/usr/bin/env bash
# apexcn-cli launcher for dist/index.js
[[ "\${1:-}" == "--help" ]] && { printf 'topic|thread\\n'; exit 0; }
[[ "\${1:-}" == "--version" ]] && { printf '0.18.8\\n'; exit 0; }
exit 0
`);
    chmodSync(shadow, 0o755);
    const env = defaultInstallEnvironment(root, packagePaths, {
      PATH: `${shadowBin}${delimiter}${process.env.PATH ?? ""}`
    });

    try {
      const result = spawnSync("bash", ["scripts/install-agent.sh"], {
        cwd: repoRoot,
        env,
        encoding: "utf8"
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Updated shell-resolved launcher");
      expect(execFileSync(shadow, ["--version"], { env, encoding: "utf8" })).toBe("1.0.2\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  posixTest("shell installer with custom paths never rewrites an external PATH launcher", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-zero-contained-"));
    const packagePaths = preparePackage(root);
    const externalBin = join(root, "external-bin");
    const externalLauncher = join(externalBin, "apexcn");
    const originalLauncher = `#!/usr/bin/env bash
# external apexcn-cli launcher for dist/index.js
printf 'external launcher\\n'
`;
    mkdirSync(externalBin);
    writeFileSync(externalLauncher, originalLauncher);
    chmodSync(externalLauncher, 0o755);
    const env = installEnvironment(root, packagePaths, {
      PATH: `${externalBin}${delimiter}${process.env.PATH ?? ""}`
    });

    try {
      const result = spawnSync("bash", ["scripts/install-agent.sh"], {
        cwd: repoRoot,
        env,
        encoding: "utf8"
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain("Updated shell-resolved launcher");
      expect(readFileSync(externalLauncher, "utf8")).toBe(originalLauncher);
      expect(execFileSync(join(root, "bin", "apexcn"), ["--version"], { env, encoding: "utf8" }))
        .toBe("1.0.2\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("PowerShell installer can install the same package when pwsh is available", () => {
    const pwsh = process.env.PWSH_BIN ?? "pwsh";
    if (spawnSync(pwsh, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]).status !== 0) {
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "apexcn-zero-pwsh-"));
    const packagePaths = preparePackage(root);
    const env = {
      ...installEnvironment(root, packagePaths),
      USERPROFILE: join(root, "home"),
      LOCALAPPDATA: join(root, "local")
    };

    try {
      const result = spawnSync(pwsh, [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(repoRoot, "scripts/install-agent.ps1")
      ], { cwd: repoRoot, env, encoding: "utf8" });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Verified package checksum");
      expect(execFileSync(process.execPath, [
        join(root, "install", "package", "dist", "index.js"),
        "--version"
      ], { env, encoding: "utf8" })).toBe("1.0.2\n");
      expect(existsSync(join(root, "home", ".apexcn", "config.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("primary docs expose the zero-argument commands and separate authentication", () => {
    for (const path of ["README.md"]) {
      const doc = readRepoFile(path);
      expect(doc).toContain("bash -o pipefail -c 'curl -fsSL https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.sh | bash'");
      expect(doc).toContain('irm "https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.ps1" | iex');
      expect(doc).toContain("安装命令不接收 API key");
      expect(doc).not.toContain("APEXCN_CLI_INSTALL_AGENT_SKILLS");
      expect(doc).not.toContain("APEXCN_CLI_YES");
      expect(doc).not.toContain("bash -s --");
    }
  });

  test("bundled skill keeps installation and authentication separate", () => {
    const skill = readRepoFile("agent-skill/SKILL.md");

    expect(skill).toContain("Never pass an API key");
    expect(skill).toContain("--token-env APEXCN_API_KEY");
    expect(skill).toContain("apexcn auth audit --json");
    expect(skill).toContain("Do not output the full API key");
  });
});
