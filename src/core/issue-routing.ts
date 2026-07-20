export type IssueRoutingInput = {
  layer: "cli" | "server" | "cross_repo" | "test_environment" | "external";
  serverContractMismatch?: boolean;
};

export type IssueRoutingResult = {
  owner: "cli" | "server" | "cross_repo" | "test_environment" | "external";
  route: "apexcn-cli" | "apexcn-forums" | "both-repositories" | "validator-environment" | "external-dependency";
};

export function routeIssue(input: IssueRoutingInput): IssueRoutingResult {
  if (input.layer === "external") {
    return { owner: "external", route: "external-dependency" };
  }
  if (input.layer === "test_environment") {
    return { owner: "test_environment", route: "validator-environment" };
  }
  if (input.layer === "cross_repo" || (input.layer === "cli" && input.serverContractMismatch === true)) {
    return { owner: "cross_repo", route: "both-repositories" };
  }
  if (input.layer === "server") {
    return { owner: "server", route: "apexcn-forums" };
  }
  return { owner: "cli", route: "apexcn-cli" };
}
