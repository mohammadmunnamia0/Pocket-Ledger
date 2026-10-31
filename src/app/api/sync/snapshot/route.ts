import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getSnapshot } from "@/lib/services/sync";

/** The user's data for the offline copy. Returns 304 when the device already has this version. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const snapshot = await getSnapshot(user.id);
  const headers = { "Cache-Control": "private, no-store", ETag: `"${snapshot.version}"` };
  if (request.headers.get("if-none-match") === `"${snapshot.version}"`) return new Response(null, { status: 304, headers });
  return Response.json(snapshot, { headers });
}
