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
  createSearchCommand,
  createTopicCommand
} from "./commands/content.js";
import { createMeCommand } from "./commands/me.js";
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
  program.addCommand(createMeCommand(commandOptions));
  program.addCommand(createCategoryCommand(commandOptions));
  program.addCommand(createSearchCommand(commandOptions));
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
  version: string;
  commands: Array<{
    path: string;
    aliases: string[];
    description: string;
    options: string[];
  }>;
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
    version: CLI_VERSION,
    commands: root.commands.flatMap((child) => leafCommands(child)).map((item) => ({
      path: item.path.join(" "),
      aliases: aliasPaths(item.path, item.aliases).map((path) => path.join(" ")),
      description: manifestDescription(item.path.join(" "), item.command.description()),
      options: item.command.options.filter((option) => !option.hidden).map((option) => option.flags)
    })).sort((left, right) => left.path.localeCompare(right.path))
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
  "favorite add": "favorite a community topic",
  "favorite remove": "remove a topic from favorites",
  "me": "show the authenticated community account",
  "reply create": "create a reply on a topic",
  "reply delete": "delete a reply after explicit confirmation",
  "reply update": "update an existing reply",
  "search": "search community topics",
  "subscription add": "subscribe to a community topic",
  "subscription remove": "unsubscribe from a community topic",
  "topic create": "create a community topic",
  "topic delete": "delete a topic after explicit confirmation",
  "topic update": "update an existing topic",
  "topic view": "view a community topic"
};

function manifestDescription(path: string, fallback: string): string {
  return COMMAND_DESCRIPTIONS[path] ?? fallback;
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
