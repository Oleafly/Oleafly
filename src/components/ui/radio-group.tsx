import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-2", className)} {...props} />
));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      "aspect-square size-4 rounded-full border border-primary text-primary shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring",
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <Circle className="size-2.5 fill-current" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

const RadioGroupCard = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  Omit<React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>, "aria-label"> & { label: string }
>(({ className, label, children, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    aria-label={label}
    className={cn(
      "group/radio-card flex min-w-0 flex-col items-center gap-1.5 text-center disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="w-full rounded-xl border-2 border-transparent p-[3px] transition-colors group-hover/radio-card:border-border group-focus-visible/radio-card:border-foreground/40 group-data-[state=checked]/radio-card:border-primary motion-reduce:transition-none">
      {children}
    </span>
    <span className="flex max-w-full items-center gap-1 text-xs text-muted-foreground group-data-[state=checked]/radio-card:font-semibold group-data-[state=checked]/radio-card:text-foreground">
      <span className="truncate">{label}</span>
      <Check aria-hidden className="hidden size-3 shrink-0 group-data-[state=checked]/radio-card:block" />
    </span>
  </RadioGroupPrimitive.Item>
));
RadioGroupCard.displayName = "RadioGroupCard";

export { RadioGroup, RadioGroupCard, RadioGroupItem };
