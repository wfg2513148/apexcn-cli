import { isRecord } from "../output.js";

export const SUPPORTED_API_CONTRACT_VERSIONS = [
  "0.8.3-candidate",
  "0.8.0-candidate",
  "0.7.0-candidate",
  "0.6.0-candidate"
] as const;

export type CapabilityCompatibilityResult = {
  ok: boolean;
  status: "compatible" | "unsupported" | "malformed" | "missing-capability";
  contractVersion?: string;
  supportedContractVersions: readonly string[];
  negotiationMode?: "versioned" | "legacy";
  missingCapabilities: string[];
  issues: Array<{ code: string; message: string }>;
};

export function assessCapabilityCompatibility(
  value: unknown,
  requiredCapabilities: string[] = []
): CapabilityCompatibilityResult {
  const issues: Array<{ code: string; message: string }> = [];
  if (!isRecord(value) || value.kind !== "capabilities") {
    return result(false, "malformed", undefined, requiredCapabilities, [
      { code: "invalid-capability-inventory", message: "Capability response must be a capabilities object." }
    ]);
  }
  const contractVersion = typeof value.contractVersion === "string" ? value.contractVersion : undefined;
  if (!contractVersion) {
    return result(false, "malformed", undefined, requiredCapabilities, [
      { code: "missing-contract-version", message: "Capability response does not declare contractVersion." }
    ]);
  }
  if (!SUPPORTED_API_CONTRACT_VERSIONS.includes(contractVersion as typeof SUPPORTED_API_CONTRACT_VERSIONS[number])) {
    return result(false, "unsupported", contractVersion, requiredCapabilities, [
      { code: "unsupported-contract-version", message: `API contract ${contractVersion} is outside the supported 0.8.3/0.8/0.7/0.6 window.` }
    ]);
  }
  if (typeof value.requestId !== "string" || value.requestId.trim().length === 0) {
    issues.push({ code: "missing-request-id", message: "Capability response does not include a usable requestId." });
  }
  if (!Array.isArray(value.capabilities)) {
    issues.push({ code: "invalid-capabilities", message: "Capability response must include a capabilities array." });
  }
  const capabilities = Array.isArray(value.capabilities) ? value.capabilities : [];
  for (const capability of capabilities) {
    if (!isRecord(capability)
        || typeof capability.id !== "string"
        || typeof capability.available !== "boolean"
        || (capability.available === true && !Array.isArray(capability.endpoints))
        || (capability.available === false && typeof capability.unavailableReason !== "string")) {
      issues.push({ code: "invalid-capability-entry", message: "Each capability needs id and available; available entries need endpoints and unavailable entries need unavailableReason." });
      break;
    }
  }
  const advertised = Array.isArray(value.supportedContractVersions)
    ? value.supportedContractVersions.filter((item): item is string => typeof item === "string")
    : [];
  if (contractVersion === SUPPORTED_API_CONTRACT_VERSIONS[0]) {
    const missingVersions = SUPPORTED_API_CONTRACT_VERSIONS.filter((version) => !advertised.includes(version));
    if (missingVersions.length > 0) {
      issues.push({ code: "incomplete-supported-version-window", message: `Current capability contract omits supported version(s): ${missingVersions.join(", ")}.` });
    }
  }
  const availableIds = new Set(capabilities.filter(isRecord).filter((item) => item.available === true).map((item) => String(item.id)));
  const missingCapabilities = [...new Set(requiredCapabilities)].filter((id) => !availableIds.has(id));
  if (missingCapabilities.length > 0) {
    issues.push({ code: "required-capability-unavailable", message: `Required capability unavailable: ${missingCapabilities.join(", ")}.` });
  }
  const malformed = issues.some((issue) => issue.code !== "required-capability-unavailable");
  return {
    ok: issues.length === 0,
    status: malformed ? "malformed" : missingCapabilities.length > 0 ? "missing-capability" : "compatible",
    contractVersion,
    supportedContractVersions: SUPPORTED_API_CONTRACT_VERSIONS,
    negotiationMode: advertised.length > 0 ? "versioned" : "legacy",
    missingCapabilities,
    issues
  };
}

function result(
  ok: boolean,
  status: CapabilityCompatibilityResult["status"],
  contractVersion: string | undefined,
  missingCapabilities: string[],
  issues: CapabilityCompatibilityResult["issues"]
): CapabilityCompatibilityResult {
  return {
    ok,
    status,
    contractVersion,
    supportedContractVersions: SUPPORTED_API_CONTRACT_VERSIONS,
    missingCapabilities,
    issues
  };
}
