import { AsyncLocalStorage } from "node:async_hooks";
import type { ContentLanguage } from "./content-language.js";

type CliRequestContext = {
  operation?: string;
  language?: ContentLanguage;
};

const cliRequestContext = new AsyncLocalStorage<CliRequestContext>();

export function runWithCliRequestContext<T>(operation: string | undefined, action: () => T): T {
  return cliRequestContext.run({ operation }, action);
}

export function setCurrentCliOperation(operation: string): void {
  const context = cliRequestContext.getStore();
  if (!context) {
    throw new Error("CLI request context is not active");
  }
  context.operation = operation;
}

export function currentCliOperation(): string | undefined {
  return cliRequestContext.getStore()?.operation;
}

export function setCurrentContentLanguage(language: ContentLanguage | undefined): void {
  const context = cliRequestContext.getStore();
  if (!context) {
    throw new Error("CLI request context is not active");
  }
  context.language = language;
}

export function currentContentLanguage(): ContentLanguage | undefined {
  return cliRequestContext.getStore()?.language;
}
