import { redactSecretText } from "./secret-redaction.js";

/** Remove URL components that can contain credentials before displaying diagnostics. */
export function sanitizeUrlForDisplay(value: string): string {
  try {
    if (value.trim() !== value) return "[invalid URL]";
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "[invalid URL]";
    const segments = url.pathname.split("/");
    const sensitiveSegment = segments.findIndex(pathSegmentMayContainCredentials);
    if (sensitiveSegment !== -1) {
      return `${url.origin}${segments.slice(0, sensitiveSegment).join("/")}/[redacted]`;
    }
    if (url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash
        && /^https?:\/\/[a-z0-9.:[\]-]+$/i.test(value)) {
      return value;
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return redactSecretText(url.toString());
  } catch {
    return "[invalid URL]";
  }
}

function pathSegmentMayContainCredentials(segment: string): boolean {
  const decoded = decodePercentForDetection(segment);
  return decoded.includes("=") || decoded.includes("%")
    || /^(?:api[_-]?key|token|password|passwd|secret|authorization|cookie)$/i.test(decoded)
    || /(?:api[_-]?key|token|password|passwd|secret|authorization|cookie)\s*:/i.test(decoded)
    || /\bbearer\s+\S+/i.test(decoded);
}

function decodePercentForDetection(value: string): string {
  let decoded = value;
  for (let i = 0; i < 8; i += 1) {
    const next = decoded.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

/** Fail closed on an embedded URL whose textual boundaries may be ambiguous. */
export function sanitizeUrlsInText(value: string): string {
  const start = embeddedUrlStart(value);
  if (start !== -1) return `${value.slice(0, start)}[redacted URL]`;
  return embeddedUrlStart(decodePercentForDetection(value)) !== -1 ? "[redacted URL]" : value;
}

function embeddedUrlStart(value: string): number {
  const absolute = value.search(/https?(?::|%3a)/i);
  const at = value.lastIndexOf("@");
  const relative = at === -1 ? -1 : value.slice(0, at).search(/[\\/]{2}/);
  if (absolute === -1) return relative;
  return relative === -1 ? absolute : Math.min(absolute, relative);
}

export function sanitizeUrlsInValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeUrlsInText(value);
  if (Array.isArray(value)) return value.map(sanitizeUrlsInValue);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = Object.create(null);
    const nextSuffix = new Map<string, number>();
    for (const [key, nested] of Object.entries(value)) {
      const safeKey = redactSecretText(sanitizeUrlsInText(key));
      let uniqueKey = safeKey;
      let suffix = nextSuffix.get(safeKey) ?? 2;
      while (Object.prototype.hasOwnProperty.call(result, uniqueKey)) uniqueKey = `${safeKey}#${suffix++}`;
      nextSuffix.set(safeKey, suffix);
      result[uniqueKey] = sanitizeUrlsInValue(nested);
    }
    return result;
  }
  return value;
}
