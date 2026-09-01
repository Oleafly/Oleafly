import { Fragment, useMemo } from "react";
import {
  AtSign,
  Bold,
  ChevronDown,
  Code,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  MoreHorizontal,
  Redo2,
  Search,
  Sigma,
  SquareCode,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { Popover, PopoverItem } from "@/components/ui/popover";
import {
  Divider,
  IconBtn,
  btnControl,
  dividerControl,
} from "@/components/editor/EditorToolbar";
import { ProjectInfoButton } from "@/components/editor/ProjectInfo";
import {
  DROPDOWN_TRIGGER_WIDTH,
  fitCount,
  useAvailableWidth,
  type ToolbarControl,
} from "@/components/ui/toolbar-overflow";
import { editorFind, editorRedo, editorUndo } from "@/components/editor/cm/controller";
import {
  TYPST_HEADING_LEVELS,
  insertTypstBold,
  insertTypstBulletList,
  insertTypstCodeBlock,
  insertTypstHeading,
  insertTypstImage,
  insertTypstItalic,
  insertTypstLink,
  insertTypstMath,
  insertTypstNumberedList,
  insertTypstRawInline,
  insertTypstReference,
  insertTypstStrikethrough,
  insertTypstUnderline,
} from "@/components/editor/typst-commands";
import { shortcut } from "@/lib/utils";

function TypstHeadingDropdown({ variant }: { variant: "bar" | "menu" }) {
  return (
    <Popover
      ariaLabel="Heading level"
      className="w-fit min-w-0 max-w-56"
      triggerClassName={
        variant === "bar" ? "gap-0.5 px-1.5" : "w-full justify-start gap-2 px-2 font-normal"
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
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Heading</div>
      {TYPST_HEADING_LEVELS.map((level) => (
        <PopoverItem key={level.label} onClick={() => insertTypstHeading(level)}>
          <span className="w-6 shrink-0 text-[10px] font-medium text-muted-foreground">{level.hLabel}</span>
          <span className={level.className}>{level.label}</span>
        </PopoverItem>
      ))}
    </Popover>
  );
}

function TypstListDropdown({ variant }: { variant: "bar" | "menu" }) {
  return (
    <Popover
      ariaLabel="List type"
      className="w-fit min-w-0 max-w-56"
      triggerClassName={
        variant === "bar" ? "gap-0.5 px-1.5" : "w-full justify-start gap-2 px-2 font-normal"
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
      <PopoverItem onClick={insertTypstBulletList}>Bulleted list</PopoverItem>
      <PopoverItem onClick={insertTypstNumberedList}>Numbered list</PopoverItem>
    </Popover>
  );
}

/**
 * Formatting bar for Typst documents. Typst has no visual editing surface, so
 * this is source-only: every control writes Typst markup at the cursor.
 */
export function TypstToolbar() {
  const controls = useMemo<ToolbarControl[]>(() => {
    return [
      {
        id: "heading",
        width: DROPDOWN_TRIGGER_WIDTH,
        render: () => <TypstHeadingDropdown variant="bar" />,
        renderMenu: () => <TypstHeadingDropdown key="heading" variant="menu" />,
      },
      {
        id: "list",
        width: DROPDOWN_TRIGGER_WIDTH,
        render: () => <TypstListDropdown variant="bar" />,
        renderMenu: () => <TypstListDropdown key="list" variant="menu" />,
      },
      dividerControl("divider-1"),
      btnControl("bold", Bold, "Bold", insertTypstBold, `Bold (${shortcut("⌘B")})`),
      btnControl("italic", Italic, "Italic", insertTypstItalic, `Italic (${shortcut("⌘I")})`),
      btnControl("underline", Underline, "Underline", insertTypstUnderline),
      btnControl("strikethrough", Strikethrough, "Strikethrough", insertTypstStrikethrough),
      btnControl("code", Code, "Inline code", insertTypstRawInline),
      dividerControl("divider-2"),
      btnControl("math", Sigma, "Math", insertTypstMath),
      btnControl("link", LinkIcon, "Insert link", insertTypstLink),
      btnControl("reference", AtSign, "Reference a label", insertTypstReference),
      dividerControl("divider-3"),
      btnControl("image", ImageIcon, "Insert image", insertTypstImage),
      btnControl("code-block", SquareCode, "Code block", insertTypstCodeBlock),
    ];
  }, []);

  const { containerRef, availableWidth } = useAvailableWidth();
  const visibleCount = fitCount(controls, availableWidth);
  const visibleControls = controls.slice(0, visibleCount);
  const overflowControls = controls.slice(visibleCount);

  return (
    <div className="flex h-9 items-center gap-0.5 border-b px-2">
      <IconBtn onClick={editorUndo} title={`Undo (${shortcut("⌘Z")})`}>
        <Undo2 className="size-4" />
      </IconBtn>
      <IconBtn onClick={editorRedo} title={`Redo (${shortcut("⌘⇧Z")})`}>
        <Redo2 className="size-4" />
      </IconBtn>

      <Divider />

      <div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
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
        <ProjectInfoButton surface="source" />
        <IconBtn onClick={editorFind} title={`Find (${shortcut("⌘F")})`}>
          <Search className="size-4" />
        </IconBtn>
      </div>
    </div>
  );
}
