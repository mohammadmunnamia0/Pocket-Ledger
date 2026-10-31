/** Errors whose message is safe and useful to show to the user. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "APP_ERROR",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(`${what} not found`, "NOT_FOUND");
  }
}

export class InsufficientFundsError extends AppError {
  constructor(message: string, details: { consumerId: string; date: string; required: number; funded: number }) {
    super(message, "INSUFFICIENT_FUNDS", details);
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Convert any thrown value into a user-facing failure result. Unknown errors are logged, not leaked. */
export function toFailure(err: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (err instanceof AppError) return { ok: false, error: err.message };
  if (err && typeof err === "object" && "issues" in err && Array.isArray((err as { issues: unknown[] }).issues)) {
    const issues = (err as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    const fieldErrors: Record<string, string> = {};
    for (const issue of issues) {
      const key = issue.path.map(String).join(".") || "form";
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, error: issues[0]?.message ?? "Invalid input", fieldErrors };
  }
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}
