import type { AggregatedAnswer, ExpertAnswer, EvidenceCitation } from "./contracts";

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Aggregates only explicit expert outputs; it never invents consensus or evidence. */
export function aggregateExpertAnswers(answers: readonly ExpertAnswer[]): AggregatedAnswer {
  if (answers.length === 0) throw new Error("moe_aggregation_requires_answers");
  const ordered = [...answers].sort(
    (a, b) => b.confidence - a.confidence || a.expertId.localeCompare(b.expertId),
  );
  const selected = ordered[0];
  const disagreement = ordered.some((answer) => answer.text.trim() !== selected.text.trim());
  const evidence = deduplicateEvidence(ordered.flatMap((answer) => answer.evidence ?? []));
  const confidence = clamp(
    ordered.reduce((sum, answer) => sum + clamp(answer.confidence), 0) / ordered.length -
      (disagreement ? 0.15 : 0),
  );
  return { text: selected.text, confidence, disagreement, evidence };
}

function deduplicateEvidence(citations: readonly EvidenceCitation[]): EvidenceCitation[] {
  const unique = new Map<string, EvidenceCitation>();
  for (const citation of citations) {
    const key = `${citation.sourceHash}:${citation.citationId}:${citation.knowledgeVersion}`;
    if (!unique.has(key)) unique.set(key, citation);
  }
  return [...unique.values()];
}
