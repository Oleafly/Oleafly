import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const tabsListVariants = cva(
  "inline-flex items-center justify-center rounded-lg bg-muted text-muted-foreground",
  {
    variants: {
      size: {
        default: "h-9 p-1",
        sm: "h-8 p-0.5",
      },
    },
    defaultVariants: { size: "default" },
  },
);

const tabsTriggerVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:bg-accent/60",
  {
    variants: {
      size: {
        default: "px-3 py-1 text-sm",
        sm: "gap-1 px-2 py-0.5 text-xs [&_svg]:size-3.5 [&_svg]:shrink-0",
      },
    },
    defaultVariants: { size: "default" },
  },
);

type TabsSize = NonNullable<VariantProps<typeof tabsListVariants>["size"]>;

const TabsSizeContext = React.createContext<TabsSize>("default");

const FILL_TABS_LIST_CLASS = "flex h-auto gap-1 [&>*]:min-w-0 [&>*]:flex-1";

const SCROLLABLE_TABS_LIST_CLASS =
  "flex h-auto w-fit max-w-full flex-nowrap justify-start gap-1 overflow-x-auto no-scrollbar [&>*]:shrink-0";

function useScrollableTabsList(
  list: HTMLDivElement | null,
  scrollable: boolean,
) {
  React.useEffect(() => {
    if (!scrollable || !list) return;
    const onWheel = (event: WheelEvent) => {
      if (list.scrollWidth <= list.clientWidth) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      list.scrollLeft += event.deltaY;
    };
    const revealActiveTab = () => {
      list
        .querySelector<HTMLElement>('[role="tab"][data-state="active"]')
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    revealActiveTab();
    const observer = new MutationObserver(revealActiveTab);
    observer.observe(list, { subtree: true, attributeFilter: ["data-state"] });
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      list.removeEventListener("wheel", onWheel);
    };
  }, [list, scrollable]);
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> &
    VariantProps<typeof tabsListVariants> & { scrollable?: boolean; fill?: boolean }
>(({ className, size, scrollable = false, fill = false, ...props }, ref) => {
  const [list, setList] = React.useState<HTMLDivElement | null>(null);
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      setList(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  useScrollableTabsList(list, scrollable);
  return (
    <TabsSizeContext.Provider value={size ?? "default"}>
      <TabsPrimitive.List
        ref={setRefs}
        className={cn(
          tabsListVariants({ size }),
          scrollable && SCROLLABLE_TABS_LIST_CLASS,
          fill && FILL_TABS_LIST_CLASS,
          className,
        )}
        {...props}
      />
    </TabsSizeContext.Provider>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> &
    VariantProps<typeof tabsTriggerVariants>
>(({ className, size, ...props }, ref) => {
  const inherited = React.useContext(TabsSizeContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(tabsTriggerVariants({ size: size ?? inherited }), className)}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={className}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
