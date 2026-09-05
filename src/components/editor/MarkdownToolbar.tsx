import { Fragment, useMemo, useState } from "react";
import {
  Bold,
  ChevronDown,
  Code,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  MoreHorizontal,
  Quote,
  Search,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Type,
  Underline,
  Undo2,
  Redo2,
} from "lucide-react";
import { Popover, PopoverItem } from "@/components/ui/popover";
// The chrome is shared with the LaTeX toolbar so both bars measure, overflow,
// and sit in the editor frame identically.
import {
  Divider,
  IconBtn,
  MenuRow,
  WysiwygModeSwitch,
  btnControl,
  dividerControl,
} from "@/components/editor/EditorToolbar";
import { ProjectInfoButton } from "@/components/editor/ProjectInfo";
import {
  DROPDOWN_TRIGGER_WIDTH,
  ICON_BUTTON_WIDTH,
  fitCount,
  useAvailableWidth,
  type ToolbarControl,
} from "@/components/ui/toolbar-overflow";
import { editorFind, editorRedo, editorUndo } from "@/components/editor/cm/controller";
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
import { shortcut } from "@/lib/utils";

function MarkdownHeadingDropdown({ variant }: { variant: "bar" | "menu" }) {
  return (
    <Popover
      ariaLabel="Heading level"
      className="w-auto min-w-0"
      triggerClassName={
        variant === "bar"
          ? "gap-0.5 px-1.5"
          : "w-full justify-start gap-2 px-2 font-normal"
      }
      trigger={
        variant === "bar" ? (
          <>
            <Type className="size-4" />
            <ChevronDown className="size-3" />
          </>
        ) : (
          <>
            <Type className="size-4" />
            <span className="flex-1 text-left">Heading</span>
            <ChevronDown className="size-3" />
          </>
        )
      }
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Heading
      </div>
      {MARKDOWN_HEADING_LEVELS.map((level) => (
        <PopoverItem
          key={level.label}
          onClick={() => insertMarkdownHeading(level)}
        >
          <span className="w-6 shrink-0 text-[10px] font-medium text-muted-foreground">
            {level.hLabel}
          </span>
          <span className={level.className}>{level.label}</span>
        </PopoverItem>
      ))}
    </Popover>
  );
}

/**
 * Visual mode has no text template to edit, so link and image take their
 * target from a small popover. Enter applies, an empty link removes the link.
 */
function TargetPopover({
  icon,
  label,
  placeholder,
  initialValue,
  onApply,
  removeLabel,
  menuRow,
}: {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  initialValue?: () => string;
  onApply: (value: string) => void;
  removeLabel?: string;
  menuRow?: boolean;
}) {
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
            className="h-8 rounded-md border bg-background px-2 text-sm font-normal text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
            Apply
          </button>
        </div>
      </form>
    </Popover>
  );
}

function MarkdownListDropdown({ variant }: { variant: "bar" | "menu" }) {
  return (
    <Popover
      ariaLabel="List type"
      className="w-auto min-w-0"
      triggerClassName={
        variant === "bar"
          ? "gap-0.5 px-1.5"
          : "w-full justify-start gap-2 px-2 font-normal"
      }
      trigger={
        variant === "bar" ? (
          <>
            <List className="size-4" />
            <ChevronDown className="size-3" />
          </>
        ) : (
          <>
            <List className="size-4" />
            <span className="flex-1 text-left">List</span>
            <ChevronDown className="size-3" />
          </>
        )
      }
    >
      <PopoverItem onClick={insertMarkdownBulletList}>Bulleted list</PopoverItem>
      <PopoverItem onClick={insertMarkdownOrderedList}>Numbered list</PopoverItem>
      <PopoverItem onClick={insertMarkdownTaskList}>Task list</PopoverItem>
    </Popover>
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
  showVisualToggle = true,
  showProjectInfo = true,
}: {
  wysiwyg: boolean;
  onToggleWysiwyg: () => void;
  showVisualToggle?: boolean;
  /** Project statistics describe the compiled document, so hide them for stray .md files in other projects. */
  showProjectInfo?: boolean;
}) {
  const controls = useMemo<ToolbarControl[]>(() => {
    const list: ToolbarControl[] = [
      {
        id: "heading",
        width: DROPDOWN_TRIGGER_WIDTH,
        render: () => <MarkdownHeadingDropdown variant="bar" />,
        renderMenu: () => (
          <MarkdownHeadingDropdown key="heading" variant="menu" />
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
        "Blockquote",
        insertMarkdownBlockquote,
        "Insert blockquote",
      ),
      dividerControl("divider-1"),
      btnControl(
        "bold",
        Bold,
        "Bold",
        insertMarkdownBold,
        `Bold (${shortcut("⌘B")})`,
      ),
      btnControl(
        "italic",
        Italic,
        "Italic",
        insertMarkdownItalic,
        `Italic (${shortcut("⌘I")})`,
      ),
      btnControl(
        "strikethrough",
        Strikethrough,
        "Strikethrough",
        insertMarkdownStrikethrough,
      ),
      btnControl("code", Code, "Inline code", insertMarkdownCode),
    ];

    if (!wysiwyg) {
      list.push(
        btnControl("underline", Underline, "Underline", insertMarkdownUnderline),
        btnControl(
          "highlight",
          Highlighter,
          "Highlight",
          insertMarkdownHighlight,
        ),
      );
    }

    if (wysiwyg) {
      list.push({
        id: "link",
        width: ICON_BUTTON_WIDTH,
        render: () => (
          <TargetPopover
            icon={<LinkIcon className="size-4" />}
            label="Link URL"
            placeholder="https://"
            initialValue={() => currentMarkdownLinkHref() ?? ""}
            onApply={insertMarkdownLink}
            removeLabel="Remove link"
          />
        ),
        renderMenu: () => (
          <TargetPopover
            key="link"
            menuRow
            icon={<LinkIcon className="size-4" />}
            label="Link URL"
            placeholder="https://"
            initialValue={() => currentMarkdownLinkHref() ?? ""}
            onApply={insertMarkdownLink}
            removeLabel="Remove link"
          />
        ),
      });
    } else {
      list.push(btnControl("link", LinkIcon, "Insert link", () => insertMarkdownLink()));
    }

    if (!wysiwyg) {
      list.push(
        dividerControl("divider-2"),
        btnControl(
          "superscript",
          Superscript,
          "Superscript",
          insertMarkdownSuperscript,
        ),
        btnControl(
          "subscript",
          Subscript,
          "Subscript",
          insertMarkdownSubscript,
        ),
      );
    }

    list.push(
      dividerControl("divider-3"),
      wysiwyg
        ? {
            id: "image",
            width: ICON_BUTTON_WIDTH,
            render: () => (
              <TargetPopover
                icon={<ImageIcon className="size-4" />}
                label="Image file"
                placeholder="figures/plot.png"
                onApply={insertMarkdownImage}
              />
            ),
            renderMenu: () => (
              <TargetPopover
                key="image"
                menuRow
                icon={<ImageIcon className="size-4" />}
                label="Image file"
                placeholder="figures/plot.png"
                onApply={insertMarkdownImage}
              />
            ),
          }
        : btnControl("image", ImageIcon, "Insert image", () => insertMarkdownImage()),
      {
        id: "table",
        width: ICON_BUTTON_WIDTH,
        render: () => (
          <IconBtn
            onClick={() => insertMarkdownTable(2, 3)}
            title="Insert table"
          >
            <Table className="size-4" />
          </IconBtn>
        ),
        renderMenu: () => (
          <MenuRow
            key="table"
            icon={<Table className="size-4" />}
            label="Insert table"
            onClick={() => insertMarkdownTable(2, 3)}
          />
        ),
      },
    );

    return list;
  }, [wysiwyg]);

  const { containerRef, availableWidth } = useAvailableWidth();
  const visibleCount = fitCount(controls, availableWidth);
  const visibleControls = controls.slice(0, visibleCount);
  const overflowControls = controls.slice(visibleCount);

  return (
    <div className="flex h-9 items-center gap-0.5 border-b px-2">
      {showVisualToggle && (
        <>
          <WysiwygModeSwitch
            wysiwyg={wysiwyg}
            onToggle={onToggleWysiwyg}
            data-tour="wysiwyg-toggle"
          />
          <Divider />
        </>
      )}

      <IconBtn onClick={editorUndo} title={`Undo (${shortcut("⌘Z")})`}>
        <Undo2 className="size-4" />
      </IconBtn>
      <IconBtn onClick={editorRedo} title={`Redo (${shortcut("⌘⇧Z")})`}>
        <Redo2 className="size-4" />
      </IconBtn>

      <Divider />

      <div
        ref={containerRef}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
      >
        {visibleControls.map((control) => (
          <Fragment key={control.id}>{control.render()}</Fragment>
        ))}
        {overflowControls.length > 0 && (
          <Popover
            ariaLabel="More formatting options"
            closeOnClick={false}
            className="max-h-96 w-56 overflow-y-auto p-1"
            trigger={<MoreHorizontal className="size-4" />}
          >
            {overflowControls.map((control) => control.renderMenu())}
          </Popover>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {showProjectInfo && <ProjectInfoButton surface={wysiwyg ? "visual" : "source"} />}
        {!wysiwyg && (
          <IconBtn onClick={editorFind} title={`Find (${shortcut("⌘F")})`}>
            <Search className="size-4" />
          </IconBtn>
        )}
      </div>
    </div>
  );
}
