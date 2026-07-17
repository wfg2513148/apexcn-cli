export function parseNpmPackResult(output) {
  const parsed = JSON.parse(output);
  const entry = Array.isArray(parsed)
    ? parsed[0]
    : parsed && typeof parsed === "object"
      ? Object.values(parsed)[0]
      : undefined;

  if (!entry || typeof entry !== "object") {
    throw new Error("npm pack --json returned no package metadata");
  }
  return entry;
}
