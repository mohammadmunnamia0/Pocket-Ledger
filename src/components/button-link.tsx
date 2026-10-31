import Link from "next/link";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

/** A Next.js link styled as a button (Base UI renders it as an <a>, not a <button>). */
export function ButtonLink({
  href,
  prefetch,
  ...props
}: Omit<ComponentProps<typeof Button>, "render" | "nativeButton"> & { href: string; prefetch?: boolean }) {
  return <Button nativeButton={false} render={<Link href={href} prefetch={prefetch} />} {...props} />;
}
