"use client";

import { useActionState, useEffect, useRef, useState, type ComponentProps } from "react";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-controls";
import { loginAction, setupAction, type LoginState } from "@/app/actions/auth";
import type { ActionResult } from "@/lib/errors";

/** Email input tuned for phone keyboards: no auto-capitalise / autocorrect / spellcheck. */
function EmailInput(props: ComponentProps<typeof Input>) {
  return (
    <Input
      type="email"
      inputMode="email"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="next"
      required
      {...props}
    />
  );
}

/**
 * Password input with a show/hide toggle, so you can see exactly what was typed or what the
 * browser's password manager auto-filled (a common cause of failed sign-ins on phones).
 */
function PasswordInput({ inputRef, ...props }: ComponentProps<typeof Input> & { inputRef?: React.Ref<HTMLInputElement> }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        className="pr-11"
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // On phones the keyboard can cover the bottom of the form — bring the error into view.
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [message]);
  return (
    <div ref={ref} role="alert" className="flex gap-2 rounded-lg border border-critical/30 bg-critical/5 p-3 text-sm text-critical">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (state?.error) passwordRef.current?.focus({ preventScroll: true });
  }, [state]);

  return (
    <form action={action} onSubmit={() => setAttempt((n) => n + 1)} className="grid gap-4">
      {state?.error && <FormError key={attempt} message={state.error} />}
      <input type="hidden" name="next" value={next ?? "/"} />
      <Field label="Email" htmlFor="email">
        {/* React resets forms after an action; defaultValue brings the email back after a failure. */}
        <EmailInput id="email" name="email" autoComplete="username" defaultValue={state?.email ?? ""} autoFocus={!state} aria-invalid={!!state?.error} />
      </Field>
      <Field label="Password" htmlFor="password">
        <PasswordInput id="password" name="password" autoComplete="current-password" enterKeyHint="go" inputRef={passwordRef} aria-invalid={!!state?.error} />
      </Field>
      <Button type="submit" size="lg" className="h-11" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Sign in
      </Button>
    </form>
  );
}

type SetupState = ActionResult | null;

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="grid gap-4">
      {state && !state.ok && !state.fieldErrors && <FormError message={state.error} />}
      <Field label="Your name" htmlFor="name" error={errors.name}>
        <Input id="name" name="name" autoComplete="name" enterKeyHint="next" required autoFocus />
      </Field>
      <Field label="Email" htmlFor="email" error={errors.email}>
        <EmailInput id="email" name="email" autoComplete="username" />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password} hint="At least 8 characters">
        <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} enterKeyHint="go" />
      </Field>
      <Button type="submit" size="lg" className="h-11" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Create account
      </Button>
    </form>
  );
}
