"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border bg-card p-6 text-center">
      <AlertTriangle className="mx-auto size-6 text-critical" aria-hidden />
      <h1 className="mt-3 font-semibold">Something went wrong</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your data is safe — every change is saved atomically. Please try again{error.digest ? ` (ref ${error.digest})` : ""}.
      </p>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
