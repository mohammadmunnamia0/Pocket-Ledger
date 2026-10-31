"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatTaka, formatTakaCompact } from "@/lib/money";
import { formatDayMonth, formatMonth } from "@/lib/dates";

/*
 * Chart conventions (shared): single-hue bars for one series, slot-1 blue / slot-2 orange
 * for income vs. expenses; bars capped at 24px with a 4px rounded data-end; solid hairline
 * grid; tooltips on hover; a data table for every chart; text never wears series color.
 */

const AXIS = { stroke: "var(--axis)", fontSize: 11, tickLine: false, axisLine: false } as const;

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: number; color?: string }[] }) {
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-muted-foreground">
          {r.color && <span className="size-2 rounded-sm" style={{ background: r.color }} aria-hidden />}
          <span>{r.label}</span>
          <span className="tabular ml-auto pl-3 font-medium text-foreground">{formatTaka(r.value)}</span>
        </p>
      ))}
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show data table</summary>
      <table className="mt-2 w-full">
        <thead>
          <tr className="text-left text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={`py-1 font-medium ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((c, j) => (
                <td key={j} className={`py-1 ${j > 0 ? "text-right" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function DailySpendChart({ data }: { data: { date: string; total: number }[] }) {
  const max = Math.max(...data.map((d) => d.total), 0);
  return (
    <div>
      <div className="h-48" role="img" aria-label="Daily spending this month">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => String(Number(d.slice(8)))} interval="preserveStartEnd" minTickGap={12} />
            <YAxis {...AXIS} width={44} tickFormatter={(v: number) => formatTakaCompact(v)} domain={[0, max || 100]} />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <TooltipBox title={formatDayMonth(String(payload[0].payload.date))} rows={[{ label: "Spent", value: Number(payload[0].value) }]} />
                ) : null
              }
            />
            <Bar isAnimationActive={false} dataKey="total" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable head={["Date", "Spent"]} rows={data.filter((d) => d.total > 0).map((d) => [formatDayMonth(d.date), formatTaka(d.total)])} />
    </div>
  );
}

export function IncomeExpenseChart({ data }: { data: { month: string; income: number; expenses: number }[] }) {
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-chart-1" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-chart-2" /> Expenses
        </span>
      </div>
      <div className="h-52" role="img" aria-label="Monthly income versus expenses">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="month" {...AXIS} tickFormatter={(m: string) => formatMonth(m).slice(0, 3)} />
            <YAxis {...AXIS} width={44} tickFormatter={(v: number) => formatTakaCompact(v)} />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={formatMonth(String(payload[0].payload.month))}
                    rows={[
                      { label: "Income", value: Number(payload[0].payload.income), color: "var(--chart-1)" },
                      { label: "Expenses", value: Number(payload[0].payload.expenses), color: "var(--chart-2)" },
                    ]}
                  />
                ) : null
              }
            />
            <Bar isAnimationActive={false} dataKey="income" name="Income" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={20} />
            <Bar isAnimationActive={false} dataKey="expenses" name="Expenses" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        head={["Month", "Income", "Expenses", "Net"]}
        rows={data.map((d) => [formatMonth(d.month), formatTaka(d.income), formatTaka(d.expenses), formatTaka(d.income - d.expenses)])}
      />
    </div>
  );
}

/** Category magnitudes as one-hue horizontal bars, largest first; the tail folds into "Other". */
export function CategoryBarChart({ data, limit = 7 }: { data: { name: string; total: number }[]; limit?: number }) {
  const sorted = [...data].sort((a, b) => b.total - a.total);
  const rows = sorted.length > limit + 1
    ? [...sorted.slice(0, limit), { name: "Other", total: sorted.slice(limit).reduce((s, d) => s + d.total, 0) }]
    : sorted;
  const total = rows.reduce((s, r) => s + r.total, 0);
  return (
    <div>
      <div style={{ height: Math.max(80, rows.length * 34) }} role="img" aria-label="Spending by category">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 72, left: 0, bottom: 0 }} barCategoryGap={6}>
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis type="category" dataKey="name" {...AXIS} width={128} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <TooltipBox title={String(payload[0].payload.name)} rows={[{ label: `${total ? Math.round((Number(payload[0].value) * 100) / total) : 0}% of spending`, value: Number(payload[0].value) }]} />
                ) : null
              }
            />
            <Bar isAnimationActive={false} dataKey="total" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={20}>
              <LabelList dataKey="total" position="right" formatter={(v) => formatTaka(Number(v))} style={{ fill: "var(--foreground)", fontSize: 12 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable head={["Category", "Spent", "Share"]} rows={rows.map((r) => [r.name, formatTaka(r.total), `${total ? Math.round((r.total * 100) / total) : 0}%`])} />
    </div>
  );
}
