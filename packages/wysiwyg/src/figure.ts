import { Node, mergeAttributes, type JSONContent, type NodeViewRenderer } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { booleanAttribute, stringAttribute } from "./attribute-specs";
import type { GraphicsCommand } from "./latex/parse-figure";
import { wysiwygMessage } from "./messages";
import type { AssetUrlResolver } from "./options";
import { updateNodeAttribute } from "./source-editing";

export interface FigureOptions {
  resolveAssetUrl: AssetUrlResolver | null;
}

export interface CreateFigureOptions {
  path: string;
  width?: string | null;
  options?: string | null;
  placement?: string | null;
  centering?: boolean;
  label?: string | null;
  caption?: string | null;
  graphicsCommand?: GraphicsCommand;
}

export const FIGURE_WIDTH_PRESETS = [
  { value: "", key: "figure.widthNatural" },
  { value: String.raw`0.25\linewidth`, key: "figure.widthQuarter" },
  { value: String.raw`0.5\linewidth`, key: "figure.widthHalf" },
  { value: String.raw`0.75\linewidth`, key: "figure.widthThreeQuarters" },
  { value: String.raw`\linewidth`, key: "figure.widthFull" },
] as const;

const CUSTOM_WIDTH = "custom";

export function createFigure(options: CreateFigureOptions): JSONContent {
  const caption =
    typeof options.caption === "string"
      ? [{ type: "figureCaption", content: options.caption ? [{ type: "text", text: options.caption }] : [] }]
      : [];
  return {
    type: "figure",
    attrs: {
      path: options.path,
      width: options.width === undefined ? String.raw`0.5\linewidth` : options.width,
      options: options.options ?? null,
      placement: options.placement === undefined ? "htbp" : options.placement,
      centering: options.centering ?? true,
      label: options.label ?? null,
      graphicsCommand: options.graphicsCommand ?? "includegraphics",
    },
    content: caption,
  };
}

export function figureWidthPercent(width: string | null): string | null {
  if (width === null) return null;
  const match = /^(\d+(?:\.\d+)?|\.\d+)?\\(?:linewidth|textwidth|columnwidth)$/u.exec(width.trim());
  if (!match) return null;
  const fraction = match[1] === undefined ? 1 : Number(match[1]);
  return `${Math.min(100, Math.max(0, fraction * 100))}%`;
}

export const FigureCaption = Node.create({
  name: "figureCaption",
  content: "inline*",
  defining: true,

  parseHTML() {
    return [{ tag: 'figcaption[data-type="figure-caption"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "figcaption",
      mergeAttributes(HTMLAttributes, {
        "data-type": "figure-caption",
        "data-placeholder": wysiwygMessage("figure.captionPlaceholder"),
      }),
      0,
    ];
  },
});

function widthSelect(): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "figure-width";
  select.setAttribute("aria-label", wysiwygMessage("figure.width"));
  for (const preset of FIGURE_WIDTH_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.value;
    option.textContent = wysiwygMessage(preset.key);
    select.append(option);
  }
  return select;
}

function syncWidthSelect(select: HTMLSelectElement, value: string): void {
  const custom = select.querySelector<HTMLOptionElement>(`option[value="${CUSTOM_WIDTH}"]`);
  const isPreset = FIGURE_WIDTH_PRESETS.some((preset) => preset.value === value);
  if (isPreset) {
    custom?.remove();
    select.value = value;
    return;
  }
  const option = custom ?? document.createElement("option");
  option.value = CUSTOM_WIDTH;
  option.textContent = wysiwygMessage("figure.widthCustom", { width: value });
  if (!custom) select.append(option);
  select.value = CUSTOM_WIDTH;
}

function labelledControl(labelKey: "figure.width" | "figure.labelField", control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "figure-control";
  const caption = document.createElement("span");
  caption.textContent = wysiwygMessage(labelKey);
  label.append(caption, control);
  return label;
}

function figureNodeView(options: FigureOptions): NodeViewRenderer {
  return ({ node: initialNode, view, getPos }) => {
    let currentNode = initialNode;
    let generation = 0;
    let destroyed = false;

    const dom = document.createElement("figure");
    dom.dataset.type = "figure";
    const frame = document.createElement("div");
    frame.className = "figure-frame";
    frame.setAttribute("contenteditable", "false");
    const image = document.createElement("img");
    image.className = "figure-image";
    image.hidden = true;
    const placeholder = document.createElement("div");
    placeholder.className = "figure-placeholder";
    placeholder.textContent = wysiwygMessage("figure.imageLoading");
    const controls = document.createElement("div");
    controls.className = "figure-controls";
    const width = widthSelect();
    const label = document.createElement("input");
    label.type = "text";
    label.className = "figure-label";
    label.placeholder = wysiwygMessage("figure.labelPlaceholder");
    label.setAttribute("aria-label", wysiwygMessage("figure.labelField"));
    const addCaption = document.createElement("button");
    addCaption.type = "button";
    addCaption.className = "figure-add-caption";
    addCaption.textContent = wysiwygMessage("figure.addCaption");
    controls.append(labelledControl("figure.width", width), labelledControl("figure.labelField", label), addCaption);
    frame.append(image, placeholder, controls);
    const captionHost = document.createElement("div");
    captionHost.className = "figure-caption-host";
    dom.append(frame, captionHost);

    const showPlaceholder = (key: "figure.imageLoading" | "figure.imageUnavailable") => {
      image.hidden = true;
      image.removeAttribute("src");
      placeholder.hidden = false;
      placeholder.textContent = wysiwygMessage(key);
    };
    const resolveImage = (path: string) => {
      const request = ++generation;
      if (!options.resolveAssetUrl || path === "") {
        showPlaceholder("figure.imageUnavailable");
        return;
      }
      showPlaceholder("figure.imageLoading");
      options.resolveAssetUrl(path).then(
        (url) => {
          if (destroyed || request !== generation) return;
          if (!url) {
            showPlaceholder("figure.imageUnavailable");
            return;
          }
          image.src = url;
          image.hidden = false;
          placeholder.hidden = true;
        },
        () => {
          if (!destroyed && request === generation) showPlaceholder("figure.imageUnavailable");
        },
      );
    };

    let currentPath: string | null = null;
    const updatePresentation = () => {
      const path = String(currentNode.attrs.path ?? "");
      const widthValue = typeof currentNode.attrs.width === "string" ? currentNode.attrs.width : null;
      dom.dataset.path = path;
      image.alt = wysiwygMessage("figure.imageAlt", { path });
      image.style.width = figureWidthPercent(widthValue) ?? "";
      syncWidthSelect(width, widthValue ?? "");
      if (document.activeElement !== label) {
        label.value = typeof currentNode.attrs.label === "string" ? currentNode.attrs.label : "";
      }
      addCaption.hidden = currentNode.childCount > 0;
      if (path !== currentPath) {
        currentPath = path;
        resolveImage(path);
      }
    };
    updatePresentation();

    const commitLabel = () => {
      const value = label.value.trim();
      updateNodeAttribute(view, getPos, currentNode.type, "label", value === "" ? null : value);
    };
    const onWidthChange = () => {
      if (width.value === CUSTOM_WIDTH) return;
      updateNodeAttribute(view, getPos, currentNode.type, "width", width.value === "" ? null : width.value);
    };
    const onAddCaption = () => {
      const position = getPos();
      if (typeof position !== "number") return;
      const liveNode = view.state.doc.nodeAt(position);
      if (!liveNode || liveNode.type !== currentNode.type || liveNode.childCount > 0) return;
      const caption = view.state.schema.nodes.figureCaption.create();
      const transaction = view.state.tr.insert(position + 1, caption);
      view.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, position + 2)));
      view.focus();
    };
    const onLabelKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        label.blur();
        view.dom.focus({ preventScroll: true });
      }
    };
    width.addEventListener("change", onWidthChange);
    label.addEventListener("change", commitLabel);
    label.addEventListener("keydown", onLabelKey);
    addCaption.addEventListener("click", onAddCaption);

    return {
      dom,
      contentDOM: captionHost,
      update(nextNode) {
        if (nextNode.type !== currentNode.type) return false;
        currentNode = nextNode;
        updatePresentation();
        return true;
      },
      selectNode() {
        dom.classList.add("ProseMirror-selectednode");
      },
      deselectNode() {
        dom.classList.remove("ProseMirror-selectednode");
      },
      stopEvent(event) {
        return event.target instanceof Element && controls.contains(event.target);
      },
      ignoreMutation(mutation) {
        return mutation.type !== "selection" && frame.contains(mutation.target);
      },
      destroy() {
        destroyed = true;
        width.removeEventListener("change", onWidthChange);
        label.removeEventListener("change", commitLabel);
        label.removeEventListener("keydown", onLabelKey);
        addCaption.removeEventListener("click", onAddCaption);
      },
    };
  };
}

export const Figure = Node.create<FigureOptions>({
  name: "figure",
  group: "block",
  content: "figureCaption?",
  selectable: true,
  draggable: false,
  isolating: true,
  defining: true,

  addOptions() {
    return { resolveAssetUrl: null };
  },

  addAttributes() {
    return {
      path: stringAttribute("path", ""),
      width: stringAttribute("width", null),
      options: stringAttribute("options", null),
      placement: stringAttribute("placement", null),
      centering: booleanAttribute("centering", true),
      label: stringAttribute("label", null),
      graphicsCommand: stringAttribute("graphicsCommand", "includegraphics", "graphics-command"),
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="figure"]', contentElement: ".figure-caption-host" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { "data-type": "figure" }),
      [
        "div",
        { class: "figure-frame", contenteditable: "false" },
        ["span", { class: "figure-path" }, String(node.attrs.path ?? "")],
      ],
      ["div", { class: "figure-caption-host" }, 0],
    ];
  },

  addNodeView() {
    return figureNodeView(this.options);
  },
});
