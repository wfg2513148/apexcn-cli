export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const asciiTerms = normalized.match(/[a-z0-9_]+/g) ?? [];
  const cjkTerms = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  const cjkBigrams = cjkTerms.flatMap((term) => {
    const chars = [...term];
    return chars.length <= 2 ? [term] : chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
  });
  return [...asciiTerms, ...cjkTerms, ...cjkBigrams].filter((term) => term.length >= 2);
}

export function termFrequency(tokens: string[]): Record<string, number> {
  const terms: Record<string, number> = {};
  for (const term of tokens) {
    terms[term] = (terms[term] ?? 0) + 1;
  }
  return terms;
}
