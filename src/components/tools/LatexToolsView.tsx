import { useMemo, useState } from "react";
import { Search, ToolCase, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WHITE_PANEL, cn } from "@/lib/utils";
import { useHomeViewStore } from "@/store/home-view";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import {
  TOOL_CATEGORY_ORDER,
  TOOL_DEFINITIONS,
  toolById,
  type ToolDefinition,
  type ToolId,
} from "@/lib/tool-catalog";

const TOOL_TONES: Record<
  ToolDefinition["tone"],
  { icon: string; badge: string; slash: string }
> = {
  rose: {
    icon: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    badge: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    slash: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  violet: {
    icon: "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    slash: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  emerald: {
    icon: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    slash: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  cyan: {
    icon: "border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    badge: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    slash: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  blue: {
    icon: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    slash: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  sky: {
    icon: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    slash: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  amber: {
    icon: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    slash: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
};

function ToolCard({
  tool,
  onOpen,
}: {
  tool: ToolDefinition;
  onOpen: () => void;
}) {
  const tone = TOOL_TONES[tool.tone];
  return (
    <button
      type="button"
      data-testid={`latex-tool-card-${tool.id}`}
      onClick={onOpen}
      className="group flex w-full items-start gap-4 rounded-xl border bg-card p-5 text-left shadow-sm transition-colors hover:bg-accent/35"
    >
      <div
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-xl border",
          tone.icon,
        )}
      >
        <tool.icon className="size-5.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold group-hover:text-foreground">
            {tool.name}
          </span>
          <code
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-semibold",
              tone.slash,
            )}
          >
            /{tool.slash[0]}
          </code>
        </div>
        <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {tool.description}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tool.tags.map((t) => (
            <span
              key={t}
              className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-medium",
                tone.badge,
              )}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

function ToolsGallery({
  search,
  onOpenTool,
}: {
  search: string;
  onOpenTool: (id: ToolId) => void;
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return TOOL_DEFINITIONS;
    return TOOL_DEFINITIONS.filter((t) =>
      `${t.name} ${t.description} ${t.tags.join(" ")} ${t.slash.join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [search]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, ToolDefinition[]>();
    for (const t of filtered) {
      byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
    }
    return TOOL_CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
      category: c,
      tools: byCategory.get(c) ?? [],
    }));
  }, [filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex-1 p-6">
        {grouped.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No tools match.
          </div>
        ) : (
          <div className="space-y-7">
            {grouped.map(({ category: c, tools }) => (
              <section key={c} className="space-y-3 lg:pl-[8.25rem]">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {c}
                </div>
                <div
                  className={cn(
                    "grid gap-3",
                    tools.length > 1 && "md:grid-cols-2",
                  )}
                >
                  {tools.map((t) => (
                    <ToolCard
                      key={t.id}
                      tool={t}
                      onOpen={() => onOpenTool(t.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function LatexToolsView() {
  const active = useHomeViewStore((s) => s.toolsOpen);
  const closeTools = useHomeViewStore((s) => s.closeTools);
  const goTo = useHomeViewStore((s) => s.goTo);
  const { dialogRef, onBackdropMouseDown } =
    useModalAccessibility<HTMLDivElement>(active, closeTools);
  const [search, setSearch] = useState("");
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close Oleafly Tools"
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="latex-tools-title"
        data-modal-initial-focus
        data-testid="latex-tools-view"
        className={cn(
          "relative flex h-[min(48rem,90vh)] w-[min(68rem,96vw)] flex-col overflow-hidden rounded-2xl text-foreground",
          WHITE_PANEL,
        )}
      >
        <div className="flex items-center gap-4 border-b px-6 py-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300">
            <ToolCase className="size-5" />
          </div>
          <div className="shrink-0">
            <div
              id="latex-tools-title"
              className="text-base font-bold tracking-tight"
            >
              Oleafly Tools
            </div>
            <p className="text-xs text-muted-foreground">
              Open a tool or use its slash command
            </p>
          </div>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${TOOL_DEFINITIONS.length} tools or slash commands`}
              className="h-10 pl-8 text-sm"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={closeTools}
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </div>
        <ToolsGallery
          search={search}
          onOpenTool={(id) => {
            closeTools();
            goTo(toolById(id).page);
          }}
        />
      </div>
    </div>
  );
}
