import { config } from "@/lib/config";
import { getPgPool } from "@/lib/persistence/adapters/neon-adapter";

export interface DataErasureResult {
  tenant_id: string;
  user_id?: string | null;
  erasure_token: string;
  deleted: Record<string, number>;
  immutable_evidence_retained: Record<string, number>;
}

export async function eraseSubjectData(
  tenantId: string,
  userId?: string,
): Promise<DataErasureResult> {
  if (!tenantId.trim()) throw new Error("tenant_id_required");
  if (!config().DATABASE_URL) throw new Error("durable_database_required");
  const { rows } = await getPgPool().query("SELECT public.erase_subject_data($1,$2) AS result", [
    tenantId,
    userId ?? null,
  ]);
  const result = rows[0]?.result;
  if (!result || typeof result !== "object") throw new Error("erasure_result_invalid");
  return result as DataErasureResult;
}
