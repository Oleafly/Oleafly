import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ArrowRightToLine,
  Asterisk,
  Bold,
  Braces,
  ChevronDown,
  Code,
  Divide,
  Image as ImageIcon,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  MoreHorizontal,
  Pencil,
  Quote,
  Redo2,
  Rows3,
  Search,
  SearchCode,
  Sigma,
  Tag,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { Popover, PopoverItem } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { editorFind, editorRedo, editorUndo, getEditorView } from "./cm/controller";
import {
  findWysiwygReferences,
  goToWysiwygDefinition,
  isWysiwygActive,
} from "./wysiwyg/controller";
import { goToDefinition, findReferences, startRename } from "@/lib/index/nav";
import { imageToLatex, imageToLatexAvailable } from "@/features/image-to-latex";
import { goToSyncTex } from "@/features/synctex";
import { ProjectInfoButton } from "@/components/editor/ProjectInfo";
import { useFilesStore } from "@/store/files";
import { runCiteOleaflyAction } from "@/features/cite-oleafly";
import { i18n } from "@/i18n";
import { cn, shortcut } from "@/lib/utils";
import {
  HEADING_LEVELS,
  insertAlign,
  insertBlockquote,
  insertBold,
  insertCode,
  insertEnumerate,
  insertEquation,
  insertFigure,
  insertFootnote,
  insertFraction,
  insertHeading,
  insertItalic,
  insertItemize,
  insertLink,
  insertRef,
  insertUnderline,
} from "@/components/editor/latex-commands";
import { SymbolPicker } from "@/components/editor/SymbolPicker";
import { TableSizePicker } from "@/components/editor/TableSizePicker";
import { ProjectCitationPicker } from "@/components/editor/ProjectCitationPicker";
import { toast } from "@/lib/toast";
import {
  DIVIDER_WIDTH,
  DROPDOWN_TRIGGER_WIDTH,
  ICON_BUTTON_WIDTH,
  fitCount,
  useAvailableWidth,
  type ToolbarControl,
} from "@/components/ui/toolbar-overflow";

function withProjectSymbol(
  sourceAction: (view: import("@codemirror/view").EditorView) => void,
  visualAction?: () => boolean,
) {
  if (isWysiwygActive()) {
    if (visualAction?.()) return;
    toast.info(
      visualAction
        ? i18n.t(($) => $.editor.toolbar.selectCitationFirst)
        : i18n.t(($) => $.editor.toolbar.renameSourceOnly),
    );
    return;
  }
  const v = getEditorView();
  if (v) sourceAction(v);
}

export function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

export function IconBtn({
  onClick,
  title,
  children,
  wide,
  "data-tour": dataTour,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  "data-tour"?: string;
}) {
  return (
    <Tooltip label={title} side="bottom">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        aria-label={title}
        data-tour={dataTour}
        className={cn(
          "flex h-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          wide ? "w-auto px-1.5" : "w-7"
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function WysiwygModeSwitch({
  wysiwyg,
  onToggle,
  secondLabel,
  "data-tour": dataTour,
}: {
  wysiwyg: boolean;
  onToggle: () => void;
  secondLabel?: string;
  "data-tour"?: string;
}) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <div
      data-tour={dataTour}
      className="flex h-7 shrink-0 items-center rounded-full bg-muted p-0.5 text-xs font-medium"
    >
      <button
        type="button"
        onClick={() => wysiwyg && onToggle()}
        aria-label={t(($) => $.editor.toolbar.switchToSource)}
        aria-pressed={!wysiwyg}
        className={cn(
          "rounded-full px-2.5 py-1 transition-colors",
          !wysiwyg ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {t(($) => $.editor.toolbar.code)}
      </button>
      <button
        type="button"
        onClick={() => !wysiwyg && onToggle()}
        aria-label={t(($) => $.editor.toolbar.switchToVisual)}
        aria-pressed={wysiwyg}
        className={cn(
          "rounded-full px-2.5 py-1 transition-colors",
          wysiwyg ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {secondLabel ?? t(($) => $.editor.toolbar.visual)}
      </button>
    </div>
  );
}

export function MenuRow({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}


export function btnControl(
  id: string,
  Icon: LucideIcon,
  label: string,
  onClick: () => void,
  tooltip?: string
): ToolbarControl {
  return {
    id,
    width: ICON_BUTTON_WIDTH,
    render: () => (
      <IconBtn onClick={onClick} title={tooltip ?? label}>
        <Icon className="size-4" />
      </IconBtn>
    ),
    renderMenu: () => <MenuRow key={id} icon={<Icon className="size-4" />} label={label} onClick={onClick} />,
  };
}

export function dividerControl(id: string): ToolbarControl {
  return {
    id,
    width: DIVIDER_WIDTH,
    render: () => <Divider />,
    renderMenu: () => null,
  };
}

function HeadingDropdown({ variant }: { variant: "bar" | "menu" }) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <Popover
      ariaLabel={t(($) => $.editor.toolbar.headingLevel)}
      className="w-fit min-w-0 max-w-56"
      triggerClassName={variant === "bar" ? "gap-0.5 px-1.5" : "w-full justify-start gap-2 px-2 font-normal"}
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
      {HEADING_LEVELS.map((level) => (
        <PopoverItem key={level.hLabel} onClick={() => insertHeading(level)}>
          <span className="w-6 shrink-0 text-[10px] font-medium text-muted-foreground">{level.hLabel}</span>
          <span className={level.className}>{level.label()}</span>
        </PopoverItem>
      ))}
    </Popover>
  );
}

function ListDropdown({ variant }: { variant: "bar" | "menu" }) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <Popover
      ariaLabel={t(($) => $.editor.toolbar.insertList)}
      triggerClassName={variant === "menu" ? "w-full justify-start gap-2 px-2 font-normal" : undefined}
      trigger={
        variant === "bar" ? (
          <List className="size-4" />
        ) : (
          <>
            <List className="size-4" />
            <span className="flex-1 text-left">{t(($) => $.editor.toolbar.list)}</span>
          </>
        )
      }
    >
      <PopoverItem onClick={insertItemize}>
        <List className="size-4" /> {t(($) => $.editor.toolbar.bulletedList)}
      </PopoverItem>
      <PopoverItem onClick={insertEnumerate}>
        <ListOrdered className="size-4" /> {t(($) => $.editor.toolbar.numberedList)}
      </PopoverItem>
    </Popover>
  );
}

function CodeIntelDropdown({ variant }: { variant: "bar" | "menu" }) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <Popover
      ariaLabel={t(($) => $.editor.toolbar.codeIntelligence)}
      triggerClassName={variant === "bar" ? "gap-0.5 px-1.5" : "w-full justify-start gap-2 px-2 font-normal"}
      trigger={
        variant === "bar" ? (
          <>
            <Braces className="size-4" />
            <ChevronDown className="size-3" />
          </>
        ) : (
          <>
            <Braces className="size-4" />
            <span className="flex-1 text-left">{t(($) => $.editor.toolbar.code)}</span>
            <ChevronDown className="size-3" />
          </>
        )
      }
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t(($) => $.editor.toolbar.code)}
      </div>
      <PopoverItem
        onClick={() =>
          withProjectSymbol(goToDefinition, goToWysiwygDefinition)
        }
      >
        <ArrowRightToLine className="size-4" /> {t(($) => $.editor.toolbar.goToDefinition)}
        <span className="ml-auto text-[10px] text-muted-foreground">{shortcut("F12")}</span>
      </PopoverItem>
      <PopoverItem
        onClick={() =>
          withProjectSymbol(findReferences, findWysiwygReferences)
        }
      >
        <SearchCode className="size-4" /> {t(($) => $.editor.toolbar.findReferences)}
        <span className="ml-auto text-[10px] text-muted-foreground">{shortcut("⇧F12")}</span>
      </PopoverItem>
      <PopoverItem onClick={() => withProjectSymbol(startRename)}>
        <Pencil className="size-4" /> {t(($) => $.editor.toolbar.renameSymbol)}
        <span className="ml-auto text-[10px] text-muted-foreground">{shortcut("F2")}</span>
      </PopoverItem>
    </Popover>
  );
}


export function EditorToolbar({
  wysiwyg,
  onToggleWysiwyg,
  showVisualToggle = true,
}: {
  wysiwyg: boolean;
  onToggleWysiwyg: () => void;
  showVisualToggle?: boolean;
}) {
  const { t } = useTranslation(["common", "editor"]);
  const [visionReady, setVisionReady] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const projectKind = useFilesStore((s) => s.projectKind);
  const activePath = useFilesStore((s) => s.activePath);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const engine = useFilesStore((s) => s.engine);
  const syncTexSupported =
    projectKind !== "image" && projectKind !== "diagram" && engineLoaded && engine.capabilities.supports_synctex;
  useEffect(() => {
    void imageToLatexAvailable().then(setVisionReady);
  }, []);

  const controls = useMemo<ToolbarControl[]>(() => {
    const list: ToolbarControl[] = [
      {
        id: "heading",
        width: DROPDOWN_TRIGGER_WIDTH,
        render: () => <HeadingDropdown variant="bar" />,
        renderMenu: () => <HeadingDropdown key="heading" variant="menu" />,
      },
      dividerControl("divider-1"),
      btnControl(
        "bold",
        Bold,
        t(($) => $.editor.toolbar.bold),
        insertBold,
        t(($) => $.editor.toolbar.boldWithShortcut, { shortcut: shortcut("⌘B") }),
      ),
      btnControl(
        "italic",
        Italic,
        t(($) => $.editor.toolbar.italic),
        insertItalic,
        t(($) => $.editor.toolbar.italicWithShortcut, { shortcut: shortcut("⌘I") }),
      ),
      btnControl("underline", Underline, t(($) => $.editor.toolbar.underline), insertUnderline),
      dividerControl("divider-2"),
      btnControl("code", Code, t(($) => $.editor.toolbar.inlineCode), insertCode),
      btnControl("link", LinkIcon, t(($) => $.editor.toolbar.insertLink), insertLink),
      {
        id: "cite",
        width: ICON_BUTTON_WIDTH,
        render: () => <ProjectCitationPicker variant="bar" />,
        renderMenu: () => (
          <ProjectCitationPicker key="cite" variant="menu" />
        ),
      },
      btnControl("ref", Tag, t(($) => $.editor.toolbar.insertCrossReference), insertRef),
      btnControl("footnote", Asterisk, t(($) => $.editor.toolbar.insertFootnote), insertFootnote),
      btnControl("blockquote", Quote, t(($) => $.editor.toolbar.insertBlockquote), insertBlockquote),
      dividerControl("divider-3"),
      btnControl("figure", ImageIcon, t(($) => $.editor.toolbar.insertFigure), insertFigure),
      {
        id: "table",
        width: ICON_BUTTON_WIDTH,
        render: () => <TableSizePicker />,
        renderMenu: () => <TableSizePicker key="table" menuRow />,
      },
    ];

    if (visionReady) {
      list.push({
        id: "image-to-latex",
        width: ICON_BUTTON_WIDTH,
        render: () => (
          <IconBtn
            onClick={() => imageInputRef.current?.click()}
            title={t(($) => $.editor.toolbar.imageToLatexTooltip)}
          >
            <ImagePlus data-testid="image-to-latex" className="size-4" />
          </IconBtn>
        ),
        renderMenu: () => (
          <MenuRow
            key="image-to-latex"
            icon={<ImagePlus className="size-4" />}
            label={t(($) => $.editor.toolbar.imageToLatex)}
            onClick={() => imageInputRef.current?.click()}
          />
        ),
      });
    }

    list.push(
      dividerControl("divider-4"),
      {
        id: "list",
        width: ICON_BUTTON_WIDTH,
        render: () => <ListDropdown variant="bar" />,
        renderMenu: () => <ListDropdown key="list" variant="menu" />,
      },
      btnControl(
        "align",
        Rows3,
        t(($) => $.editor.toolbar.alignEnvironment),
        insertAlign,
        t(($) => $.editor.toolbar.insertAlignEnvironment),
      ),
      btnControl(
        "equation",
        Sigma,
        t(($) => $.editor.toolbar.equationEnvironment),
        insertEquation,
        t(($) => $.editor.toolbar.insertEquationEnvironment),
      ),
      btnControl(
        "fraction",
        Divide,
        t(($) => $.editor.toolbar.fraction),
        insertFraction,
        t(($) => $.editor.toolbar.insertFraction),
      ),
      dividerControl("divider-5"),
      {
        id: "symbols",
        width: ICON_BUTTON_WIDTH,
        render: () => <SymbolPicker />,
        renderMenu: () => <SymbolPicker key="symbols" menuRow />,
      },
    );
    if (!wysiwyg) {
      list.push({
        id: "code-intel",
        width: DROPDOWN_TRIGGER_WIDTH,
        render: () => <CodeIntelDropdown variant="bar" />,
        renderMenu: () => <CodeIntelDropdown key="code-intel" variant="menu" />,
      });
    }

    return list;
  }, [t, visionReady, wysiwyg]);

  const { containerRef, availableWidth } = useAvailableWidth();
  const visibleCount = fitCount(controls, availableWidth);
  const visibleControls = controls.slice(0, visibleCount);
  const overflowControls = controls.slice(visibleCount);

  return (
    <div data-testid="editor-toolbar" className="flex h-9 items-center gap-0.5 border-b px-2">
      {showVisualToggle && (
        <>
          <WysiwygModeSwitch
            wysiwyg={wysiwyg}
            onToggle={onToggleWysiwyg}
            secondLabel={
              projectKind === "diagram"
                ? t(($) => $.editor.toolbar.canvas)
                : t(($) => $.editor.toolbar.visual)
            }
            data-tour="wysiwyg-toggle"
          />
          <Divider />
        </>
      )}

      <IconBtn onClick={editorUndo} title={t(($) => $.editor.toolbar.undo, { shortcut: shortcut("⌘Z") })}>
        <Undo2 className="size-4" />
      </IconBtn>
      <IconBtn onClick={editorRedo} title={t(($) => $.editor.toolbar.redo, { shortcut: shortcut("⌘⇧Z") })}>
        <Redo2 className="size-4" />
      </IconBtn>

      <Divider />

      {visionReady && (
        <input
          ref={imageInputRef}
          data-testid="image-to-latex-input"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void imageToLatex(f);
          }}
        />
      )}

      <div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {visibleControls.map((c) => (
          <Fragment key={c.id}>{c.render()}</Fragment>
        ))}
        {overflowControls.length > 0 && (
          <Popover
            ariaLabel={t(($) => $.editor.toolbar.moreOptions)}
            closeOnClick={false}
            className="max-h-96 w-56 overflow-y-auto p-1"
            trigger={<MoreHorizontal className="size-4" />}
          >
            {overflowControls.map((c) => c.renderMenu())}
          </Popover>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {activePath?.toLowerCase().endsWith(".bib") && (
          <IconBtn
            onClick={() => void runCiteOleaflyAction({ path: activePath })}
            title={t(($) => $.editor.toolbar.citeOleafly)}
          >
            <Quote className="size-4" />
          </IconBtn>
        )}
        <ProjectInfoButton surface={wysiwyg ? "visual" : "source"} />
        {!wysiwyg && (
          <IconBtn onClick={editorFind} title={t(($) => $.editor.toolbar.find, { shortcut: shortcut("⌘F") })}>
            <Search className="size-4" />
          </IconBtn>
        )}
        {!wysiwyg && syncTexSupported && (
          <>
            <Divider />
            <IconBtn onClick={goToSyncTex} title={t(($) => $.editor.toolbar.goToPdf)}>
              <ArrowRight className="size-4" />
            </IconBtn>
          </>
        )}
      </div>
    </div>
  );
}
