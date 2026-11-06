import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function runtimeManifest(packageRoot) {
  const files = [];
  function walk(relative) {
    const path = join(packageRoot, ...relative.split("/"));
    const info = lstatSync(path);
    if (info.isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(`${relative}/${name}`);
      return;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error(`unsupported runtime file type: ${relative}`);
    const bytes = readFileSync(path);
    files.push({ path: relative, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  for (const relative of ["package.json", "dist", "scripts", "node_modules"]) walk(relative);
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  for (const required of ["package.json", "dist/index.js", "scripts/lifecycle-agent.ps1", "scripts/lifecycle-agent.sh", "node_modules/commander/package.json", "node_modules/lossless-json/package.json"]) {
    if (!files.some((item) => item.path === required)) throw new Error(`missing runtime file: ${required}`);
  }
  return { kind: "apexcn-runtime-file-manifest", schemaVersion: 1, files };
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  if (!process.argv[2]) throw new Error("package root is required");
  process.stdout.write(`${JSON.stringify(runtimeManifest(resolve(process.argv[2])))}\n`);
}
