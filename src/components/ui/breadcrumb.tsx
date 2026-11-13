import { Slot } from "@radix-ui/react-slot";
import { ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Breadcrumb(props: Readonly<ComponentProps<"nav"> & { "aria-label": string }>) {
  return <nav data-slot="breadcrumb" {...props} />;
}

export function BreadcrumbList({ className, ...props }: Readonly<ComponentProps<"ol">>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn("flex min-w-0 items-center gap-1 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function BreadcrumbItem({ className, ...props }: Readonly<ComponentProps<"li">>) {
  return <li data-slot="breadcrumb-item" className={cn("inline-flex min-w-0 items-center gap-1.5", className)} {...props} />;
}

export function BreadcrumbLink({ asChild = false, className, ...props }: Readonly<ComponentProps<"a"> & { asChild?: boolean }>) {
  const Element = asChild ? Slot : "a";
  return (
    <Element
      data-slot="breadcrumb-link"
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function BreadcrumbPage({ className, ...props }: Readonly<ComponentProps<"span">>) {
  return <span data-slot="breadcrumb-page" aria-current="page" className={cn("min-w-0 truncate px-1 text-foreground", className)} {...props} />;
}

export function BreadcrumbSeparator({ className, ...props }: Readonly<Omit<ComponentProps<"li">, "children">>) {
  return (
    <li data-slot="breadcrumb-separator" role="presentation" aria-hidden="true" className={cn("flex shrink-0 [&>svg]:size-3.5", className)} {...props}>
      <ChevronRight />
    </li>
  );
}
