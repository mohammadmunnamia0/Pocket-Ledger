import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { applyOperation } from "@/lib/services/sync";
import type { SyncOperation } from "@/lib/sync/types";

const opSchema = z.discriminatedUnion("kind", [
  z.object({ opId: z.string().min(8).max(64), kind: z.literal("create"), clientRef: z.string().min(8).max(64), payload: z.record(z.string(), z.unknown()) }),
  z.object({
    opId: z.string().min(8).max(64),
    kind: z.literal("update"),
    txnId: z.string(),
    baseUpdatedAt: z.string(),
    payload: z.record(z.string(), z.unknown()),
    force: z.boolean().optional(),
  }),
  z.object({ opId: z.string().min(8).max(64), kind: z.literal("delete"), txnId: z.string(), baseUpdatedAt: z.string(), force: z.boolean().optional() }),
]);
const bodySchema = z.object({ ops: z.array(opSchema).min(1).max(25) });

/**
 * Apply queued offline changes, strictly in order. Stops at the first change that is not
 * applied so later changes (which may depend on it) are not applied out of order.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid sync request" }, { status: 400 });

  const results = [];
  for (const op of parsed.data.ops as SyncOperation[]) {
    const result = await applyOperation(user.id, op);
    results.push(result);
    if (result.status !== "applied") break;
  }
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
