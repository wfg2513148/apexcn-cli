import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

test("frozen text bytes survive checkout with core.autocrlf=true", () => {
  const root = mkdtempSync(join(tmpdir(), "apexcn-git-eol-"));
  const original = '{\n  "frozen": true\n}\n';
  const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "core.autocrlf=true", ...args], { stdio: "pipe" });
  try {
    git("init");
    writeFileSync(join(root, ".gitattributes"), readFileSync(join(__dirname, "..", ".gitattributes")));
    writeFileSync(join(root, "frozen.json"), original);
    git("add", ".");
    git("checkout-index", "--force", "--all");
    expect(readFileSync(join(root, "frozen.json"), "utf8")).toBe(original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
