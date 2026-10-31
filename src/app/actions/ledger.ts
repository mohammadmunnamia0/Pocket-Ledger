"use server";

import { runAction } from "@/lib/actions";
import type { TxnInputRaw } from "@/lib/validation";
import {
  createTransaction,
  deleteTransaction,
  markTransactionPaid,
  updateTransaction,
} from "@/lib/services/transactions";
import { moveSavings, saveGoal, deleteGoal } from "@/lib/services/savings";
import { recordPersonPayment, saveAllocation, deleteAllocation, savePerson, deletePerson, setPersonArchived } from "@/lib/services/people";
import { saveRecurringBill, deleteRecurringBill } from "@/lib/services/bills";
import { saveCategory, deleteCategory, saveAccount, setDefaultAccount, setAccountArchived, deleteAccount } from "@/lib/services/categories";
import { commitImport, previewImport, undoImport, type ImportRow } from "@/lib/services/import";
import { markAllAlertsRead, restoreAlert, saveAlertPrefs, setAlertState } from "@/lib/services/alerts";
import { LEDGER_START, recomputeFunding, verifyFundingIntegrity, withLedger } from "@/lib/ledger/engine";
import { isObjectId } from "@/lib/db/models";
import { AppError } from "@/lib/errors";

function assertId(id: string) {
  if (!isObjectId(id)) throw new AppError("Invalid reference");
  return id;
}

/* Transactions */
export async function createTransactionAction(input: TxnInputRaw) {
  return runAction((uid) => createTransaction(uid, input), "Saved");
}
export async function updateTransactionAction(id: string, input: TxnInputRaw) {
  return runAction((uid) => updateTransaction(uid, assertId(id), input), "Changes saved");
}
export async function deleteTransactionAction(id: string) {
  return runAction((uid) => deleteTransaction(uid, assertId(id)), "Deleted — balances recalculated");
}
export async function markPaidAction(id: string, date?: string) {
  return runAction((uid) => markTransactionPaid(uid, assertId(id), date), "Marked as paid");
}

/* Savings */
export async function saveGoalAction(input: Parameters<typeof saveGoal>[1], id?: string) {
  return runAction((uid) => saveGoal(uid, input, id ? assertId(id) : undefined), "Goal saved");
}
export async function deleteGoalAction(id: string) {
  return runAction((uid) => deleteGoal(uid, assertId(id)), "Goal deleted");
}
export async function moveSavingsAction(input: Parameters<typeof moveSavings>[1]) {
  return runAction(
    (uid) => moveSavings(uid, { ...input, goalId: assertId(input.goalId) }),
    input.direction === "deposit" ? "Added to savings" : "Withdrawn from savings",
  );
}

/* People & allocations */
export async function savePersonAction(input: Parameters<typeof savePerson>[1], id?: string) {
  return runAction((uid) => savePerson(uid, input, id ? assertId(id) : undefined), "Saved");
}
export async function deletePersonAction(id: string) {
  return runAction((uid) => deletePerson(uid, assertId(id)), "Person deleted");
}
export async function archivePersonAction(id: string, archived: boolean) {
  return runAction((uid) => setPersonArchived(uid, assertId(id), archived), archived ? "Archived" : "Restored");
}
export async function saveAllocationAction(input: Parameters<typeof saveAllocation>[1]) {
  return runAction((uid) => saveAllocation(uid, input), "Allocation saved");
}
export async function deleteAllocationAction(id: string) {
  return runAction((uid) => deleteAllocation(uid, assertId(id)), "Allocation removed");
}
export async function recordPaymentAction(input: Parameters<typeof recordPersonPayment>[1]) {
  return runAction((uid) => recordPersonPayment(uid, { ...input, personId: assertId(input.personId) }), "Payment recorded");
}

/* Bills */
export async function saveRecurringBillAction(input: Parameters<typeof saveRecurringBill>[1], id?: string) {
  return runAction((uid) => saveRecurringBill(uid, input, id ? assertId(id) : undefined), "Recurring bill saved");
}
export async function deleteRecurringBillAction(id: string) {
  return runAction((uid) => deleteRecurringBill(uid, assertId(id)), "Recurring bill removed");
}

/* Categories & accounts */
export async function saveCategoryAction(input: Parameters<typeof saveCategory>[1], id?: string) {
  return runAction((uid) => saveCategory(uid, input, id ? assertId(id) : undefined), "Category saved");
}
export async function deleteCategoryAction(id: string, reassignTo?: string) {
  return runAction((uid) => deleteCategory(uid, assertId(id), reassignTo ? assertId(reassignTo) : undefined), "Category deleted");
}
export async function saveAccountAction(input: Parameters<typeof saveAccount>[1], id?: string) {
  return runAction((uid) => saveAccount(uid, input, id ? assertId(id) : undefined), "Account saved");
}
export async function setDefaultAccountAction(id: string) {
  return runAction((uid) => setDefaultAccount(uid, assertId(id)), "Default account updated");
}
export async function archiveAccountAction(id: string, archived: boolean) {
  return runAction((uid) => setAccountArchived(uid, assertId(id), archived), archived ? "Account archived" : "Account restored");
}
export async function deleteAccountAction(id: string) {
  return runAction((uid) => deleteAccount(uid, assertId(id)), "Account deleted");
}

/* Import */
export async function previewImportAction(rows: ImportRow[]) {
  return runAction((uid) => previewImport(uid, rows));
}
export async function commitImportAction(rows: ImportRow[]) {
  return runAction((uid) => commitImport(uid, rows), "Import complete");
}
export async function undoImportAction(batch: string) {
  return runAction((uid) => undoImport(uid, batch), "Import undone");
}

/* Alerts */
export async function alertStateAction(key: string, change: "read" | "dismiss") {
  return runAction((uid) => setAlertState(uid, key, change));
}
export async function markAllAlertsReadAction() {
  return runAction((uid) => markAllAlertsRead(uid), "All alerts marked read");
}
export async function restoreAlertAction(key: string) {
  return runAction((uid) => restoreAlert(uid, key), "Alert restored");
}
export async function saveAlertPrefsAction(input: Parameters<typeof saveAlertPrefs>[1]) {
  return runAction((uid) => saveAlertPrefs(uid, input), "Alert preferences saved");
}

/* Maintenance */
export async function rebuildLedgerAction() {
  return runAction(async (uid) => {
    await withLedger(uid, (session) => recomputeFunding(uid, LEDGER_START, session, { reason: "Manual rebuild" }));
    return verifyFundingIntegrity(uid);
  }, "Funding ledger rebuilt and verified");
}
