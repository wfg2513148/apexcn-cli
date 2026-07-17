#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultOutput = "reports/iteration-context.json";
const requiredAssets = [
  "apexcn-cli.tgz",
  "install-agent.sh",
  "install-agent.ps1",
  "checksums.txt",
  "apexcn-cli.tgz.sha256",
  "install-agent.sh.sha256",
  "install-agent.ps1.sha256"
];
const summaryArrayFields = [
  "enhancedCapabilities",
  "unexpectedProblems",
  "rootCauses",
  "preventionActions",
  "expectedResults",
  "majorRisks"
];

export function validateIterationSummary(summary) {
  const problems = [];
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return ["summary must be a JSON object"];
  }
  if (summary.milestoneId !== null && typeof summary.milestoneId !== "string") {
    problems.push("milestoneId must be a string or null");
  }
  for (const field of summaryArrayFields) {
    if (!Array.isArray(summary[field]) || summary[field].length === 0) {
      problems.push(`${field} must be a non-empty string array`);
      continue;
    }
    if (summary[field].some((value) => typeof value !== "string" || value.trim().length === 0)) {
      problems.push(`${field} must contain non-empty strings`);
    }
  }
  if (typeof summary.nextMilestoneGoal !== "string" || summary.nextMilestoneGoal.trim().length === 0) {
    problems.push("nextMilestoneGoal must be a non-empty string");
  }
  return problems;
}

export function createIterationContext({
  summary,
  packageJson,
  roadmap,
  issues,
  release,
  git,
  generatedAt = new Date().toISOString()
}) {
  const milestone = roadmap.milestones.find((entry) => entry.id === summary.milestoneId)
    ?? roadmap.milestones.find((entry) => entry.status !== "completed")
    ?? null;
  const activeIssues = issues.issues.map((issue) => ({
    id: issue.id,
    milestoneId: issue.milestoneId,
    priority: issue.priority,
    owner: issue.owner,
    status: issue.status,
    title: issue.title
  }));

  return redactSecrets({
    kind: "apexcn-iteration-context",
    schemaVersion: 1,
    generatedAt,
    release: {
      version: packageJson.version,
      tag: release.tag,
      url: release.url
    },
    repository: {
      branch: git.branch,
      commit: git.commit
    },
    milestone: {
      completedIterationFor: summary.milestoneId,
      resumeMilestoneId: milestone?.id ?? null,
      resumeMilestoneStatus: milestone?.status ?? null
    },
    enhancedCapabilities: summary.enhancedCapabilities,
    unexpectedProblems: summary.unexpectedProblems,
    rootCauses: summary.rootCauses,
    preventionActions: summary.preventionActions,
    nextMilestoneGoal: summary.nextMilestoneGoal,
    expectedResults: summary.expectedResults,
    majorRisks: summary.majorRisks,
    activeIssues,
    resume: {
      readOrder: [
        "reports/iteration-context.json",
        "roadmap.json",
        "issues.json"
      ],
      instructions: [
        "Re-read current repository state before planning.",
        "Create only a just-in-time plan for the active milestone.",
        "Do not start the next milestone without explicit user confirmation."
      ]
    }
  });
}

export function serializeIterationContext(context, maxBytes) {
  const output = `${JSON.stringify(context, null, 2)}\n`;
  const bytes = Buffer.byteLength(output);
  if (bytes > maxBytes) {
    throw new Error(`iteration context is ${bytes} bytes; maximum is ${maxBytes}`);
  }
  return output;
}

export function redactSecrets(value) {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? "[REDACTED]" : redactSecrets(entry)
    ]));
  }
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(APEXCN_API_KEY|api[_-]?key|token|password|passwd|secret|cookie|set-cookie)\b(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]");
}

function isSensitiveKey(key) {
  return /^(authorization|apexcn_api_key|api[_-]?key|apiKey|token|password|passwd|secret|cookie|set-cookie)$/i.test(key);
}

function parseArgs(values) {
  const args = { output: defaultOutput, offline: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--offline") {
      args.offline = true;
      continue;
    }
    if (["--summary", "--release-url", "--tag", "--output"].includes(value)) {
      args[value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = values[index + 1];
      index += 1;
      continue;
    }
    usage();
  }
  if (!args.summary || !args.releaseUrl) {
    usage();
  }
  return args;
}

function usage() {
  console.error(
    "Usage: node scripts/compact-iteration-context.mjs "
      + "--summary <file> --release-url <url> [--tag <tag>] [--output <file>] [--offline]"
  );
  process.exit(2);
}

function verifyReleaseClosure({ tag, releaseUrl, offline }) {
  const branch = run("git", ["branch", "--show-current"]).trim();
  const commit = run("git", ["rev-parse", "HEAD"]).trim();
  if (offline) {
    return {
      git: { branch, commit },
      release: { tag, url: releaseUrl }
    };
  }

  if (branch !== "main") {
    throw new Error(`release closure must run on main, got ${branch || "(detached)"}`);
  }
  if (run("git", ["status", "--porcelain"]).trim()) {
    throw new Error("release closure requires a clean worktree");
  }
  const divergence = run("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).trim();
  if (divergence !== "0\t0" && divergence !== "0 0") {
    throw new Error(`main is not synchronized with its upstream: ${divergence}`);
  }
  const tagCommit = run("git", ["rev-list", "-n", "1", tag]).trim();
  if (tagCommit !== commit) {
    throw new Error(`${tag} does not point to HEAD`);
  }

  const release = JSON.parse(run("gh", [
    "release",
    "view",
    tag,
    "--json",
    "tagName,isDraft,isPrerelease,url,assets"
  ]));
  if (release.tagName !== tag || release.isDraft || release.isPrerelease) {
    throw new Error(`${tag} is missing or is not a final GitHub Release`);
  }
  if (release.url !== releaseUrl) {
    throw new Error(`release URL mismatch: expected ${release.url}, got ${releaseUrl}`);
  }
  const assetNames = new Set((release.assets ?? []).map((asset) => asset.name));
  const missingAssets = requiredAssets.filter((asset) => !assetNames.has(asset));
  if (missingAssets.length > 0) {
    throw new Error(`GitHub Release is missing assets: ${missingAssets.join(", ")}`);
  }
  return {
    git: { branch, commit },
    release: { tag, url: release.url }
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function absolutePath(path) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const packageJson = readJson(join(repoRoot, "package.json"));
    const roadmap = readJson(join(repoRoot, "roadmap.json"));
    const issues = readJson(join(repoRoot, "issues.json"));
    const summary = readJson(absolutePath(args.summary));
    const problems = validateIterationSummary(summary);
    if (problems.length > 0) {
      throw new Error(problems.join("; "));
    }

    const tag = args.tag ?? `v${packageJson.version}`;
    if (tag !== `v${packageJson.version}`) {
      throw new Error(`tag ${tag} does not match package version ${packageJson.version}`);
    }
    const closure = verifyReleaseClosure({
      tag,
      releaseUrl: args.releaseUrl,
      offline: args.offline
    });
    const context = createIterationContext({
      summary,
      packageJson,
      roadmap,
      issues,
      release: closure.release,
      git: closure.git
    });
    const maxBytes = roadmap.executionProtocol.patchIterationClosure.contextCompaction.maxBytes;
    const output = serializeIterationContext(context, maxBytes);
    const outputPath = absolutePath(args.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, output);
    console.log(`Iteration context written to ${outputPath} (${Buffer.byteLength(output)} bytes)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
