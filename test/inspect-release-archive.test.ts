import { describe, expect, test } from "vitest";
import { parseReleaseArchiveListing } from "../scripts/inspect-release-archive.mjs";

describe("release archive listing", () => {
  const paths = ["package/node_modules/commander/LICENSE", "package/dist/index.js"];
  const types = ["-rw-r--r-- 0 0 1 commander/LICENSE", "-rw-r--r-- 0 0 1 dist/index.js"];

  test.each(["\n", "\r\n"])("accepts valid paths with %j line endings", (ending) => {
    expect([...parseReleaseArchiveListing(`${paths.join(ending)}${ending}`, `${types.join(ending)}${ending}`)]).toEqual(paths);
  });

  test("still rejects a carriage return in a filename", () => {
    expect(() => parseReleaseArchiveListing(`${paths[0]}\r\r\n`, `${types[0]}\r\n`)).toThrow(/noncanonical/);
  });

  test("rejects duplicate paths, aliases, and links with CRLF output", () => {
    expect(() => parseReleaseArchiveListing(`${paths[0]}\r\n${paths[0]}\r\n`, `${types[0]}\r\n${types[0]}\r\n`)).toThrow(/duplicate/);
    expect(() => parseReleaseArchiveListing("package/./dist/index.js\r\n", `${types[1]}\r\n`)).toThrow(/noncanonical/);
    expect(() => parseReleaseArchiveListing("package/link\r\n", "lrwxrwxrwx 0 0 0 package/link -> dist/index.js\r\n")).toThrow(/unsupported/);
  });
});
