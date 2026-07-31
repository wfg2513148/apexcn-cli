import { AsyncLocalStorage } from "node:async_hooks";

type CliRequestContext = {
  operation?: string;
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
