import { describe, expect, test } from "vitest";
import {
  scoreAgentRagCase,
  summarizeAgentRagRuns
} from "../scripts/agent-rag-eval-score.mjs";

describe("agent RAG live evaluation scorer", () => {
  test("scores expected topics, correct answers, URLs, and endpoint isolation", () => {
    const scored = scoreAgentRagCase({
      id: "case-1",
      expectedTopicIds: [42],
      expectedCorrectAnswerReplyIds: [90],
      originalUrlRequired: true
    }, {
      ok: true,
      durationMs: 12,
      value: {
        answerability: { status: "answerable" },
        evidence: [
          {
            evidenceId: "S1",
            type: "topic",
            topicId: 42,
            communityUrl: "https://oracleapex.cn/topic/42",
            originalUrl: "https://example.com/article"
          },
          {
            evidenceId: "S2",
            type: "correct-answer",
            topicId: 42,
            replyId: 90,
            communityUrl: "https://oracleapex.cn/topic/42#post_90"
          }
        ],
        provenance: {
          appRagEndpointCalled: false,
          endpoints: ["/api/v1/search", "/api/v1/topics/{topicId}"],
          sources: [
            { evidenceId: "S1", communityUrl: "https://oracleapex.cn/topic/42" },
            { evidenceId: "S2", communityUrl: "https://oracleapex.cn/topic/42#post_90" }
          ],
          requestIds: ["req-1", "req-2"]
        }
      }
    });

    expect(scored).toEqual(expect.objectContaining({
      expectedTopicHit: true,
      correctAnswerHit: true,
      citationIntegrity: true,
      endpointIsolation: true
    }));
    expect(summarizeAgentRagRuns([scored])).toEqual(expect.objectContaining({
      top5ExpectedTopicRecall: 100,
      correctAnswerEvidenceHitRate: 100,
      citationIntegrityRate: 100,
      forbiddenAppRagEndpointCalls: 0
    }));
  });

  test("rejects unknown citations and an App 100 RAG endpoint", () => {
    const scored = scoreAgentRagCase({
      id: "case-2",
      expectedTopicIds: [],
      expectedAnswerability: "unanswerable",
      originalUrlRequired: false
    }, {
      ok: true,
      durationMs: 5,
      value: {
        answerability: { status: "unanswerable" },
        evidence: [],
        provenance: {
          appRagEndpointCalled: true,
          endpoints: ["/api/v1/ask"],
          sources: [{ evidenceId: "S9", communityUrl: "https://oracleapex.cn/topic/9" }]
        }
      }
    });

    expect(scored.answerabilityCorrect).toBe(true);
    expect(scored.endpointIsolation).toBe(false);
    expect(scored.citationIntegrity).toBe(false);
  });
});
