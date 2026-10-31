import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { SetupForm } from "@/components/auth-forms";
import { Skeleton } from "@/components/ui/skeleton";
import { hasAnyUser } from "@/lib/services/setup";

export const metadata: Metadata = { title: "Set up" };

export default function SetupPage() {
  return (
    <>
      <h1 className="text-lg font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        One-time setup. Default categories and accounts (Cash, Bank, Mobile Banking) are created for you.
      </p>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <SetupGate />
      </Suspense>
    </>
  );
}

async function SetupGate() {
  await connection();
  // Setup is only possible on a fresh install.
  if (await hasAnyUser()) redirect("/login");
  return <SetupForm />;
}
