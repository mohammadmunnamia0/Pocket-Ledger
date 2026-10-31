"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";
import { useAction } from "./use-action";

/** A button that asks for confirmation before running a (usually destructive) action. */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Delete",
  action,
  onDone,
  variant = "destructive",
  size = "sm",
  className,
  destructive = true,
}: {
  children: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  action: () => Promise<ActionResult<unknown>>;
  onDone?: () => void;
  variant?: "destructive" | "outline" | "ghost" | "default" | "secondary";
  size?: "sm" | "xs" | "default" | "icon-sm" | "icon-xs";
  className?: string;
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant={variant} size={size} className={className} />}>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() =>
              run(action, {
                onSuccess: () => {
                  setOpen(false);
                  onDone?.();
                },
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
