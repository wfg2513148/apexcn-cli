const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /(Authorization\s*:\s*Bearer\s+)[^\s"'`]+/gi, replacement: "$1[redacted]" },
  { pattern: /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g, replacement: "$1[redacted]" },
  { pattern: /((?:api[_-]?key|apiKey|token|password|passwd|secret)\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,}\]]+)/gi, replacement: "$1[redacted]" },
  { pattern: /((?:Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi, replacement: "$1[redacted]" }
];

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecretText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      isSecretKey(key) ? "[redacted]" : redactSecrets(nested)
    ]));
  }
  return value;
}

export function redactSecretText(text: string): string {
  return SECRET_PATTERNS.reduce((current, item) => current.replace(item.pattern, item.replacement), text);
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.includes("authorization")
    || normalized.includes("apikey")
    || normalized.includes("token")
    || normalized.includes("password")
    || normalized.includes("passwd")
    || normalized.includes("secret")
    || normalized.includes("cookie");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
