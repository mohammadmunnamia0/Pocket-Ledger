import { Suspense } from "react";
import type { Metadata } from "next";
import { Archive, ArchiveRestore, LogOut, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { ConfirmButton } from "@/components/confirm-button";
import { ThemeSwitcher } from "@/components/theme-provider";
import { InstallAppCard } from "@/components/pwa";
import { TransactionForm } from "@/components/transaction-form";
import { AccountDialog, PasswordForm, RebuildLedgerButton } from "@/components/settings-forms";
import { requireUser } from "@/lib/auth/session";
import { getFormContext } from "@/lib/services/forms";
import { getAccountBalances } from "@/lib/services/finance";
import { ACCOUNT_KIND_LABELS } from "@/lib/labels";
import { archiveAccountAction, deleteAccountAction, setDefaultAccountAction } from "@/app/actions/ledger";
import { logoutAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" help="settings" description="Accounts, transfers, appearance and security." />
      <div className="space-y-5">
        <Section title="Appearance" description="Currency: Bangladeshi Taka (৳) · Timezone: Asia/Dhaka · Dates: DD MMM YYYY">
          <ThemeSwitcher />
        </Section>
        <Section title="Install app" help="installApp" description="Use PocketLedger from your home screen like a native app.">
          <InstallAppCard />
        </Section>
        <Suspense fallback={<TableSkeleton rows={6} />}>
          <Accounts />
        </Suspense>
        <Section title="Change password">
          <PasswordForm />
        </Section>
        <Section title="Data integrity" help="dataIntegrity" description="Re-runs FIFO salary funding over your entire history and checks every balance. Safe to run any time.">
          <RebuildLedgerButton />
        </Section>
        <Section title="Session">
          <form action={logoutAction}>
            <Button type="submit" variant="outline">
              <LogOut /> Sign out
            </Button>
          </form>
        </Section>
      </div>
    </>
  );
}

async function Accounts() {
  const user = await requireUser();
  const [ctx, balances] = await Promise.all([getFormContext(user.id), getAccountBalances(user.id)]);
  const accounts = ctx.raw.accounts;
  return (
    <>
      <Section
        title="Accounts"
        help="accounts"
        description="Where your money physically sits. Balances move with income, expenses, transfers and linked savings — totals are never double counted."
        actions={
          <AccountDialog
            trigger={
              <Button size="sm">
                <Plus /> Add account
              </Button>
            }
          />
        }
      >
        <ul className="divide-y">
          {accounts.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-center gap-3 py-2.5 ${a.archived ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {a.name}
                  {a.isDefault && <span className="ml-2 text-xs font-normal text-muted-foreground">Default</span>}
                  {a.archived && <span className="ml-2 text-xs font-normal text-muted-foreground">Archived</span>}
                </p>
                <p className="text-xs text-muted-foreground">{ACCOUNT_KIND_LABELS[a.kind]}</p>
              </div>
              <Money value={balances.get(a.id) ?? 0} tone="auto" className="text-sm font-medium" />
              <div className="flex gap-0.5">
                {!a.isDefault && !a.archived && (
                  <ConfirmButton
                    title={`Make ${a.name} the default?`}
                    description="New transactions use the default account unless you choose another."
                    confirmLabel="Make default"
                    action={setDefaultAccountAction.bind(null, a.id)}
                    variant="ghost"
                    size="icon-xs"
                    destructive={false}
                  >
                    <Star />
                    <span className="sr-only">Make default</span>
                  </ConfirmButton>
                )}
                <AccountDialog
                  account={a}
                  trigger={
                    <Button variant="ghost" size="icon-xs" aria-label={`Edit ${a.name}`}>
                      <Pencil />
                    </Button>
                  }
                />
                {!a.isDefault && (
                  <ConfirmButton
                    title={a.archived ? `Restore ${a.name}?` : `Archive ${a.name}?`}
                    description="Archived accounts are hidden from forms but keep their history."
                    confirmLabel={a.archived ? "Restore" : "Archive"}
                    action={archiveAccountAction.bind(null, a.id, !a.archived)}
                    variant="ghost"
                    size="icon-xs"
                    destructive={false}
                  >
                    {a.archived ? <ArchiveRestore /> : <Archive />}
                    <span className="sr-only">{a.archived ? "Restore" : "Archive"}</span>
                  </ConfirmButton>
                )}
                {!a.isDefault && (
                  <ConfirmButton title={`Delete ${a.name}?`} description="Only accounts with no transactions can be deleted." action={deleteAccountAction.bind(null, a.id)} variant="ghost" size="icon-xs">
                    <Trash2 />
                    <span className="sr-only">Delete</span>
                  </ConfirmButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Transfer between accounts" help="accounts" description="E.g. ATM withdrawal or bKash cash-in. Not counted as income or expense.">
        <TransactionForm mode="transfer" lookups={ctx.lookups} defaults={ctx.defaults} />
      </Section>
    </>
  );
}
