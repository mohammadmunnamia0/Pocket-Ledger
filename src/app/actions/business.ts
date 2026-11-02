"use server";

import { runAction } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { isObjectId } from "@/lib/db/models";
import { BUSINESS_KEYS } from "@/lib/business/registry";
import { deleteBusinessTxn, saveBusinessTxn, saveInterBusiness, setupBusiness } from "@/lib/services/business";
import type { BusinessSetupRaw, BusinessTxnRaw, InterBusinessRaw } from "@/lib/validation";

function assertKey(key: string) {
  if (!(BUSINESS_KEYS as string[]).includes(key)) throw new AppError("Unknown business");
  return key;
}
function assertId(id: string) {
  if (!isObjectId(id)) throw new AppError("Invalid reference");
  return id;
}
function assertRef(ref: string) {
  if (typeof ref !== "string" || ref.length < 8 || ref.length > 64) throw new AppError("Invalid reference");
  return ref;
}

export async function setupBusinessAction(key: string, input: BusinessSetupRaw) {
  return runAction((uid) => setupBusiness(uid, assertKey(key), input), "Business details saved");
}
export async function saveBusinessTxnAction(key: string, input: BusinessTxnRaw, id?: string) {
  return runAction((uid) => saveBusinessTxn(uid, assertKey(key), input, id ? assertId(id) : undefined), id ? "Changes saved — balances recalculated" : "Transaction added");
}
export async function saveInterBusinessAction(key: string, input: InterBusinessRaw, linkRef?: string) {
  return runAction(
    (uid) => saveInterBusiness(uid, assertKey(key), input, linkRef ? assertRef(linkRef) : undefined),
    linkRef ? "Saved in both businesses" : "Recorded in both businesses",
  );
}
export async function deleteBusinessTxnAction(key: string, id: string) {
  return runAction((uid) => deleteBusinessTxn(uid, assertKey(key), assertId(id)), "Deleted — balances recalculated");
}
