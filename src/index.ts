#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { createAuthCommand, type CommandIo } from "./commands/auth.js";
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
};

export function createProgram(options: CreateProgramOptions = {}): Command {
  const io: CommandIo = {
    stdout: options.stdout ?? ((text) => process.stdout.write(text)),
    stderr: options.stderr ?? ((text) => process.stderr.write(text))
  };

  const program = new Command();
  program.name("apexcn");
  program.addCommand(createAuthCommand({ ...io, configPath: options.configPath }));
  program.addCommand(createMeCommand({ ...io, configPath: options.configPath }));
  program.addCommand(createCategoryCommand({ ...io, configPath: options.configPath }));
  program.addCommand(createSearchCommand({ ...io, configPath: options.configPath }));
  program.addCommand(createTopicCommand({ ...io, configPath: options.configPath }));
  program.addCommand(createReplyCommand({ ...io, configPath: options.configPath }));
  program.addCommand(createRelationCommand("favorite", { ...io, configPath: options.configPath }));
  program.addCommand(createRelationCommand("subscription", { ...io, configPath: options.configPath }));
  program.addCommand(createAskCommand({ ...io, configPath: options.configPath }));
  return program;
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
