import { encodeUtf8, fnv1aString } from "./bytes";

export const SOVEREIGN_DATASET_SCHEMA = "isabella.sovereign-dataset/v1" as const;
export const DATASET_SPLITS = ["train", "validation", "test"] as const;
export type DatasetSplit = (typeof DATASET_SPLITS)[number];

export interface SovereignDocument {
  id: string;
  text: string;
  source: string;
  license: string;
  language: string;
  domain: string;
  consent: "explicit" | "open-license" | "public-record" | "unknown";
  quality: number;
  metadata?: Record<string, string>;
}

export interface DatasetShard {
  id: string;
  split: DatasetSplit;
  path: string;
  records: number;
  bytes: number;
  sha256: string;
  compression: "none" | "gzip" | "zstd";
}

export interface SovereignDatasetManifest {
  schema: typeof SOVEREIGN_DATASET_SCHEMA;
  version: string;
  createdAt: string;
  provenance: string;
  documents: number;
  bytes: number;
  splits: Record<DatasetSplit, number>;
  shards: DatasetShard[];
}

export interface DatasetBuildOptions {
  version: string;
  provenance: string;
  ratios?: readonly [number, number, number];
}

export function validateDocument(document: SovereignDocument): string[] {
  const errors: string[] = [];
  if (!document.id.trim()) errors.push("id is required");
  if (!document.text.trim()) errors.push("text is required");
  if (!document.source.trim()) errors.push("source is required");
  if (!document.license.trim()) errors.push("license is required");
  if (!document.language.trim()) errors.push("language is required");
  if (!document.domain.trim()) errors.push("domain is required");
  if (document.consent === "unknown") errors.push("consent must be explicit or attributable");
  if (!Number.isFinite(document.quality) || document.quality < 0 || document.quality > 1)
    errors.push("quality must be between 0 and 1");
  return errors;
}

export function stableSplit(
  documentId: string,
  ratios: readonly [number, number, number] = [0.8, 0.1, 0.1],
): DatasetSplit {
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  if (total <= 0 || ratios.some((ratio) => ratio < 0)) throw new Error("Invalid split ratios");
  const bucket = (fnv1aString(documentId) % 10_000) / 10_000;
  const trainEnd = ratios[0] / total;
  const validationEnd = trainEnd + ratios[1] / total;
  return bucket < trainEnd ? "train" : bucket < validationEnd ? "validation" : "test";
}

export function canonicalDocumentLine(document: SovereignDocument): string {
  return JSON.stringify({
    id: document.id,
    text: document.text,
    source: document.source,
    license: document.license,
    language: document.language,
    domain: document.domain,
    consent: document.consent,
    quality: Number(document.quality.toFixed(6)),
    ...(document.metadata ? { metadata: sortRecord(document.metadata) } : {}),
  });
}

export function byteSizeOfDocuments(documents: readonly SovereignDocument[]): number {
  return documents.reduce(
    (total, document) => total + encodeUtf8(canonicalDocumentLine(document) + "\n").byteLength,
    0,
  );
}

export function buildManifest(
  documents: readonly SovereignDocument[],
  options: DatasetBuildOptions,
): SovereignDatasetManifest {
  if (!options.version.trim() || !options.provenance.trim())
    throw new Error("Dataset metadata is required");
  const invalid = documents.flatMap((document) =>
    validateDocument(document).map((error) => `${document.id}: ${error}`),
  );
  if (invalid.length > 0) throw new Error(`Invalid sovereign dataset: ${invalid.join("; ")}`);
  const splits = { train: 0, validation: 0, test: 0 } satisfies Record<DatasetSplit, number>;
  for (const document of documents) splits[stableSplit(document.id, options.ratios)] += 1;
  return {
    schema: SOVEREIGN_DATASET_SCHEMA,
    version: options.version,
    createdAt: new Date().toISOString(),
    provenance: options.provenance,
    documents: documents.length,
    bytes: byteSizeOfDocuments(documents),
    splits,
    shards: [],
  };
}

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function isDatasetSplit(value: string): value is DatasetSplit {
  return (DATASET_SPLITS as readonly string[]).includes(value);
}

export function emptySplitCounts(): Record<DatasetSplit, number> {
  return { train: 0, validation: 0, test: 0 };
}

export function assertManifest(manifest: SovereignDatasetManifest): void {
  if (manifest.schema !== SOVEREIGN_DATASET_SCHEMA)
    throw new Error("Unsupported dataset manifest schema");
  if (!manifest.version || !manifest.provenance) throw new Error("Incomplete dataset manifest");
  if (manifest.documents < 0 || manifest.bytes < 0) throw new Error("Invalid dataset totals");
  const shardRecords = manifest.shards.reduce((total, shard) => total + shard.records, 0);
  if (manifest.shards.length > 0 && shardRecords !== manifest.documents)
    throw new Error("Manifest shard record count does not match documents");
}

export function deduplicateDocuments(documents: readonly SovereignDocument[]): SovereignDocument[] {
  const seen = new Set<string>();
  return documents.filter((document) => {
    const key = `${document.source}\u0000${document.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function estimateTokenCount(documents: readonly SovereignDocument[]): number {
  return documents.reduce((total, document) => total + encodeUtf8(document.text).byteLength, 0);
}

export function createDatasetManifest(
  documents: readonly SovereignDocument[],
  options: DatasetBuildOptions,
): SovereignDatasetManifest {
  return buildManifest(deduplicateDocuments(documents), options);
}
