import { isSafeNumber, LosslessNumber, parse, stringify } from "lossless-json";

export function parsePreciseJson(text: string): unknown {
  return parse(text, undefined, {
    parseNumber: (value: string) => isSafeNumber(value, { approx: false }) ? Number(value) : new LosslessNumber(value)
  });
}

export function stringifyPreciseJson(value: unknown, pretty: boolean): string {
  const output = stringify(value, undefined, pretty ? 2 : undefined);
  if (output === undefined) throw new Error("Unable to serialize JSON response.");
  return output;
}
