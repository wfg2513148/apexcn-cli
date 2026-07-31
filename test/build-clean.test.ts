import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cleanDist } from "../scripts/clean-dist.mjs";

describe("build output", () => {
  test("removes stale compiled modules before TypeScript emits", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-clean-dist-"));
    const staleFile = join(root, "dist/mcp/stale.js");
    mkdirSync(join(root, "dist/mcp"), { recursive: true });
    writeFileSync(staleFile, "export {};\n");

    cleanDist(root);

    expect(existsSync(staleFile)).toBe(false);
    expect(existsSync(join(root, "dist"))).toBe(false);
  });
});
