export type Bm25Document = {
  id: string;
  terms: Record<string, number>;
  length: number;
};

export type Bm25Score = {
  id: string;
  score: number;
  contributions: Record<string, number>;
};

export function scoreBm25(queryTerms: string[], documents: Bm25Document[], options: { k1?: number; b?: number } = {}): Bm25Score[] {
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const totalDocuments = documents.length;
  const averageLength = totalDocuments === 0 ? 0 : documents.reduce((sum, doc) => sum + doc.length, 0) / totalDocuments;
  const uniqueTerms = [...new Set(queryTerms)];
  const documentFrequency = new Map<string, number>();
  for (const term of uniqueTerms) {
    documentFrequency.set(term, documents.filter((doc) => doc.terms[term] !== undefined).length);
  }

  return documents.map((doc) => {
    const contributions: Record<string, number> = {};
    let score = 0;
    for (const term of uniqueTerms) {
      const frequency = doc.terms[term] ?? 0;
      if (frequency === 0) {
        continue;
      }
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (totalDocuments - df + 0.5) / (df + 0.5));
      const denominator = frequency + k1 * (1 - b + b * (doc.length / Math.max(averageLength, 1)));
      const contribution = idf * ((frequency * (k1 + 1)) / denominator);
      contributions[term] = Number(contribution.toFixed(6));
      score += contribution;
    }
    return { id: doc.id, score: Number(score.toFixed(6)), contributions };
  });
}
