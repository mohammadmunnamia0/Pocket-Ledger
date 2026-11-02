/**
 * Your businesses. `key` is permanent (used in links); each business also gets a database id
 * when it is set up, and every transaction points at that id — so renaming a business never
 * breaks its history. `available` turns a business on, phase by phase.
 */
export const BUSINESSES = [
  { key: "alwin-bd", name: "Alwin BD", type: "Online Clothing Brand", icon: "shirt", available: true },
  { key: "returnhex", name: "ReturnHex", type: "IT Firm", icon: "code", available: false },
  { key: "naire", name: "Naire", type: "Women's Lifestyle Brand", icon: "sparkles", available: false },
] as const;

export type BusinessKey = (typeof BUSINESSES)[number]["key"];
export const BUSINESS_KEYS = BUSINESSES.map((b) => b.key) as BusinessKey[];
export const businessPreset = (key: string) => BUSINESSES.find((b) => b.key === key) ?? null;
