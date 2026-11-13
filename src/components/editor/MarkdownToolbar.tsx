import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bold,
  Code,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  PenTool,
  Quote,
  ScanSearch,
  Search,
  SlidersHorizontal,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Underline,
  Undo2,
  Redo2,
} from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { isQuartoEngine } from "@/lib/notebook-engines";
import type { MarkdownSplitLayout } from "@/lib/wysiwyg-mode";
import {
  Divider,
  HeadingDropdown,
  IconBtn,
  WysiwygModeSwitch,
  type EditorMode,
  btnControl,
  dividerControl,
} from "@/components/editor/EditorToolbar";
import { ProjectInfoButton } from "@/components/editor/ProjectInfo";
import {
  DROPDOWN_TRIGGER_WIDTH,
  ICON_BUTTON_WIDTH,
  type ToolbarControl,
  ToolbarDropdown,
  ToolbarOverflow,
  toolbarPicker,
} from "@/components/ui/toolbar-overflow";
import { editorFind, editorRedo, editorUndo } from "@/components/editor/cm/controller";
import { useEditorHistory } from "@/components/editor/history-signal";
import {
  MARKDOWN_HEADING_LEVELS,
  currentMarkdownLinkHref,
  insertMarkdownBlockquote,
  insertMarkdownBold,
  insertMarkdownBulletList,
  insertMarkdownCode,
  insertMarkdownHeading,
  insertMarkdownHighlight,
  insertMarkdownImage,
  insertMarkdownItalic,
  insertMarkdownLink,
  insertMarkdownOrderedList,
  insertMarkdownStrikethrough,
  insertMarkdownSubscript,
  insertMarkdownSuperscript,
  insertMarkdownTable,
  insertMarkdownTaskList,
  insertMarkdownUnderline,
} from "@/components/editor/markdown-commands";
import { openDiagramComposer } from "@/features/open-tool";
import { cn, shortcut } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";

function TargetPopover({
  icon,
  label,
  placeholder,
  initialValue,
  onApply,
  removeLabel,
  menuRow,
}: Readonly<{
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  initialValue?: () => string;
  onApply: (value: string) => void;
  removeLabel?: string;
  menuRow?: boolean;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const [value, setValue] = useState("");
  return (
    <Popover
      ariaLabel={label}
      closeOnClick={false}
      className="w-72 p-2"
      onOpenChange={(open) => {
        if (open) setValue(initialValue?.() ?? "");
      }}
      trigger={
        menuRow ? (
          <span className="flex items-center gap-2 text-sm">
            {icon}
            {label}
          </span>
        ) : (
          icon
        )
      }
      triggerClassName={menuRow ? "w-full justify-start px-2 py-1.5" : undefined}
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onApply(value);
          (event.currentTarget.closest("[data-radix-popper-content-wrapper]") as HTMLElement | null)
            ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {label}
          <input
            ref={(node) => node?.focus()}
            aria-label={label}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            className="h-8 rounded-md border bg-background px-2 text-sm font-normal text-foreground"
          />
        </label>
        <div className="flex justify-end gap-1">
          {removeLabel && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                onApply("");
              }}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {removeLabel}
            </button>
          )}
          <button
            type="submit"
            className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          >
            {t(($) => $.editor.toolbar.apply)}
          </button>
        </div>
      </form>
    </Popover>
  );
}

function MarkdownListDropdown({ variant }: Readonly<{ variant: "bar" | "menu" }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <ToolbarDropdown
      variant={variant}
      icon={List}
      label={t(($) => $.editor.toolbar.list)}
      ariaLabel={t(($) => $.editor.toolbar.listType)}
      className="w-auto min-w-0"
      items={[
        { key: "bullet", onSelect: insertMarkdownBulletList, content: t(($) => $.editor.toolbar.bulletedList) },
        { key: "ordered", onSelect: insertMarkdownOrderedList, content: t(($) => $.editor.toolbar.numberedList) },
        { key: "task", onSelect: insertMarkdownTaskList, content: t(($) => $.editor.toolbar.taskList) },
      ]}
    />
  );
}

/**
 * Formatting bar for Markdown documents.
 *
 * Underline, highlight, superscript and subscript are Pandoc-Markdown syntax
 * with no mark in the Visual schema, so they appear only in Source mode rather
 * than writing literal syntax into a rich-text document.
 */
export function MarkdownToolbar({
  wysiwyg,
  onToggleWysiwyg,
  mode,
  splitLayout,
  onModeChange,
  showProjectInfo = true,
}: Readonly<{
  wysiwyg: boolean;
  onToggleWysiwyg?: () => void;
  mode?: EditorMode;
  splitLayout?: MarkdownSplitLayout;
  onModeChange?: (mode: EditorMode, layout?: MarkdownSplitLayout) => void;
  showProjectInfo?: boolean;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const markdownProject = useFilesStore((state) => state.engineLoaded && state.engine.source_format === "markdown");
  const markdownSettings = useFilesStore((state) => !isQuartoEngine(state.engine));
  const controls = useMemo<ToolbarControl[]>(() => {
    const list: ToolbarControl[] = [
      {
        id: "heading",
        width: DROPDOWN_TRIGGER_WIDTH,
        render: () => <HeadingDropdown variant="bar" levels={MARKDOWN_HEADING_LEVELS} insert={insertMarkdownHeading} />,
        renderMenu: () => (
          <HeadingDropdown key="heading" variant="menu" levels={MARKDOWN_HEADING_LEVELS} insert={insertMarkdownHeading} />
        ),
      },
      {
        id: "list",
        width: DROPDOWN_TRIGGER_WIDTH,
        render: () => <MarkdownListDropdown variant="bar" />,
        renderMenu: () => <MarkdownListDropdown key="list" variant="menu" />,
      },
      btnControl(
        "blockquote",
        Quote,
        t(($) => $.editor.toolbar.blockquote),
        insertMarkdownBlockquote,
        t(($) => $.editor.toolbar.insertBlockquote),
      ),
      dividerControl("divider-1"),
      btnControl(
        "bold",
        Bold,
        t(($) => $.editor.toolbar.bold),
        insertMarkdownBold,
        t(($) => $.editor.toolbar.boldWithShortcut, { shortcut: shortcut("⌘B") }),
      ),
      btnControl(
        "italic",
        Italic,
        t(($) => $.editor.toolbar.italic),
        insertMarkdownItalic,
        t(($) => $.editor.toolbar.italicWithShortcut, { shortcut: shortcut("⌘I") }),
      ),
      btnControl(
        "strikethrough",
        Strikethrough,
        t(($) => $.editor.toolbar.strikethrough),
        insertMarkdownStrikethrough,
      ),
      btnControl("code", Code, t(($) => $.editor.toolbar.inlineCode), insertMarkdownCode),
    ];

    if (!wysiwyg) {
      list.push(
        btnControl("underline", Underline, t(($) => $.editor.toolbar.underline), insertMarkdownUnderline),
        btnControl(
          "highlight",
          Highlighter,
          t(($) => $.editor.toolbar.highlight),
          insertMarkdownHighlight,
        ),
      );
    }

    if (wysiwyg) {
      list.push(
        toolbarPicker("link", ICON_BUTTON_WIDTH, (menuRow) => (
          <TargetPopover
            menuRow={menuRow}
            icon={<LinkIcon className="size-4" />}
            label={t(($) => $.editor.toolbar.linkUrl)}
            placeholder={t(($) => $.editor.toolbar.linkPlaceholder)}
            initialValue={() => currentMarkdownLinkHref() ?? ""}
            onApply={insertMarkdownLink}
            removeLabel={t(($) => $.editor.toolbar.removeLink)}
          />
        )),
      );
    } else {
      list.push(
        btnControl("link", LinkIcon, t(($) => $.editor.toolbar.insertLink), () => insertMarkdownLink()),
      );
    }

    if (!wysiwyg) {
      list.push(
        dividerControl("divider-2"),
        btnControl(
          "superscript",
          Superscript,
          t(($) => $.editor.toolbar.superscript),
          insertMarkdownSuperscript,
        ),
        btnControl(
          "subscript",
          Subscript,
          t(($) => $.editor.toolbar.subscript),
          insertMarkdownSubscript,
        ),
      );
    }

    list.push(
      dividerControl("divider-3"),
      wysiwyg
        ? toolbarPicker("image", ICON_BUTTON_WIDTH, (menuRow) => (
            <TargetPopover
              menuRow={menuRow}
              icon={<ImageIcon className="size-4" />}
              label={t(($) => $.editor.toolbar.imageFile)}
              placeholder={t(($) => $.editor.toolbar.imagePlaceholder)}
              onApply={insertMarkdownImage}
            />
          ))
        : btnControl("image", ImageIcon, t(($) => $.editor.toolbar.insertImage), () =>
            insertMarkdownImage(),
          ),
      btnControl("table", Table, t(($) => $.editor.toolbar.insertTable), () => insertMarkdownTable(2, 3)),
      btnControl("diagram", PenTool, t(($) => $.editor.toolbar.drawDiagram), () => void openDiagramComposer("mermaid")),
    );

    return list;
  }, [t, wysiwyg]);

  const history = useEditorHistory(wysiwyg);

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-0.5 gap-y-1 overflow-x-auto border-b px-2">
      {onToggleWysiwyg ? (
        <WysiwygModeSwitch
          wysiwyg={wysiwyg}
          onToggle={onToggleWysiwyg}
          mode={mode}
          splitLayout={splitLayout}
          onModeChange={onModeChange}
          data-tour="wysiwyg-toggle"
        />
      ) : null}
      <div className={cn("flex flex-1 items-center gap-0.5", showProjectInfo ? "min-w-44" : "min-w-36")}>
        {onToggleWysiwyg ? <Divider /> : null}
        <IconBtn onClick={editorUndo} disabled={!history.canUndo} title={t(($) => $.editor.toolbar.undo, { shortcut: shortcut("⌘Z") })}>
          <Undo2 className="size-4" />
        </IconBtn>
        <IconBtn onClick={editorRedo} disabled={!history.canRedo} title={t(($) => $.editor.toolbar.redo, { shortcut: shortcut("⌘⇧Z") })}>
          <Redo2 className="size-4" />
        </IconBtn>

        <Divider />

        <ToolbarOverflow controls={controls} label={t(($) => $.editor.toolbar.moreOptions)} />

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {markdownProject && (
            <IconBtn
              onClick={() => useTypstDocumentPanelStore.getState().openPanel("insights")}
              title={t(($) => $.editor.typstInsights.title)}
            >
              <ScanSearch data-testid="document-insights-button" className="size-4" />
            </IconBtn>
          )}
          {markdownProject && markdownSettings && (
            <IconBtn
              onClick={() => useTypstDocumentPanelStore.getState().openPanel("settings")}
              title={t(($) => $.editor.typstSettings.title)}
            >
              <SlidersHorizontal data-testid="document-settings-button" className="size-4" />
            </IconBtn>
          )}
          {showProjectInfo && <ProjectInfoButton surface={wysiwyg ? "visual" : "source"} />}
          {!wysiwyg && (
            <IconBtn onClick={editorFind} title={t(($) => $.editor.toolbar.find, { shortcut: shortcut("⌘F") })}>
              <Search className="size-4" />
            </IconBtn>
          )}
        </div>
      </div>
    </div>
  );
}
