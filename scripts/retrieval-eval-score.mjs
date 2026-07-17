const SEARCH_EVIDENCE_FIELDS = [
  "title",
  "topicTitle",
  "card_title",
  "snippet",
  "card_body",
  "content",
  "body",
  "excerpt",
  "summary",
  "tags",
  "categoryName",
  "matchedTerms",
  "matchEvidence"
];

export function searchEvidenceText(items) {
  return items
    .map((item) => SEARCH_EVIDENCE_FIELDS.map((field) => textValue(item?.[field])).join(" "))
    .join(" ")
    .toLowerCase();
}

export function expectedReferenceMatch(items, expectedTerms, minimumMatchedTerms) {
  const evidence = searchEvidenceText(items);
  const matchedTerms = expectedTerms.filter((term) => termMatchesEvidence(evidence, term));
  return {
    matchedTerms,
    hit: matchedTerms.length >= minimumMatchedTerms
  };
}

export function expectedTopicMatch(items, expectedTopicIds = []) {
  const actualIds = new Set(items.flatMap((item) => [
    item?.id,
    item?.topicId,
    item?.threadId,
    item?.doc_id
  ]).map(String));
  const matchedTopicIds = expectedTopicIds.filter((id) => actualIds.has(String(id)));
  return {
    matchedTopicIds,
    hit: expectedTopicIds.length > 0 && matchedTopicIds.length > 0
  };
}

export function p95Seconds(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
  return Number((sorted[index] / 1000).toFixed(3));
}

function textValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(textValue).join(" ");
  }
  return "";
}

function termMatchesEvidence(evidence, term) {
  const normalized = textValue(term).toLowerCase().replace(/_/g, " ").trim();
  if (!normalized) {
    return false;
  }
  if (evidence.includes(normalized)) {
    return true;
  }
  const tokens = normalized.match(/[a-z0-9]+|[\u3400-\u9fff]+/g) ?? [];
  return tokens.length > 1 && tokens.every((token) => evidence.includes(token));
}
