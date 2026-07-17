export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
}

export function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
}

export function assertNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number`);
  }
}

export function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

export function assertReadProvenance(value: Record<string, unknown>, expectedKind?: string): void {
  assertString(value.kind, "kind");
  if (expectedKind !== undefined && value.kind !== expectedKind) {
    throw new Error(`kind must be ${expectedKind}`);
  }
  if (value.schemaVersion !== 1) {
    throw new Error("schemaVersion must be 1");
  }
  assertRecord(value.provenance, "provenance");
  assertArray(value.provenance.requestIds, "provenance.requestIds");
  for (const [index, requestId] of value.provenance.requestIds.entries()) {
    assertString(requestId, `provenance.requestIds[${index}]`);
  }
  assertArray(value.provenance.sources, "provenance.sources");
  for (const [index, source] of value.provenance.sources.entries()) {
    assertRecord(source, `provenance.sources[${index}]`);
    if (source.url !== undefined) {
      assertString(source.url, `provenance.sources[${index}].url`);
    }
  }
}
