#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const assetNames = ["apexcn-cli.tgz", "install-agent.sh", "install-agent.ps1"];
const dir = process.argv[2] ?? ".";
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

function assetPath(name) {
  const direct = join(dir, name);
  if (existsSync(direct)) {
    return direct;
  }
  if (name === "apexcn-cli.tgz") {
    const packed = join(dir, `apexcn-cli-${packageJson.version}.tgz`);
    if (existsSync(packed)) {
      return packed;
    }
  }
  const script = join(dir, "scripts", name);
  if (existsSync(script)) {
    return script;
  }
  return direct;
}

const rows = assetNames.map((name) => {
  const path = assetPath(name);
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { name, path, sha256 };
});

const text = rows.map((row) => `${row.sha256}  ${row.name}`).join("\n") + "\n";
writeFileSync(join(dir, "checksums.txt"), text);
for (const row of rows) {
  writeFileSync(join(dir, `${row.name}.sha256`), `${row.sha256}  ${row.name}\n`);
}

console.log(JSON.stringify({
  kind: "release-checksums",
  schemaVersion: 1,
  dir: basename(dir) || dir,
  assets: rows,
  files: ["checksums.txt", ...rows.map((row) => `${row.name}.sha256`)]
}, null, 2));
