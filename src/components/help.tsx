"use client";

import { useState } from "react";
import { CircleHelp, Lightbulb, ListChecks, MousePointerClick, Scale, Target } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { HelpKey, HelpTopic } from "@/lib/help-content";
import { cn } from "@/lib/utils";

let cache: Record<HelpKey, HelpTopic> | null = null;

/** The help text is loaded on first open, so it adds nothing to normal page loads. */
async function loadHelp(): Promise<Record<HelpKey, HelpTopic>> {
  cache ??= (await import("@/lib/help-content")).HELP;
  return cache;
}

/** Small ❔ button that opens a Bangla explanation of a page or section. */
export function HelpButton({ topic, className, label }: { topic: HelpKey; className?: string; label?: string }) {
  const [content, setContent] = useState<HelpTopic | null>(cache?.[topic] ?? null);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (open && !content) loadHelp().then((h) => setContent(h[topic]));
      }}
    >
      <DialogTrigger
        aria-label={label ?? "সাহায্য — এই অংশটি কীভাবে কাজ করে"}
        title="সাহায্য"
        className={cn(
          "inline-grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        <CircleHelp className="size-4" aria-hidden />
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <div lang="bn" className="grid gap-5 p-5 text-sm leading-relaxed">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6 text-base">
              <CircleHelp className="size-5 shrink-0 text-primary" aria-hidden />
              {content?.title ?? "সাহায্য"}
            </DialogTitle>
          </DialogHeader>
          {!content ? (
            <div className="grid gap-2" aria-busy="true">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </div>
          ) : (
            <>
              <Block icon={Target} title="এটি কী কাজে লাগে">
                <p>{content.purpose}</p>
              </Block>
              <Block icon={ListChecks} title="এখানে কী দেখা যায়">
                <List items={content.shows} />
              </Block>
              <Block icon={MousePointerClick} title="আপনি যা যা করতে পারবেন">
                <List items={content.actions} />
              </Block>
              <Block icon={Scale} title="আপনার হিসাবে এর প্রভাব">
                <p>{content.impact}</p>
              </Block>
              <div className="rounded-lg bg-muted/60 p-3">
                <Block icon={Lightbulb} title="একটি সহজ উদাহরণ">
                  <ol className="grid list-decimal gap-1 pl-5">
                    {content.example.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </Block>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Block({ icon: Icon, title, children }: { icon: typeof Target; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Icon className="size-3.5 text-primary" aria-hidden /> {title}
      </h3>
      <div className="text-muted-foreground [&_strong]:text-foreground">{children}</div>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="grid list-disc gap-1 pl-5">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}
