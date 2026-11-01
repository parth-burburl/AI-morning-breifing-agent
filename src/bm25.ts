// BM25: the classic search-engine ranking formula. No model, no network, no cost.
//
// Idea in one breath: a document scores higher when it contains your keywords,
// but (1) a keyword that appears in almost every document counts for little
// (rare words are more telling), and (2) repeating a word ten times is not
// ten times better than saying it twice, and (3) long documents don't win
// just by being long.

// Very small "stemmer": makes "GPUs" match "gpu" and "chips" match "chip".
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 3 && word.endsWith("s") && !/(ss|is)$/.test(word) && !US_WORDS.has(word)) return word.slice(0, -1);
  return word;
}

// Real words that end in "us" and are NOT plurals. Everything else ending in "us" is
// treated as a plural, because "GPUs", "NPUs", "TPUs" and "CPUs" matter for this profile.
const US_WORDS = new Set(["status", "bonus", "campus", "corpus", "focus", "virus", "census", "genius", "radius", "versus", "nexus", "bus", "plus", "thus"]);

// "Cost per token, again!" -> ["cost", "per", "token", "again"]
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);
}

// How many times does this term (one word or a phrase) occur in the document?
export function countTerm(doc: string[], term: string[]): number {
  if (term.length === 0 || doc.length < term.length) return 0;
  let n = 0;
  outer: for (let i = 0; i <= doc.length - term.length; i++) {
    for (let j = 0; j < term.length; j++) if (doc[i + j] !== term[j]) continue outer;
    n++;
  }
  return n;
}

export type Bm25Result = {
  score: number;
  tf: number[]; // how often each term occurred in this document (0 = no match)
};

// Score every document against a list of terms. `docs` and `terms` are already tokenized.
export function bm25(docs: string[][], terms: string[][], k1 = 1.2, b = 0.75): Bm25Result[] {
  const N = docs.length;
  const avgdl = docs.reduce((sum, d) => sum + d.length, 0) / (N || 1);

  const tf = docs.map((d) => terms.map((t) => countTerm(d, t)));
  // df = in how many documents does each term appear at all?
  const df = terms.map((_, ti) => tf.reduce((c, row) => c + (row[ti] > 0 ? 1 : 0), 0));
  // idf = how telling is the term? Rare term -> high, in-every-document term -> near 0.
  const idf = df.map((n) => Math.log(1 + (N - n + 0.5) / (n + 0.5)));

  return docs.map((d, di) => {
    let score = 0;
    if (avgdl > 0) {
      const lengthNorm = k1 * (1 - b + (b * d.length) / avgdl);
      for (let ti = 0; ti < terms.length; ti++) {
        const f = tf[di][ti];
        if (f > 0) score += idf[ti] * ((f * (k1 + 1)) / (f + lengthNorm));
      }
    }
    return { score, tf: tf[di] };
  });
}
