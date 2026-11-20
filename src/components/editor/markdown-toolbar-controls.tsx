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
import type { useTranslation } from "react-i18next";
import { Divider, HeadingDropdown, btnControl, groupControl } from "@/components/editor/EditorToolbar";
import { MARKDOWN_HEADING_LEVELS } from "@/components/editor/markdown-commands";
import type { MarkdownTarget, MarkdownToolbarState } from "@/components/editor/markdown-model";
import { ALIGNMENTS, EmojiPopover, FieldForm, TextColorMenu, ToolbarPopover } from "@/components/editor/rich-text-controls";
import {
  CONTROL_GAP,
  DIVIDER_WIDTH,
  DROPDOWN_TRIGGER_WIDTH,
  ICON_BUTTON_WIDTH,
  type ToolbarControl,
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

export function markdownRow(
  target: MarkdownTarget,
  state: MarkdownToolbarState,
  t: ReturnType<typeof useTranslation<["common", "editor"]>>["t"],
): ToolbarControl[] {
  const marks = [
    btnControl("bold", Bold, t(($) => $.editor.toolbar.bold), target.bold, {
      tooltip: t(($) => $.editor.toolbar.boldWithShortcut, { shortcut: shortcut("⌘B") }),
    }),
    btnControl("italic", Italic, t(($) => $.editor.toolbar.italic), target.italic, {
      tooltip: t(($) => $.editor.toolbar.italicWithShortcut, { shortcut: shortcut("⌘I") }),
    }),
    btnControl("strikethrough", Strikethrough, t(($) => $.editor.toolbar.strikethrough), target.strike),
    btnControl("code", Code, t(($) => $.editor.toolbar.inlineCode), target.code),
  ];
  const link = toolbarPicker("link", ICON_BUTTON_WIDTH, (menuRow) => (
    <ToolbarPopover icon={LinkIcon} label={t(($) => $.editor.toolbar.linkUrl)} menuRow={menuRow}>
      <FieldForm
        label={t(($) => $.editor.toolbar.linkUrl)}
        placeholder={t(($) => $.editor.toolbar.linkPlaceholder)}
        initial={target.linkHref}
        removeLabel={t(($) => $.editor.toolbar.removeLink)}
        onApply={target.link}
      />
    </ToolbarPopover>
  ));
  const unlink = btnControl("unlink", Unlink, t(($) => $.editor.toolbar.removeLink), target.unlink, { disabled: !state.link });
  const lists = [
    btnControl("bullet", List, t(($) => $.editor.toolbar.bulletedList), target.bullet),
    btnControl("ordered", ListOrdered, t(($) => $.editor.toolbar.numberedList), target.ordered),
  ];
  const headings = MARKDOWN_HEADING_LEVELS.map((level, index) =>
    btnControl(`h${level.level}`, HEADING_ICONS[index], level.label(), () => target.heading(level.level), {
      active: state.heading === level.level,
    }),
  );
  const insertHeading = (level: (typeof MARKDOWN_HEADING_LEVELS)[number]) => target.heading(level.level);
  const quote = btnControl("blockquote", Quote, t(($) => $.editor.toolbar.blockquote), target.quote, {
    tooltip: t(($) => $.editor.toolbar.insertBlockquote),
    disabled: !state.quotes,
  });
  const align = ALIGNMENTS.map(({ align: value, icon, label }) =>
    btnControl(`align-${value}`, icon, label(), () => target.align(value), {
      active: state.align === value,
      disabled: !state.aligns,
      flagsMore: state.align === value && value !== "left",
    }),
  );
  const clear = btnControl("clear", RemoveFormatting, t(($) => $.editor.toolbar.clearFormatting), target.clear);
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
    btnControl("underline", Underline, t(($) => $.editor.toolbar.underline), target.underline),
    btnControl("highlight", Highlighter, t(($) => $.editor.toolbar.highlight), target.highlight),
    btnControl("superscript", Superscript, t(($) => $.editor.toolbar.superscript), target.superscript),
    btnControl("subscript", Subscript, t(($) => $.editor.toolbar.subscript), target.subscript),
  ];
  const image = toolbarPicker("image", ICON_BUTTON_WIDTH, (menuRow) => (
    <ToolbarPopover icon={ImageIcon} label={t(($) => $.editor.toolbar.imageFile)} menuRow={menuRow}>
      <FieldForm
        label={t(($) => $.editor.toolbar.imageFile)}
        placeholder={t(($) => $.editor.toolbar.imagePlaceholder)}
        initial={() => ""}
        onApply={target.image}
      />
    </ToolbarPopover>
  ));
  const embeds = [
    image,
    btnControl("table", Table, t(($) => $.editor.toolbar.insertTable), target.table),
    btnControl("diagram", PenTool, t(($) => $.editor.toolbar.drawDiagram), () => void openDiagramComposer("mermaid")),
  ];
  const headingGroup = groupControl("headings", headings, true);
  return [
    groupControl("marks", marks, false),
    groupControl("link", [link, unlink], true),
    groupControl("lists", lists, true),
    {
      ...headingGroup,
      renderMenu: () => (
        <HeadingDropdown key="heading" variant="menu" levels={MARKDOWN_HEADING_LEVELS} insert={insertHeading} checked={(level) => level.level === state.heading} />
      ),
      collapsed: {
        width: DIVIDER_WIDTH + CONTROL_GAP + DROPDOWN_TRIGGER_WIDTH,
        render: () => (
          <>
            <Divider />
            <HeadingDropdown variant="bar" levels={MARKDOWN_HEADING_LEVELS} insert={insertHeading} checked={(level) => level.level === state.heading} />
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
