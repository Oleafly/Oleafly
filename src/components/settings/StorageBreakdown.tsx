import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/format-bytes";
import { formatNumber } from "@/lib/intl";
import type { LibraryStorageSummary } from "@/lib/tauri";
import { cn } from "@/lib/utils";

type PartId =
  | "documents"
  | "images"
  | "pdfs"
  | "media"
  | "data"
  | "otherFiles"
  | "git"
  | "build"
  | "texDistribution"
  | "agents"
  | "researchTasks"
  | "tools"
  | "checkpoints"
  | "compileCache"
  | "otherAppData"
  | "recycleBin"
  | "linkedFolders";

type GroupId = "projects" | "appData" | "elsewhere";

interface Part {
  id: PartId;
  bytes: number;
}

const COLORED: readonly PartId[] = [
  "documents",
  "images",
  "pdfs",
  "git",
  "build",
  "texDistribution",
  "agents",
];

const COLOR: Partial<Record<PartId, string>> = {
  documents: "bg-[#2a78d6] dark:bg-[#3987e5]",
  images: "bg-[#eb6834] dark:bg-[#d95926]",
  pdfs: "bg-[#1baf7a] dark:bg-[#199e70]",
  git: "bg-[#eda100] dark:bg-[#c98500]",
  build: "bg-[#e87ba4] dark:bg-[#d55181]",
  texDistribution: "bg-[#008300]",
  agents: "bg-[#4a3aa7] dark:bg-[#9085e9]",
};

const OTHER_COLOR = "bg-muted-foreground/40";

function colorOf(id: PartId): string {
  return COLOR[id] ?? OTHER_COLOR;
}

function groupsOf(summary: LibraryStorageSummary): { id: GroupId; parts: Part[] }[] {
  const appParts = [
    summary.tex_distribution_bytes,
    summary.agents_bytes,
    summary.research_tasks_bytes,
    summary.tools_bytes,
    summary.checkpoints_bytes,
    summary.compile_cache_bytes,
  ];
  const otherAppData = Math.max(
    0,
    summary.app_data_bytes - appParts.reduce((sum, bytes) => sum + bytes, 0),
  );
  return [
    {
      id: "projects",
      parts: [
        { id: "documents", bytes: summary.document_bytes },
        { id: "images", bytes: summary.image_bytes },
        { id: "pdfs", bytes: summary.pdf_bytes },
        { id: "media", bytes: summary.media_bytes },
        { id: "data", bytes: summary.data_bytes },
        { id: "otherFiles", bytes: summary.other_project_bytes },
        { id: "git", bytes: summary.git_bytes },
        { id: "build", bytes: summary.build_bytes },
      ],
    },
    {
      id: "appData",
      parts: [
        { id: "texDistribution", bytes: summary.tex_distribution_bytes },
        { id: "agents", bytes: summary.agents_bytes },
        { id: "researchTasks", bytes: summary.research_tasks_bytes },
        { id: "tools", bytes: summary.tools_bytes },
        { id: "checkpoints", bytes: summary.checkpoints_bytes },
        { id: "compileCache", bytes: summary.compile_cache_bytes },
        { id: "otherAppData", bytes: otherAppData },
      ],
    },
    {
      id: "elsewhere",
      parts: [
        { id: "recycleBin", bytes: summary.recycle_bin_bytes },
        { id: "linkedFolders", bytes: summary.linked_folders_bytes },
      ],
    },
  ];
}

export function StorageBreakdown({ summary }: Readonly<{ summary: LibraryStorageSummary }>) {
  const { t } = useTranslation(["shell"]);
  const total = summary.total_bytes;
  if (total <= 0) return null;

  const groups = groupsOf(summary).map((group) => ({
    ...group,
    parts: group.parts.filter((part) => part.bytes > 0),
  }));
  const parts = groups.flatMap((group) => group.parts);
  const colored = COLORED.map((id) => parts.find((part) => part.id === id)).filter(
    (part): part is Part => part !== undefined,
  );
  const other = parts
    .filter((part) => !COLORED.includes(part.id))
    .reduce((sum, part) => sum + part.bytes, 0);

  const label = (id: PartId) => t(($) => $.shell.settings.data.storage.parts[id]);
  const groupLabel = (id: GroupId) => t(($) => $.shell.settings.data.storage.groups[id]);
  const share = (bytes: number) =>
    formatNumber(bytes / total, { style: "percent", maximumFractionDigits: bytes / total < 0.01 ? 1 : 0 });
  const segments = [
    ...colored.map((part) => ({ id: part.id as PartId | "other", bytes: part.bytes, name: label(part.id) })),
    ...(other > 0
      ? [{ id: "other" as const, bytes: other, name: t(($) => $.shell.settings.data.storage.other) }]
      : []),
  ];

  return (
    <div className="space-y-3 border-t px-4 py-3" data-testid="storage-breakdown">
      <div aria-hidden className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {segments.map((segment) => (
          <div
            key={segment.id}
            data-part={segment.id}
            className="flex h-full min-w-0.5"
            style={{ flexGrow: segment.bytes / total, flexBasis: 0 }}
          >
            <Tooltip
              label={`${segment.name} · ${formatBytes(segment.bytes)} · ${share(segment.bytes)}`}
              side="top"
              className="h-full w-full"
            >
              <span
                className={cn(
                  "block h-full w-full",
                  segment.id === "other" ? OTHER_COLOR : colorOf(segment.id),
                )}
              />
            </Tooltip>
          </div>
        ))}
      </div>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {groups
          .filter((group) => group.parts.length > 0)
          .map((group) => (
            <section key={group.id} aria-labelledby={`storage-group-${group.id}`} className="min-w-0">
              <h4
                id={`storage-group-${group.id}`}
                className="mb-1 flex items-baseline justify-between gap-2 text-xs font-medium text-foreground"
              >
                <span className="truncate">{groupLabel(group.id)}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatBytes(group.parts.reduce((sum, part) => sum + part.bytes, 0))}
                </span>
              </h4>
              <ul className="space-y-0.5">
                {group.parts.map((part) => (
                  <li key={part.id} data-part={part.id} className="flex items-center gap-2 text-xs">
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", colorOf(part.id))} />
                    {part.id === "linkedFolders" ? (
                      <Tooltip
                        label={t(($) => $.shell.settings.data.storage.linkedFolders, {
                          count: summary.linked_folder_count,
                          size: formatBytes(part.bytes),
                        })}
                        side="top"
                        className="min-w-0 flex-1"
                      >
                        <span className="truncate text-muted-foreground">{label(part.id)}</span>
                      </Tooltip>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label(part.id)}</span>
                    )}
                    <span className="shrink-0 tabular-nums text-foreground">{formatBytes(part.bytes)}</span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                      {share(part.bytes)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  );
}
