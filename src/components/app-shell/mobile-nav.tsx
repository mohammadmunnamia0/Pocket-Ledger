"use client";

import { Suspense, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ActiveNav, Brand, NavList } from "./nav";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" />}>
        <Menu />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="py-2">
          <Brand />
        </div>
        <Suspense fallback={<NavList active={null} />}>
          <ActiveNav onNavigate={() => setOpen(false)} />
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}
