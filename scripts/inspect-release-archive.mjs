import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

export function inspectReleaseArchive(archivePath) {
  const entries = new Set();
  const list = execFileSync("tar", ["-tzPf", archivePath], { encoding: "utf8" });
  for (const raw of list.split("\n").filter(Boolean)) {
    const entry = raw.replace(/^(?:\.\/)+/, "");
    if (raw !== raw.trim() || /[\\:\x00-\x1f\x7f]/.test(entry) || !entry.startsWith("package/")
      || entry.split("/").includes("..") || posix.normalize(entry) !== entry) {
      throw new Error(`release package contains noncanonical path ${entry}`);
    }
    if (entries.has(entry)) throw new Error(`release package contains duplicate path ${entry}`);
    entries.add(entry);
  }
  const types = execFileSync("tar", ["-tvzPf", archivePath], { encoding: "utf8" }).split("\n").filter(Boolean);
  if (types.some((line) => line[0] !== "-" && line[0] !== "d")) {
    throw new Error("release package contains unsupported entry type");
  }
  return entries;
}

export function readArchiveJson(archivePath, entry) {
  return JSON.parse(execFileSync("tar", ["-xOzf", archivePath, entry], { encoding: "utf8" }));
}

export function runtimeImportEntry(metadata) {
  const condition = metadata.exports?.["."]?.import;
  const entry = typeof condition === "string" ? condition : condition?.default ?? metadata.module ?? metadata.main;
  if (typeof entry !== "string") return undefined;
  const normalized = entry.replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /[\\:\x00-\x1f\x7f]/.test(normalized)
    || normalized.split("/").includes("..") || posix.normalize(normalized) !== normalized) return undefined;
  return normalized;
}

export function verifyRuntimeDependencies(entries, archivePath, packageManifest, installedRoot) {
  const localManifest = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
  const ordered = (value) => JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  if (ordered(packageManifest.dependencies ?? {}) !== ordered(localManifest.dependencies ?? {})) {
    throw new Error("release package runtime dependencies differ from the source manifest");
  }
  for (const name of Object.keys(packageManifest.dependencies ?? {})) {
    if (!/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name)) throw new Error(`invalid bundled dependency name ${name}`);
    const prefix = `package/node_modules/${name}/`;
    const metadataPath = `${prefix}package.json`;
    if (!entries.has(metadataPath)) throw new Error(`bundled dependency ${name} missing package metadata`);
    const packagedMetadata = readArchiveJson(archivePath, metadataPath);
    const localRoot = join(installedRoot, "node_modules", name);
    const installedMetadata = JSON.parse(readFileSync(join(localRoot, "package.json"), "utf8"));
    if (packagedMetadata.name !== name || installedMetadata.name !== name || !installedMetadata.version
      || packagedMetadata.version !== installedMetadata.version) {
      throw new Error(`bundled dependency ${name} version differs from the installed version`);
    }
    const importEntry = runtimeImportEntry(packagedMetadata);
    if (!importEntry || !entries.has(`${prefix}${importEntry}`)) throw new Error(`bundled dependency ${name} missing runtime entry`);
    const expected = new Map();
    const walk = (dir, relative = "") => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path, child);
        else if (entry.isFile()) expected.set(`${prefix}${child}`, path);
        else throw new Error(`bundled dependency ${name} contains an unsupported file type`);
      }
    };
    walk(localRoot);
    for (const [entry, path] of expected) {
      if (!entries.has(entry)) throw new Error(`bundled dependency ${name} missing ${entry.slice(prefix.length)}`);
      const packaged = execFileSync("tar", ["-xOzf", archivePath, entry], { maxBuffer: 20 * 1024 * 1024 });
      if (!packaged.equals(readFileSync(path))) throw new Error(`bundled dependency ${name} differs from installed source at ${entry.slice(prefix.length)}`);
    }
    for (const entry of entries) {
      if (entry.startsWith(prefix) && !entry.endsWith("/") && !expected.has(entry)) {
        throw new Error(`bundled dependency ${name} contains unexpected ${entry.slice(prefix.length)}`);
      }
    }
  }
}
