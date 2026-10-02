import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const SECTION_HEADING_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

export function SectionHeading({
  as: Tag = "h3",
  id,
  className,
  children,
}: Readonly<{
  as?: "h2" | "h3" | "h4" | "p" | "div";
  id?: string;
  className?: string;
  children: ReactNode;
}>) {
  return (
    <Tag id={id} className={cn(SECTION_HEADING_CLASS, className)}>
      {children}
    </Tag>
  );
}
