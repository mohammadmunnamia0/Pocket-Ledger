"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/form-controls";
import { useAction } from "@/components/use-action";
import { markAllAlertsReadAction, restoreAlertAction, saveAlertPrefsAction } from "@/app/actions/ledger";
import { ALERT_TYPES, type AlertType } from "@/lib/alerts/types";
import { toInputValue } from "@/lib/money";

export function AlertPrefsForm({
  prefs,
}: {
  prefs: { enabled: Record<string, boolean>; minBalance: number; spendWarnPct: number; savingsReminderDay: number };
}) {
  const { pending, run } = useAction();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(prefs.enabled ?? {});
  const [minBalance, setMinBalance] = useState(toInputValue(prefs.minBalance));
  const [pct, setPct] = useState(String(prefs.spendWarnPct));
  const [day, setDay] = useState(String(prefs.savingsReminderDay));
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveAlertPrefsAction({ enabled, minBalance, spendWarnPct: pct, savingsReminderDay: day }));
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Minimum balance warning (৳)" htmlFor="ap-min" hint="Also kept as a buffer before suggesting savings">
          <Input id="ap-min" value={minBalance} onChange={(e) => setMinBalance(e.target.value)} inputMode="decimal" className="tabular" />
        </Field>
        <Field label="High spending warning at (%)" htmlFor="ap-pct" hint="Of the money available this salary cycle">
          <Input id="ap-pct" type="number" min={10} max={100} value={pct} onChange={(e) => setPct(e.target.value)} />
        </Field>
        <Field label="Savings reminder day" htmlFor="ap-day" hint="Remind if nothing saved by this day (0 = off)">
          <Input id="ap-day" type="number" min={0} max={28} value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
      </div>
      <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Alert types</legend>
        {(Object.keys(ALERT_TYPES) as AlertType[]).map((t) => (
          <label key={t} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
            {ALERT_TYPES[t]}
            <Switch checked={enabled[t] !== false} onCheckedChange={(v) => setEnabled((e) => ({ ...e, [t]: v }))} />
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save preferences
        </Button>
      </div>
    </form>
  );
}

export function MarkAllReadButton() {
  const { pending, run } = useAction();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => markAllAlertsReadAction())}>
      Mark all read
    </Button>
  );
}

export function RestoreAlertButton({ alertKey }: { alertKey: string }) {
  const { pending, run } = useAction();
  return (
    <Button variant="ghost" size="xs" disabled={pending} onClick={() => run(() => restoreAlertAction(alertKey))}>
      <RotateCcw /> Restore
    </Button>
  );
}
