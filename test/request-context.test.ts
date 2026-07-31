import { describe, expect, test } from "vitest";
import { currentCliOperation, runWithCliRequestContext } from "../src/core/request-context.js";

describe("CLI request context", () => {
  test("scopes the canonical operation to one asynchronous command", async () => {
    expect(currentCliOperation()).toBeUndefined();

    await runWithCliRequestContext("topic_view", async () => {
      expect(currentCliOperation()).toBe("topic_view");
      await Promise.resolve();
      expect(currentCliOperation()).toBe("topic_view");
    });

    expect(currentCliOperation()).toBeUndefined();
  });

  test("isolates concurrent command operations", async () => {
    const operations = await Promise.all([
      runWithCliRequestContext("search", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return currentCliOperation();
      }),
      runWithCliRequestContext("admin_operations", async () => currentCliOperation())
    ]);

    expect(operations).toEqual(["search", "admin_operations"]);
    expect(currentCliOperation()).toBeUndefined();
  });
});
