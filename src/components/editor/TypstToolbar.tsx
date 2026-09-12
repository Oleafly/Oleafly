import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
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

function TypstHeadingDropdown({ variant }: Readonly<{ variant: "bar" | "menu" }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <Popover
      ariaLabel={t(($) => $.editor.toolbar.headingLevel)}
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
            <span className="flex-1 text-left">{t(($) => $.editor.toolbar.heading)}</span>
            <ChevronDown className="size-3" />
          </>
        )
      }
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t(($) => $.editor.toolbar.heading)}
      </div>
      {TYPST_HEADING_LEVELS.map((level) => (
        <PopoverItem key={level.hLabel} onClick={() => insertTypstHeading(level)}>
          <span className="w-6 shrink-0 text-[10px] font-medium text-muted-foreground">{level.hLabel}</span>
          <span className={level.className}>{level.label()}</span>
        </PopoverItem>
      ))}
    </Popover>
  );
}

function TypstListDropdown({ variant }: Readonly<{ variant: "bar" | "menu" }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <Popover
      ariaLabel={t(($) => $.editor.toolbar.listType)}
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
            <span className="flex-1 text-left">{t(($) => $.editor.toolbar.list)}</span>
            <ChevronDown className="size-3" />
          </>
        )
      }
    >
      <PopoverItem onClick={insertTypstBulletList}>{t(($) => $.editor.toolbar.bulletedList)}</PopoverItem>
      <PopoverItem onClick={insertTypstNumberedList}>{t(($) => $.editor.toolbar.numberedList)}</PopoverItem>
    </Popover>
  );
}

/**
 * Formatting bar for Typst documents. Typst has no visual editing surface, so
 * this is source-only: every control writes Typst markup at the cursor.
 */
export function TypstToolbar() {
  const { t } = useTranslation(["common", "editor"]);
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
      btnControl(
        "bold",
        Bold,
        t(($) => $.editor.toolbar.bold),
        insertTypstBold,
        t(($) => $.editor.toolbar.boldWithShortcut, { shortcut: shortcut("⌘B") }),
      ),
      btnControl(
        "italic",
        Italic,
        t(($) => $.editor.toolbar.italic),
        insertTypstItalic,
        t(($) => $.editor.toolbar.italicWithShortcut, { shortcut: shortcut("⌘I") }),
      ),
      btnControl("underline", Underline, t(($) => $.editor.toolbar.underline), insertTypstUnderline),
      btnControl(
        "strikethrough",
        Strikethrough,
        t(($) => $.editor.toolbar.strikethrough),
        insertTypstStrikethrough,
      ),
      btnControl("code", Code, t(($) => $.editor.toolbar.inlineCode), insertTypstRawInline),
      dividerControl("divider-2"),
      btnControl("math", Sigma, t(($) => $.editor.toolbar.math), insertTypstMath),
      btnControl("link", LinkIcon, t(($) => $.editor.toolbar.insertLink), insertTypstLink),
      btnControl("reference", AtSign, t(($) => $.editor.toolbar.referenceALabel), insertTypstReference),
      dividerControl("divider-3"),
      btnControl("image", ImageIcon, t(($) => $.editor.toolbar.insertImage), insertTypstImage),
      btnControl("code-block", SquareCode, t(($) => $.editor.toolbar.codeBlock), insertTypstCodeBlock),
    ];
  }, [t]);

  const { containerRef, availableWidth } = useAvailableWidth();
  const visibleCount = fitCount(controls, availableWidth);
  const visibleControls = controls.slice(0, visibleCount);
  const overflowControls = controls.slice(visibleCount);

  return (
    <div className="flex h-9 items-center gap-0.5 border-b px-2">
      <IconBtn onClick={editorUndo} title={t(($) => $.editor.toolbar.undo, { shortcut: shortcut("⌘Z") })}>
        <Undo2 className="size-4" />
      </IconBtn>
      <IconBtn onClick={editorRedo} title={t(($) => $.editor.toolbar.redo, { shortcut: shortcut("⌘⇧Z") })}>
        <Redo2 className="size-4" />
      </IconBtn>

      <Divider />

      <div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {visibleControls.map((control) => (
          <Fragment key={control.id}>{control.render()}</Fragment>
        ))}
        {overflowControls.length > 0 && (
          <Popover
            ariaLabel={t(($) => $.editor.toolbar.moreOptions)}
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
        <IconBtn onClick={editorFind} title={t(($) => $.editor.toolbar.find, { shortcut: shortcut("⌘F") })}>
          <Search className="size-4" />
        </IconBtn>
      </div>
    </div>
  );
}
