import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { CommandIo } from "./auth.js";

type UpdateOptions = CommandIo & {
  packageRoot?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

export function createUpdateCommand(options: UpdateOptions): Command {
  return new Command("update")
    .description("upgrade this installation from the official GitHub release, keeping a rollback backup")
    .allowExcessArguments(false)
    .action(async () => {
      try {
        const root = realpathSync(options.packageRoot ?? fileURLToPath(new URL("../../", import.meta.url)));
        const rootMarker = join(root, ".apexcn-install-root");
        const binMarker = join(root, ".apexcn-bin-dir");
        if (!existsSync(rootMarker) || !existsSync(binMarker)) {
          throw new Error("This copy is not managed by the official installer. Install from https://github.com/wfg2513148/apexcn-cli first, then run apexcn update.");
        }
        const installRoot = readFileSync(rootMarker, "utf8").trim();
        const binDir = readFileSync(binMarker, "utf8").trim();
        if (!isAbsolute(installRoot) || !isAbsolute(binDir) || ![installRoot, join(installRoot, "package"), join(installRoot, "cli")]
          .some((path) => existsSync(path) && realpathSync(path) === root)) {
          throw new Error("Invalid installation markers. Reinstall apexcn-cli with the official installer.");
        }
        const windows = (options.platform ?? process.platform) === "win32";
        const script = join(root, "scripts", windows ? "lifecycle-agent.ps1" : "lifecycle-agent.sh");
        if (!existsSync(script)) throw new Error("The upgrade script is missing. Reinstall apexcn-cli with the official installer.");
        options.stdout("Updating apexcn-cli from the official GitHub release. A rollback backup will be kept.\n");
        const code = await new Promise<number>((resolveCode, reject) => {
          const child = spawn(windows ? "powershell.exe" : "bash", windows
            ? ["-NoProfile", "-NonInteractive", "-File", script, "upgrade"]
            : [script, "upgrade"], {
            cwd: homedir(),
            env: { ...(options.env ?? process.env), APEXCN_CLI_INSTALL_ROOT: installRoot, APEXCN_CLI_BIN_DIR: binDir },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true
          });
          child.stdout.setEncoding("utf8").on("data", (data: string) => options.stdout(data));
          child.stderr.setEncoding("utf8").on("data", (data: string) => options.stderr(data));
          child.once("error", () => reject(new Error(`Unable to start ${windows ? "PowerShell" : "bash"} for the update.`)));
          child.once("close", (status) => resolveCode(status ?? 1));
        });
        if (code !== 0) process.exitCode = code;
      } catch (error) {
        options.stderr(`${error instanceof Error ? error.message : "Unable to update apexcn-cli."}\n`);
        process.exitCode = 1;
      }
    });
}
