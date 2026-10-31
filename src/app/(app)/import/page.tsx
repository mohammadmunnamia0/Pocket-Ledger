import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/common";
import { ImportWizard } from "@/components/import-wizard";

export const metadata: Metadata = { title: "Import" };

const COLUMNS: [string, string][] = [
  ["date", "YYYY-MM-DD — payment or received date"],
  ["type", "salary · bonus · income · opening · expense · bill · allocation"],
  ["title", "What it was (English or বাংলা)"],
  ["amount", "In taka, e.g. 1200 or 1,200.50 — imported exactly as written"],
  ["category / subcategory", "Existing or new names, or “Parent > Child” in category"],
  ["payment_method", "cash · bank · card · mobile · other (default cash)"],
  ["status", "paid or pending (default paid)"],
  ["month", "YYYY-MM the money belongs to (salary month, bill month, allocation month)"],
  ["person", "Family member (allocations and payments)"],
  ["group", "Rows sharing a group become one expense with an itemized breakdown"],
  ["bill_type / recharge_date", "For bill rows: internet · electricity · gas · water · other"],
  ["notes", "Optional"],
];

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Import historical records"
        help="import"
        description="Bring in salaries, expenses, breakdowns, bills and allocations from your notes. Everything is checked and previewed before saving."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Section title="Upload & review">
          <ImportWizard />
        </Section>
        <Section title="CSV columns" description="Only date, type and amount are required for most rows.">
          <dl className="grid gap-2 text-sm">
            {COLUMNS.map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-xs font-medium">{k}</dt>
                <dd className="text-xs text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Tip: if you had money before your first recorded salary, add an <span className="font-mono">opening</span> row so earlier expenses are funded.
            Imports that would spend more than was available are refused — amounts are never adjusted to make balances match.
          </p>
        </Section>
      </div>
    </>
  );
}
