import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-forms";
import { Skeleton } from "@/components/ui/skeleton";
import { hasAnyUser } from "@/lib/services/setup";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-muted-foreground">Welcome back to your ledger.</p>
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <LoginGate searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function LoginGate({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  if (!(await hasAnyUser())) redirect("/setup");
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return <LoginForm next={next} />;
}
