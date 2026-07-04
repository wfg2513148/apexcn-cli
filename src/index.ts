#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import { createAuthCommand, type CommandIo } from "./commands/auth.js";
import { createDoctorCommand } from "./commands/doctor.js";
import {
  createAskCommand,
  createCategoryCommand,
  createRelationCommand,
  createReplyCommand,
  createResearchCommand,
  createSearchCommand,
  createTopicCommand
} from "./commands/content.js";
import { createDraftCommand } from "./commands/draft.js";
import { createMeCommand } from "./commands/me.js";
import { createReviewCommand } from "./commands/review.js";
import { createWorkflowCommand } from "./commands/workflow.js";
import { CLI_VERSION } from "./version.js";

export type CreateProgramOptions = Partial<CommandIo> & {
  configPath?: string;
  readStdin?: () => Promise<string>;
  isStdinTTY?: () => boolean;
};

export function createProgram(options: CreateProgramOptions = {}): Command {
  const io: CommandIo = {
    stdout: options.stdout ?? ((text) => process.stdout.write(text)),
    stderr: options.stderr ?? ((text) => process.stderr.write(text))
  };

  const program = new Command();
  let activeCliConfigPath: string | undefined;
  program.name("apexcn");
  program.version(CLI_VERSION);
  program.option("--config <path>", "config file path", parseConfigPath);
  const commandOptions = {
    stdout: io.stdout,
    stderr: io.stderr,
    readStdin: options.readStdin,
    isStdinTTY: options.isStdinTTY,
    get configPath() {
      return resolveConfigPath(activeCliConfigPath, options.configPath);
    }
  };
  program.addCommand(createAuthCommand(commandOptions));
  program.addCommand(createDoctorCommand(commandOptions));
  program.addCommand(createDraftCommand(commandOptions));
  program.addCommand(createMeCommand(commandOptions));
  program.addCommand(createReviewCommand(commandOptions));
  program.addCommand(createWorkflowCommand(commandOptions));
  program.addCommand(createCategoryCommand(commandOptions));
  program.addCommand(createSearchCommand(commandOptions));
  program.addCommand(createResearchCommand(commandOptions));
  program.addCommand(createTopicCommand(commandOptions));
  program.addCommand(createReplyCommand(commandOptions));
  program.addCommand(createRelationCommand("favorite", commandOptions));
  program.addCommand(createRelationCommand("subscription", commandOptions));
  program.addCommand(createAskCommand(commandOptions));
  program.addCommand(createCommandsCommand(program, io));
  configureCommandOutput(program, io);
  const parseAsync = program.parseAsync.bind(program);
  program.parseAsync = async (argv, parseOptions) => {
    activeCliConfigPath = configPathFromArgv(argv, parseOptions);
    try {
      return await parseAsync(argv, parseOptions);
    } finally {
      activeCliConfigPath = undefined;
      program.setOptionValue("config", undefined);
    }
  };
  return program;
}

type CommandManifest = {
  schemaVersion: number;
  version: string;
  schema: {
    safetyEffects: SafetyEffect[];
    previewPolicies: PreviewPolicy[];
    exampleModes: ExampleMode[];
  };
  commands: Array<{
    path: string;
    aliases: string[];
    description: string;
    options: string[];
    safety: CommandSafety;
    examples: CommandExample[];
  }>;
};

const SAFETY_EFFECTS = ["read", "api-write", "destructive", "config-read", "config-write", "auth", "secret", "diagnostic", "manifest"] as const;
const PREVIEW_POLICIES = ["required", "available", "none"] as const;
const EXAMPLE_MODES = ["read", "preview", "execute"] as const;

type SafetyEffect = typeof SAFETY_EFFECTS[number];
type PreviewPolicy = typeof PREVIEW_POLICIES[number];
type ExampleMode = typeof EXAMPLE_MODES[number];

type CommandSafety = {
  effects: SafetyEffect[];
  preview: PreviewPolicy;
  confirmation: string[];
};

type CommandExample = {
  command: string;
  mode: ExampleMode;
  note?: string;
};

type CommandGuidance = {
  safety: CommandSafety;
  examples: CommandExample[];
};

function createCommandsCommand(root: Command, io: CommandIo): Command {
  return new Command("commands")
    .description("print a machine-readable command manifest")
    .option("--json", "pretty-print JSON")
    .action((options: { json?: boolean }) => {
      const manifest = commandManifest(root);
      if (options.json) {
        io.stdout(`${JSON.stringify(manifest, null, 2)}\n`);
        return;
      }
      io.stdout(manifest.commands.map((command) => {
        const optionsText = command.options.length > 0 ? `\t${command.options.join(" ")}` : "";
        return `${command.path}${optionsText}`;
      }).join("\n") + "\n");
    });
}

function commandManifest(root: Command): CommandManifest {
  return {
    schemaVersion: 1,
    version: CLI_VERSION,
    schema: {
      safetyEffects: [...SAFETY_EFFECTS],
      previewPolicies: [...PREVIEW_POLICIES],
      exampleModes: [...EXAMPLE_MODES]
    },
    commands: root.commands.flatMap((child) => leafCommands(child)).map((item) => {
      const path = item.path.join(" ");
      const guidance = manifestGuidance(path);
      return {
        path,
        aliases: aliasPaths(item.path, item.aliases).map((aliasPath) => aliasPath.join(" ")),
        description: manifestDescription(path, item.command.description()),
        options: item.command.options.filter((option) => !option.hidden).map((option) => option.flags),
        safety: guidance.safety,
        examples: guidance.examples
      };
    }).sort((left, right) => left.path.localeCompare(right.path))
  };
}

const COMMAND_DESCRIPTIONS: Record<string, string> = {
  "ask": "answer a question using APEX Chinese Community content",
  "auth list": "list configured auth profiles",
  "auth logout": "clear the active auth profile",
  "auth remove": "remove an auth profile",
  "auth set-token": "save an API token profile",
  "auth show": "show the active auth profile with a redacted token",
  "auth use": "switch the active auth profile",
  "category list": "list community categories",
  "commands": "print a machine-readable command manifest",
  "doctor": "check installation, auth, and API reachability",
  "draft question": "draft a local community question from structured inputs and research links",
  "draft reply": "draft a local community reply from structured inputs and references",
  "favorite add": "favorite a community topic",
  "favorite remove": "remove a topic from favorites",
  "me": "show the authenticated community account",
  "reply create": "create a reply on a topic",
  "reply delete": "delete a reply after explicit confirmation",
  "reply update": "update an existing reply",
  "research": "build a research bundle from search results and topic content",
  "review topic": "review a local topic draft before API preview or publish",
  "search": "search community topics",
  "subscription add": "subscribe to a community topic",
  "subscription remove": "unsubscribe from a community topic",
  "topic create": "create a community topic",
  "topic delete": "delete a topic after explicit confirmation",
  "topic update": "update an existing topic",
  "topic view": "view a community topic",
  "workflow approve": "approve a workflow preview for audited execution",
  "workflow plan": "plan a local, reviewable APEX Chinese Community workflow",
  "workflow run": "run a stateful APEX Chinese Community workflow with resumable local artifacts",
  "workflow verify": "verify workflow artifacts and produce local audit evidence"
};

const COMMAND_GUIDANCE: Record<string, CommandGuidance> = {
  "ask": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: 'apexcn ask "Oracle APEX 如何调用 REST API？" --top-k 3 --json', mode: "read" }]
  },
  "auth list": {
    safety: { effects: ["config-read"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn auth list --json", mode: "read" }]
  },
  "auth logout": {
    safety: { effects: ["config-write", "auth"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn auth logout", mode: "execute" }]
  },
  "auth remove": {
    safety: { effects: ["config-write", "auth"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn auth remove old-profile", mode: "execute" }]
  },
  "auth set-token": {
    safety: { effects: ["config-write", "auth", "secret"], preview: "none", confirmation: [] },
    examples: [{ command: 'apexcn auth set-token --profile agent-prod --base-url https://oracleapex.cn/ords/api --token "$APEXCN_API_KEY"', mode: "execute" }]
  },
  "auth show": {
    safety: { effects: ["config-read"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn auth show --json", mode: "read" }]
  },
  "auth use": {
    safety: { effects: ["config-write", "auth"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn auth use agent-prod", mode: "execute" }]
  },
  "category list": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn category list --json", mode: "read" }]
  },
  "commands": {
    safety: { effects: ["manifest"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn commands --json", mode: "read" }]
  },
  "doctor": {
    safety: { effects: ["diagnostic"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn doctor --json", mode: "read" }]
  },
  "draft question": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: 'apexcn draft question --title "标题" --problem "问题描述" --research-file ./research.json --format text', mode: "read" }]
  },
  "draft reply": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: 'apexcn draft reply --topic-id 30549 --answer "回复建议" --format text', mode: "read" }]
  },
  "favorite add": {
    safety: { effects: ["api-write"], preview: "available", confirmation: [] },
    examples: [
      { command: "apexcn favorite add 30549 --preview", mode: "preview" },
      { command: "apexcn favorite add 30549 --json", mode: "execute" }
    ]
  },
  "favorite remove": {
    safety: { effects: ["api-write"], preview: "available", confirmation: [] },
    examples: [
      { command: "apexcn favorite remove 30549 --preview", mode: "preview" },
      { command: "apexcn favorite remove 30549 --json", mode: "execute" }
    ]
  },
  "me": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn me --json", mode: "read" }]
  },
  "reply create": {
    safety: { effects: ["api-write"], preview: "available", confirmation: [] },
    examples: [
      { command: 'apexcn reply create 30549 --content "回复内容" --preview', mode: "preview" },
      { command: "apexcn reply create 30549 --content-file ./reply.md --json", mode: "execute" }
    ]
  },
  "reply delete": {
    safety: { effects: ["api-write", "destructive"], preview: "required", confirmation: ["--yes", "--force"] },
    examples: [
      { command: "apexcn reply delete 67890 --yes --force --preview", mode: "preview" },
      { command: "apexcn reply delete 67890 --yes --force --json", mode: "execute" }
    ]
  },
  "reply update": {
    safety: { effects: ["api-write"], preview: "available", confirmation: [] },
    examples: [
      "apexcn reply update 67890 --content-file ./updated-reply.md --preview",
      "apexcn reply update 67890 --content-file ./updated-reply.md --json"
    ].map((command, index) => ({ command, mode: index === 0 ? "preview" as const : "execute" as const }))
  },
  "research": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: 'apexcn research "REST API" --limit 3 --json', mode: "read" }]
  },
  "review topic": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: 'apexcn review topic --title "标题" --content-file ./question.md --category-id 4 --json', mode: "read" }]
  },
  "search": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: 'apexcn search "REST API" --page-size 5 --json', mode: "read" }]
  },
  "subscription add": {
    safety: { effects: ["api-write"], preview: "available", confirmation: [] },
    examples: [
      { command: "apexcn subscription add 30549 --preview", mode: "preview" },
      { command: "apexcn subscription add 30549 --json", mode: "execute" }
    ]
  },
  "subscription remove": {
    safety: { effects: ["api-write"], preview: "available", confirmation: [] },
    examples: [
      { command: "apexcn subscription remove 30549 --preview", mode: "preview" },
      { command: "apexcn subscription remove 30549 --json", mode: "execute" }
    ]
  },
  "topic create": {
    safety: { effects: ["api-write"], preview: "available", confirmation: [] },
    examples: [
      { command: 'apexcn topic create --category-id 4 --title "标题" --content-file ./post.md --preview', mode: "preview" },
      { command: 'apexcn topic create --category-id 4 --title "标题" --content-file ./post.md --json', mode: "execute" }
    ]
  },
  "topic delete": {
    safety: { effects: ["api-write", "destructive"], preview: "required", confirmation: ["--yes", "--force", "--confirm-title"] },
    examples: [
      { command: 'apexcn topic delete 30549 --yes --force --confirm-title "精确标题" --preview', mode: "preview" },
      { command: 'apexcn topic delete 30549 --yes --force --confirm-title "精确标题" --json', mode: "execute" }
    ]
  },
  "topic update": {
    safety: { effects: ["api-write"], preview: "available", confirmation: [] },
    examples: [
      { command: "apexcn topic update 30549 --content-file ./updated-post.md --preview", mode: "preview" },
      { command: "apexcn topic update 30549 --content-file ./updated-post.md --json", mode: "execute" }
    ]
  },
  "topic view": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn topic view 30549 --json", mode: "read" }]
  },
  "workflow plan": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: 'apexcn workflow plan --goal ask-question --keyword "REST API" --title "标题" --problem "问题描述" --category-id 4 --json', mode: "read" }]
  },
  "workflow approve": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn workflow approve --run-dir ./run --approved-by reviewer --note \"preview reviewed\" --json", mode: "read" }]
  },
  "workflow run": {
    safety: { effects: ["read", "api-write"], preview: "required", confirmation: ["--execute", "--yes"] },
    examples: [
      { command: 'apexcn workflow run --goal ask-question --keyword "REST API" --title "标题" --problem "问题描述" --category-id 4 --output-dir ./run --json', mode: "preview", note: "writes local artifacts and the final API request preview only" },
      { command: "apexcn workflow run --resume ./run --execute --yes --json", mode: "execute", note: "executes only the final reviewed API write" }
    ]
  },
  "workflow verify": {
    safety: { effects: ["read"], preview: "none", confirmation: [] },
    examples: [{ command: "apexcn workflow verify --run-dir ./run --write-report --json", mode: "read" }]
  }
};

function manifestDescription(path: string, fallback: string): string {
  return COMMAND_DESCRIPTIONS[path] ?? fallback;
}

function manifestGuidance(path: string): CommandGuidance {
  const guidance = COMMAND_GUIDANCE[path];
  if (!guidance) {
    throw new Error(`Missing command manifest guidance for ${path}`);
  }
  return guidance;
}

function leafCommands(command: Command, path: string[] = [], aliases: string[][] = []): Array<{ command: Command; path: string[]; aliases: string[][] }> {
  const nextPath = [...path, command.name()];
  const nextAliases = [...aliases, command.aliases()];
  if (command.commands.length === 0) {
    return [{ command, path: nextPath, aliases: nextAliases }];
  }
  return command.commands.flatMap((child) => leafCommands(child, nextPath, nextAliases));
}

function aliasPaths(path: string[], aliases: string[][]): string[][] {
  const results: string[][] = [[]];
  path.forEach((part, index) => {
    const alternatives = [part, ...(aliases[index] ?? [])];
    const next: string[][] = [];
    for (const result of results) {
      for (const alternative of alternatives) {
        next.push([...result, alternative]);
      }
    }
    results.splice(0, results.length, ...next);
  });
  const canonical = path.join(" ");
  return results.filter((result) => result.join(" ") !== canonical);
}

function parseConfigPath(value: string): string {
  if (value.trim().length === 0) {
    throw new InvalidArgumentError("Config path must not be blank");
  }
  return value;
}

function configPathFromArgv(argv: readonly string[] | undefined, parseOptions: Parameters<Command["parseAsync"]>[1]): string | undefined {
  const values = argv ?? process.argv;
  const startIndex = parseOptions?.from === "user" ? 0 : 2;
  for (let index = startIndex; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--config") {
      return values[index + 1];
    }
    if (value.startsWith("--config=")) {
      return value.slice("--config=".length);
    }
  }
  return undefined;
}

function resolveConfigPath(cliConfigPath: string | undefined, injectedConfigPath?: string): string | undefined {
  if (cliConfigPath !== undefined) {
    return cliConfigPath;
  }
  if (process.env.APEXCN_CONFIG_PATH && process.env.APEXCN_CONFIG_PATH.trim().length > 0) {
    return process.env.APEXCN_CONFIG_PATH;
  }
  return injectedConfigPath;
}

function configureCommandOutput(command: Command, io: CommandIo): void {
  command.configureOutput({
    writeOut: io.stdout,
    writeErr: io.stderr
  });
  for (const child of command.commands) {
    configureCommandOutput(child, io);
  }
}

export function isCliEntrypoint(moduleUrl: string, argvScriptPath: string | undefined): boolean {
  if (!argvScriptPath) {
    return false;
  }

  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync(modulePath) === realpathSync(argvScriptPath);
  } catch {
    return modulePath === argvScriptPath;
  }
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  await createProgram().parseAsync(process.argv);
}
