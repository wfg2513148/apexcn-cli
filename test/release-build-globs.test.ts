import { createRequire } from "node:module";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const picomatch = require("picomatch");
const posix = require("picomatch/posix");

test("discovers nested test files with standard and Windows path separators", () => {
  const pattern = "test/**/*.test.ts";
  expect(picomatch.isMatch("test/support/example.test.ts", pattern)).toBe(true);
  expect(picomatch.isMatch("test\\support\\example.test.ts", pattern, { windows: true })).toBe(true);
  expect(picomatch.isMatch("src/support/example.test.ts", pattern)).toBe(false);
  expect(picomatch.isMatch("test/support/example.ts", pattern)).toBe(false);
});

test("prevents the build tooling from enabling extglob matching", () => {
  const pattern = "example+(x).test.ts";
  const options = { noext: false, noextglob: false };
  for (const matcher of [picomatch, posix]) {
    expect(matcher(pattern, options)("examplexx.test.ts")).toBe(false);
    expect(matcher.makeRe(pattern, options).test("examplexx.test.ts")).toBe(false);
  }
});
