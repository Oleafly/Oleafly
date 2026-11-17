import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  type LucideIcon,
  PenTool,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Underline,
  Unlink,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Divider, HeadingDropdown, IconBtn, groupControl } from "@/components/editor/EditorToolbar";
import { MARKDOWN_HEADING_LEVELS } from "@/components/editor/markdown-commands";
import type { MarkdownTarget, MarkdownToolbarState } from "@/components/editor/markdown-model";
import { ALIGNMENTS, EmojiPopover, TextColorMenu } from "@/components/editor/rich-text-controls";
import { Popover } from "@/components/ui/popover";
import {
  CONTROL_GAP,
  DIVIDER_WIDTH,
  DROPDOWN_TRIGGER_WIDTH,
  ICON_BUTTON_WIDTH,
  type ToolbarControl,
  ToolbarMenuItem,
  toolbarPicker,
} from "@/components/ui/toolbar-overflow";
import { openDiagramComposer } from "@/features/open-tool";
import { shortcut } from "@/lib/utils";

export {
  IDLE_TARGET,
  modelState,
  RESTING_STATE,
  sameToolbarState,
  sourceTarget,
  visualStateOf,
  visualTarget,
} from "@/components/editor/markdown-model";

const HEADING_ICONS: readonly LucideIcon[] = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6];

function TargetPopover({
  icon,
  label,
  placeholder,
  initialValue,
  onApply,
  removeLabel,
  menuRow,
}: Readonly<{
  icon: ReactNode;
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
          (event.currentTarget.closest("[data-radix-popper-content-wrapper]") as HTMLElement | null)?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
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
          <button type="submit" className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90">
            {t(($) => $.editor.toolbar.apply)}
          </button>
        </div>
      </form>
    </Popover>
  );
}

function iconControl(
  id: string,
  Icon: LucideIcon,
  label: string,
  onClick: () => void,
  extra: { active?: boolean; disabled?: boolean; tooltip?: string; flagsMore?: boolean } = {},
): ToolbarControl {
  return {
    id,
    width: ICON_BUTTON_WIDTH,
    active: extra.flagsMore ?? extra.active,
    render: () => (
      <IconBtn onClick={onClick} title={extra.tooltip ?? label} active={extra.active} disabled={extra.disabled}>
        <Icon className="size-4" />
      </IconBtn>
    ),
    renderMenu: () => (
      <ToolbarMenuItem key={id} icon={Icon} label={label} disabled={extra.disabled} checked={extra.active} onSelect={onClick} />
    ),
  };
}

export function markdownRow(
  target: MarkdownTarget,
  state: MarkdownToolbarState,
  t: ReturnType<typeof useTranslation<["common", "editor"]>>["t"],
): ToolbarControl[] {
  const marks = [
    iconControl("bold", Bold, t(($) => $.editor.toolbar.bold), target.bold, {
      tooltip: t(($) => $.editor.toolbar.boldWithShortcut, { shortcut: shortcut("⌘B") }),
    }),
    iconControl("italic", Italic, t(($) => $.editor.toolbar.italic), target.italic, {
      tooltip: t(($) => $.editor.toolbar.italicWithShortcut, { shortcut: shortcut("⌘I") }),
    }),
    iconControl("strikethrough", Strikethrough, t(($) => $.editor.toolbar.strikethrough), target.strike),
    iconControl("code", Code, t(($) => $.editor.toolbar.inlineCode), target.code),
  ];
  const link = toolbarPicker("link", ICON_BUTTON_WIDTH, (menuRow) => (
    <TargetPopover
      menuRow={menuRow}
      icon={<LinkIcon className="size-4" />}
      label={t(($) => $.editor.toolbar.linkUrl)}
      placeholder={t(($) => $.editor.toolbar.linkPlaceholder)}
      initialValue={target.linkHref}
      onApply={target.link}
      removeLabel={t(($) => $.editor.toolbar.removeLink)}
    />
  ));
  const unlink = iconControl("unlink", Unlink, t(($) => $.editor.toolbar.removeLink), target.unlink, { disabled: !state.link });
  const lists = [
    iconControl("bullet", List, t(($) => $.editor.toolbar.bulletedList), target.bullet),
    iconControl("ordered", ListOrdered, t(($) => $.editor.toolbar.numberedList), target.ordered),
  ];
  const headings = MARKDOWN_HEADING_LEVELS.map((level, index) =>
    iconControl(`h${level.level}`, HEADING_ICONS[index], level.label(), () => target.heading(level.level), {
      active: state.heading === level.level,
    }),
  );
  const insertHeading = (level: (typeof MARKDOWN_HEADING_LEVELS)[number]) => target.heading(level.level);
  const quote = iconControl("blockquote", Quote, t(($) => $.editor.toolbar.blockquote), target.quote, {
    tooltip: t(($) => $.editor.toolbar.insertBlockquote),
  });
  const align = ALIGNMENTS.map(({ align: value, icon, label }) =>
    iconControl(`align-${value}`, icon, label(), () => target.align(value), {
      active: state.align === value,
      disabled: !state.aligns,
      flagsMore: state.align === value && value !== "left",
    }),
  );
  const clear = iconControl("clear", RemoveFormatting, t(($) => $.editor.toolbar.clearFormatting), target.clear);
  const textColor: ToolbarControl = {
    id: "textColor",
    width: DROPDOWN_TRIGGER_WIDTH,
    active: state.textColor !== null,
    render: () => <TextColorMenu onColor={target.color} color={state.textColor} />,
    renderMenu: () => <TextColorMenu key="textColor" onColor={target.color} color={state.textColor} inMenu />,
  };
  const emoji: ToolbarControl = {
    id: "emoji",
    width: ICON_BUTTON_WIDTH,
    render: () => <EmojiPopover onPick={target.emoji} />,
    renderMenu: () => <EmojiPopover key="emoji" menuRow onPick={target.emoji} />,
  };
  const scripts = [
    iconControl("underline", Underline, t(($) => $.editor.toolbar.underline), target.underline),
    iconControl("highlight", Highlighter, t(($) => $.editor.toolbar.highlight), target.highlight),
    iconControl("superscript", Superscript, t(($) => $.editor.toolbar.superscript), target.superscript),
    iconControl("subscript", Subscript, t(($) => $.editor.toolbar.subscript), target.subscript),
  ];
  const image = toolbarPicker("image", ICON_BUTTON_WIDTH, (menuRow) => (
    <TargetPopover
      menuRow={menuRow}
      icon={<ImageIcon className="size-4" />}
      label={t(($) => $.editor.toolbar.imageFile)}
      placeholder={t(($) => $.editor.toolbar.imagePlaceholder)}
      onApply={target.image}
    />
  ));
  const embeds = [
    image,
    iconControl("table", Table, t(($) => $.editor.toolbar.insertTable), target.table),
    iconControl("diagram", PenTool, t(($) => $.editor.toolbar.drawDiagram), () => void openDiagramComposer("mermaid")),
  ];
  const headingGroup = groupControl("headings", headings, true);
  return [
    groupControl("marks", marks, false),
    groupControl("link", [link, unlink], true),
    groupControl("lists", lists, true),
    {
      ...headingGroup,
      renderMenu: () => (
        <HeadingDropdown key="heading" variant="menu" levels={MARKDOWN_HEADING_LEVELS} insert={insertHeading} active={state.heading !== null} />
      ),
      collapsed: {
        width: DIVIDER_WIDTH + CONTROL_GAP + DROPDOWN_TRIGGER_WIDTH,
        render: () => (
          <>
            <Divider />
            <HeadingDropdown variant="bar" levels={MARKDOWN_HEADING_LEVELS} insert={insertHeading} active={state.heading !== null} />
          </>
        ),
      },
    },
    groupControl("quote", [quote], true),
    groupControl("align", align, true),
    groupControl("clear", [clear], true),
    groupControl("colors", [textColor, emoji], true),
    groupControl("scripts", scripts, true),
    groupControl("embeds", embeds, true),
  ];
}
