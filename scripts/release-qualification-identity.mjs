export function releaseQualificationIdentityMatches(contract, version) {
  const match = /^1\.(\d+)\.(\d+)$/.exec(version);
  if (!match || !contract || contract.targetVersion !== version) return false;
  const minor = Number(match[1]);
  const patch = Number(match[2]);
  let taskCount;
  let additions;
  if (minor === 1 && patch < 6) {
    taskCount = 200;
    additions = ["admin.operations"];
  } else if (minor === 1 || minor === 2) {
    taskCount = 202;
    additions = ["admin.operations", "update"];
  } else if (minor === 3) {
    taskCount = 204;
    additions = ["admin.operations", "update", "admin.operations-v2"];
  } else {
    return false;
  }
  const actual = contract.approvedAdditions?.map((item) => item.commandId);
  return contract.current?.exactTaskCount === taskCount
    && Array.isArray(actual) && actual.length === additions.length
    && additions.every((id, index) => actual[index] === id);
}
