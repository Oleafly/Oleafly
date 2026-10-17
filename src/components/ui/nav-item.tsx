import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItemProps = Readonly<
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    icon: LucideIcon;
    label: ReactNode;
    active: boolean;
    labelClassName?: string;
  }
>;

export const NavItem = forwardRef<HTMLButtonElement, NavItemProps>(function NavItem(
  { icon: Icon, label, active, labelClassName, className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-current={active ? "page" : undefined}
      {...props}
      className={cn(
        "flex items-center gap-2.5 whitespace-nowrap rounded-md border px-2.5 py-2 text-sm transition-colors",
        active
          ? "border-border bg-background font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:bg-background/60 focus-visible:text-foreground",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className={labelClassName}>{label}</span>
    </button>
  );
});
