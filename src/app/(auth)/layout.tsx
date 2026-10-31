import { Brand } from "@/components/app-shell/nav";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <div className="rounded-xl border bg-card p-6">{children}</div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Your financial data stays private behind this sign-in.</p>
      </div>
    </div>
  );
}
