import { describe, expect, test } from "vitest";
import { routeIssue, type IssueRoutingInput } from "../src/core/issue-routing.js";

const seeds: Array<{ id: string; input: IssueRoutingInput; expectedOwner: string; expectedRoute: string }> = [
  { id: "cli-json-schema", input: { layer: "cli" }, expectedOwner: "cli", expectedRoute: "apexcn-cli" },
  { id: "cli-help", input: { layer: "cli" }, expectedOwner: "cli", expectedRoute: "apexcn-cli" },
  { id: "cli-redaction", input: { layer: "cli" }, expectedOwner: "cli", expectedRoute: "apexcn-cli" },
  { id: "cli-installer", input: { layer: "cli" }, expectedOwner: "cli", expectedRoute: "apexcn-cli" },
  { id: "cli-policy", input: { layer: "cli" }, expectedOwner: "cli", expectedRoute: "apexcn-cli" },
  { id: "server-missing-endpoint", input: { layer: "server" }, expectedOwner: "server", expectedRoute: "apexcn-forums" },
  { id: "server-openapi-drift", input: { layer: "server" }, expectedOwner: "server", expectedRoute: "apexcn-forums" },
  { id: "server-auth", input: { layer: "server" }, expectedOwner: "server", expectedRoute: "apexcn-forums" },
  { id: "server-pagination", input: { layer: "server" }, expectedOwner: "server", expectedRoute: "apexcn-forums" },
  { id: "server-capability", input: { layer: "server" }, expectedOwner: "server", expectedRoute: "apexcn-forums" },
  { id: "cross-version", input: { layer: "cross_repo" }, expectedOwner: "cross_repo", expectedRoute: "both-repositories" },
  { id: "cross-payload", input: { layer: "cross_repo" }, expectedOwner: "cross_repo", expectedRoute: "both-repositories" },
  { id: "cli-observes-server-drift", input: { layer: "cli", serverContractMismatch: true }, expectedOwner: "cross_repo", expectedRoute: "both-repositories" },
  { id: "fixture-invalid", input: { layer: "test_environment" }, expectedOwner: "test_environment", expectedRoute: "validator-environment" },
  { id: "credential-missing", input: { layer: "test_environment" }, expectedOwner: "test_environment", expectedRoute: "validator-environment" },
  { id: "wrong-cwd", input: { layer: "test_environment" }, expectedOwner: "test_environment", expectedRoute: "validator-environment" },
  { id: "runner-windows", input: { layer: "external" }, expectedOwner: "external", expectedRoute: "external-dependency" },
  { id: "runner-linux", input: { layer: "external" }, expectedOwner: "external", expectedRoute: "external-dependency" },
  { id: "keychain-unavailable", input: { layer: "external" }, expectedOwner: "external", expectedRoute: "external-dependency" },
  { id: "network-outage", input: { layer: "external" }, expectedOwner: "external", expectedRoute: "external-dependency" }
];

describe("seeded issue ownership and routing matrix", () => {
  test("routes every CLI, server, cross-repository, test-environment, and external seed accurately", () => {
    const results = seeds.map((seed) => ({ id: seed.id, ...routeIssue(seed.input) }));
    const mismatches = results.filter((result, index) =>
      result.owner !== seeds[index].expectedOwner || result.route !== seeds[index].expectedRoute
    );

    expect(seeds).toHaveLength(20);
    expect(mismatches).toEqual([]);
  });
});
