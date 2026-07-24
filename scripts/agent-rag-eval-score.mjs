const ALLOWED_ENDPOINTS = new Set([
  "/api/v1/search",
  "/api/v1/topics/{topicId}"
]);

export function scoreAgentRagCase(testCase, run) {
  const value = run.value ?? {};
  const evidence = Array.isArray(value.evidence) ? value.evidence : [];
  const sources = Array.isArray(value.provenance?.sources) ? value.provenance.sources : [];
  const expectedTopics = new Set(testCase.expectedTopicIds.map(String));
  const expectedReplies = new Set((testCase.expectedCorrectAnswerReplyIds ?? []).map(String));
  const returnedTopics = new Set(evidence.map((item) => item?.topicId).filter(Boolean).map(String));
  const returnedCorrectReplies = new Set(
    evidence
      .filter((item) => item?.type === "correct-answer")
      .map((item) => item?.replyId)
      .filter(Boolean)
      .map(String)
  );
  const evidenceIds = evidence.map((item) => item?.evidenceId);
  const evidenceIdSet = new Set(evidenceIds);
  const expectedTopicEvidence = evidence.filter((item) => expectedTopics.has(String(item?.topicId)));
  const endpoints = Array.isArray(value.provenance?.endpoints) ? value.provenance.endpoints : [];
  const endpointIsolation = value.provenance?.appRagEndpointCalled === false
    && endpoints.every((endpoint) => ALLOWED_ENDPOINTS.has(endpoint));
  const originalUrlsComplete = testCase.originalUrlRequired !== true
    || expectedTopicEvidence.some((item) => item?.type === "topic" && validUrl(item?.originalUrl));
  const citationIntegrity = run.ok
    && evidenceIds.length === evidenceIdSet.size
    && evidenceIds.every((id) => typeof id === "string" && /^S\d+$/.test(id))
    && evidence.every((item) => validUrl(item?.communityUrl))
    && sources.every((source) => evidenceIdSet.has(source?.evidenceId) && validUrl(source?.communityUrl))
    && originalUrlsComplete
    && endpointIsolation;

  return {
    id: testCase.id,
    ok: run.ok,
    durationMs: run.durationMs,
    expectedTopicIds: [...expectedTopics],
    returnedTopicIds: [...returnedTopics],
    expectedTopicHit: expectedTopics.size === 0
      ? undefined
      : [...expectedTopics].some((id) => returnedTopics.has(id)),
    expectedCorrectAnswerReplyIds: [...expectedReplies],
    returnedCorrectAnswerReplyIds: [...returnedCorrectReplies],
    correctAnswerHit: expectedReplies.size === 0
      ? undefined
      : [...expectedReplies].some((id) => returnedCorrectReplies.has(id)),
    expectedAnswerability: testCase.expectedAnswerability,
    actualAnswerability: value.answerability?.status,
    answerabilityCorrect: testCase.expectedAnswerability === undefined
      ? true
      : value.answerability?.status === testCase.expectedAnswerability,
    evidenceCount: evidence.length,
    citationIntegrity,
    endpointIsolation,
    requestIds: Array.isArray(value.provenance?.requestIds) ? value.provenance.requestIds : [],
    error: run.error
  };
}

export function summarizeAgentRagRuns(runs) {
  const retrieval = runs.filter((item) => item.expectedTopicHit !== undefined);
  const correctAnswers = runs.filter((item) => item.correctAnswerHit !== undefined);
  const unanswerable = runs.filter((item) => item.expectedAnswerability === "unanswerable");
  return {
    caseCount: runs.length,
    retrievalCaseCount: retrieval.length,
    correctAnswerCaseCount: correctAnswers.length,
    unanswerableCaseCount: unanswerable.length,
    top5ExpectedTopicRecall: percent(retrieval.filter((item) => item.expectedTopicHit).length, retrieval.length),
    correctAnswerEvidenceHitRate: percent(correctAnswers.filter((item) => item.correctAnswerHit).length, correctAnswers.length),
    citationIntegrityRate: percent(runs.filter((item) => item.citationIntegrity).length, runs.length),
    unanswerableCorrectBehaviorRate: percent(unanswerable.filter((item) => item.answerabilityCorrect).length, unanswerable.length),
    forbiddenAppRagEndpointCalls: runs.filter((item) => !item.endpointIsolation).length
  };
}

function percent(numerator, denominator) {
  return denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(2));
}

function validUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
