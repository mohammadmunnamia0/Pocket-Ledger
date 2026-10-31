"use client";

import { useCallback, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/errors";
import { requestPull } from "@/lib/offline/engine";

type Failure = Extract<ActionResult, { ok: false }>;

/** Run a server action in a transition and report the outcome with a toast. */
export function useAction() {
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    <T>(
      action: () => Promise<ActionResult<T>>,
      opts: { onSuccess?: (data: T | undefined) => void; onError?: (f: Failure) => void; success?: string | false } = {},
    ) => {
      startTransition(async () => {
        try {
          const res = await action();
          if (res.ok) {
            requestPull();
            if (opts.success !== false) toast.success(opts.success ?? res.message ?? "Saved");
            opts.onSuccess?.(res.data);
          } else {
            toast.error(res.error);
            opts.onError?.(res);
          }
        } catch {
          toast.error("Network error — please try again");
        }
      });
    },
    [],
  );

  return { pending, run };
}
