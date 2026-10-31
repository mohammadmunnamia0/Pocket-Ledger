/** Alert type catalogue (client-safe). */
export const ALERT_TYPES = {
  low_balance: "Low or insufficient balance",
  bills: "Upcoming bills & pending payments",
  high_spend: "High spending this salary cycle",
  category_increase: "Category spending increase",
  medical: "Medical emergency fund",
  savings_opportunity: "Savings opportunities",
  goal_progress: "Savings goal progress",
  achievement: "Monthly savings achievements",
  family_reserve: "Family allocation reserve",
  savings_reminder: "Monthly savings reminder",
} as const;
export type AlertType = keyof typeof ALERT_TYPES;
