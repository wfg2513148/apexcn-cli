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

export type CreateProgramOptions = Partial<CommandIo> & {
  configPath?: string;
  readStdin?: () => Promise<string>;
  isStdinTTY?: () => boolean;
};

export const CLI_VERSION = "0.1.6";

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
