import { Suspense } from "react";
import type { Metadata } from "next";
import { EmptyState, PageHeader, Section, TableSkeleton } from "@/components/common";
import { AlertPrefsForm, MarkAllReadButton, RestoreAlertButton } from "@/components/alert-settings";
import { requireUser } from "@/lib/auth/session";
import { getAlertHistory, getAlertPrefs } from "@/lib/services/alerts";
import { ALERT_TYPES, type AlertType } from "@/lib/alerts/types";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <>
      <PageHeader title="Alerts" description="Alert history and preferences. Alerts come from your real figures and appear once per period." />
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <Alerts />
      </Suspense>
    </>
  );
}

async function Alerts() {
  const user = await requireUser();
  const [history, prefs] = await Promise.all([getAlertHistory(user.id), getAlertPrefs(user.id)]);
  const dt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "numeric" });
  return (
    <div className="space-y-5">
      <Section title="Preferences">
        <AlertPrefsForm prefs={prefs} />
      </Section>
      <Section title="History" actions={history.some((h) => !h.readAt) ? <MarkAllReadButton /> : null}>
        {history.length === 0 ? (
          <EmptyState title="No alerts yet" description="Alerts appear on the dashboard as your data changes." />
        ) : (
          <ul className="divide-y">
            {history.map((h) => (
              <li key={h.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {h.title}
                    <span className="ml-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{h.priority}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{h.message}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {ALERT_TYPES[h.type as AlertType] ?? h.type} · first seen {dt.format(new Date(h.firstSeenAt))}
                    {h.dismissedAt ? " · dismissed" : h.readAt ? " · read" : " · unread"}
                  </p>
                </div>
                {h.dismissedAt && <RestoreAlertButton alertKey={h.key} />}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
