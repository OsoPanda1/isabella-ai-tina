/**
 * AI Transparency Route (src/server-routes/api/ai-transparency.ts)
 */
import type { Request, Response } from "express";
import { getAIGovernanceProfile } from "../../lib/ai-governance";

export async function handleAiTransparency(req: Request, res: Response): Promise<void> {
  const profile = getAIGovernanceProfile();
  res.status(200).json(profile);
}

export { getAIGovernanceProfile };
export default { handleAiTransparency };
