import { z } from "zod";

export const OrionArtifactSchema = z.object({
  id: z.string().trim().min(1).max(256),
  title: z.string().trim().min(1).max(500),
  content: z.string().max(2_000_000),
  source: z.string().trim().min(1).max(2_000),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  createdAt: z.string().datetime().optional(),
});

export const OrionInputSchema = z.object({
  query: z.string().trim().min(1).max(10_000),
  artifacts: z.array(OrionArtifactSchema).max(10_000),
  maxResults: z.number().int().min(1).max(100).default(8),
});

export type ValidatedOrionInput = z.infer<typeof OrionInputSchema>;

export function parseOrionInput(input: unknown): ValidatedOrionInput {
  return OrionInputSchema.parse(input);
}
