import { getCurrentUser } from "@/lib/auth/session";
import { importTemplateCsv } from "@/lib/services/import";
import { csvResponse } from "@/lib/csv";

export async function GET() {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  return csvResponse("﻿" + importTemplateCsv(), "pocketledger-import-template.csv");
}
