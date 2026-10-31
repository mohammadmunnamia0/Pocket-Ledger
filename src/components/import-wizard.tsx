"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/use-action";
import { commitImportAction, previewImportAction } from "@/app/actions/ledger";
import { parseCsvObjects } from "@/lib/csv";
import { formatTaka } from "@/lib/money";
import { formatDate, formatMonth } from "@/lib/dates";
import type { ImportPreview, ImportRow } from "@/lib/services/import";

export function ImportWizard() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const { pending, run } = useAction();

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) return toast.error("File is too large (max 2 MB)");
    setText(await file.text());
    setPreview(null);
  }

  function validate() {
    const parsed = parseCsvObjects(text) as ImportRow[];
    setRows(parsed);
    run(() => previewImportAction(parsed), { success: false, onSuccess: (p) => setPreview(p ?? null) });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
            <FileUp className="size-4" aria-hidden /> Choose CSV file
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <a href="/api/import/template" className="text-sm text-primary hover:underline">
            Download template
          </a>
        </div>
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          rows={8}
          placeholder="…or paste CSV here (first row = column headers)"
          className="font-mono text-xs"
          aria-label="CSV content"
        />
        <div>
          <Button onClick={validate} disabled={!text.trim() || pending}>
            {pending && !preview && <Loader2 className="animate-spin" />} Review import
          </Button>
        </div>
      </div>

      {preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Imported income" value={formatTaka(preview.totals.income)} />
            <Stat label="Imported expenses" value={formatTaka(preview.totals.expenses)} />
            <Stat label="Pending (not deducted)" value={formatTaka(preview.totals.pending)} />
            <Stat label="Balance before import" value={formatTaka(preview.openingBalance)} />
            <Stat label="Calculated closing balance" value={formatTaka(preview.closingBalance)} />
          </div>

          {(preview.issues.length > 0 || preview.newCategories.length > 0 || preview.newPersons.length > 0) && (
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              {preview.issues.map((i) => (
                <p key={i} className="flex gap-2 text-critical">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {i}
                </p>
              ))}
              {preview.newCategories.length > 0 && <p className="text-muted-foreground">New categories will be created: {preview.newCategories.join(", ")}</p>}
              {preview.newPersons.length > 0 && <p className="text-muted-foreground">New people will be created: {preview.newPersons.join(", ")}</p>}
            </div>
          )}

          <div className="relative overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Category / person</th>
                  <th className="px-3 py-2 font-medium">Month</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Check</th>
                </tr>
              </thead>
              <tbody>
                {preview.entries.map((e) => (
                  <tr key={e.rows.join("-")} className={`border-b last:border-0 ${e.errors.length ? "bg-critical/5" : ""}`}>
                    <td className="px-3 py-2 text-muted-foreground tabular">{e.rows.length > 1 ? `${e.rows[0]}–${e.rows.at(-1)}` : e.rows[0]}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{e.kind === "allocation" ? "—" : formatDate(e.date)}</td>
                    <td className="px-3 py-2 capitalize">{e.kind}{e.status === "pending" ? " (pending)" : ""}</td>
                    <td className="px-3 py-2">
                      {e.title}
                      {e.itemCount > 0 && <span className="text-xs text-muted-foreground"> · {e.itemCount} items</span>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{[e.category, e.person].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatMonth(e.month)}</td>
                    <td className="px-3 py-2 text-right tabular">{formatTaka(e.amount)}</td>
                    <td className="px-3 py-2 text-xs">
                      {e.errors.map((x) => (
                        <p key={x} className="text-critical">
                          {x}
                        </p>
                      ))}
                      {e.warnings.map((x) => (
                        <p key={x} className="text-warning">
                          {x}
                        </p>
                      ))}
                      {!e.errors.length && !e.warnings.length && <CheckCircle2 className="size-4 text-good" aria-label="OK" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {preview.canCommit
                ? `${preview.totals.transactions} transactions will be saved in one step. Amounts are imported exactly as written.`
                : "Fix the problems above in your file, then review again. Nothing has been saved."}
            </p>
            <Button
              disabled={!preview.canCommit || pending}
              onClick={() =>
                run(() => commitImportAction(rows), {
                  onSuccess: () => {
                    setPreview(null);
                    setText("");
                    router.push("/transactions");
                  },
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />} Import {preview.entries.length} records
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular">{value}</p>
    </div>
  );
}
