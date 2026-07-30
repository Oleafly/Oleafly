"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  BubbleMenu: () => BubbleMenu,
  BubbleMenuPlugin: () => BubbleMenuPlugin,
  BubbleMenuView: () => BubbleMenuView,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// src/bubble-menu.ts
var import_core2 = require("@tiptap/core");

// src/bubble-menu-plugin.ts
var import_dom = require("@floating-ui/dom");
var import_core = require("@tiptap/core");
var import_state = require("@tiptap/pm/state");
var import_tables = require("@tiptap/pm/tables");
function combineDOMRects(rect1, rect2) {
  const top = Math.min(rect1.top, rect2.top);
  const bottom = Math.max(rect1.bottom, rect2.bottom);
  const left = Math.min(rect1.left, rect2.left);
  const right = Math.max(rect1.right, rect2.right);
  const width = right - left;
  const height = bottom - top;
  const x = left;
  const y = top;
  return new DOMRect(x, y, width, height);
}
var BubbleMenuView = class {
  constructor({
    editor,
    element,
    view,
    pluginKey = "bubbleMenu",
    updateDelay = 250,
    resizeDelay = 60,
    shouldShow,
    appendTo,
    getReferencedVirtualElement,
    options
  }) {
    this.preventHide = false;
    this.isVisible = false;
    this.scrollTarget = window;
    this.floatingUIOptions = {
      strategy: "absolute",
      placement: "top",
      offset: 8,
      flip: {},
      shift: {},
      arrow: false,
      size: false,
      autoPlacement: false,
      hide: false,
      inline: false,
      onShow: void 0,
      onHide: void 0,
      onUpdate: void 0,
      onDestroy: void 0
    };
    this.shouldShow = ({
      view,
      state,
      from,
      to
    }) => {
      const { doc, selection } = state;
      const { empty } = selection;
      const isEmptyTextBlock = !doc.textBetween(from, to).length && (0, import_core.isTextSelection)(state.selection);
      const isChildOfMenu = this.element.contains(document.activeElement);
      const hasEditorFocus = view.hasFocus() || isChildOfMenu;
      if (!hasEditorFocus || empty || isEmptyTextBlock || !this.editor.isEditable) {
        return false;
      }
      return true;
    };
    this.mousedownHandler = () => {
      this.preventHide = true;
    };
    this.dragstartHandler = () => {
      this.hide();
    };
    /**
     * Handles the window resize event to update the position of the bubble menu.
     * It uses a debounce mechanism to prevent excessive updates.
     * The delay is defined by the `resizeDelay` property.
     */
    this.resizeHandler = () => {
      if (this.resizeDebounceTimer) {
        clearTimeout(this.resizeDebounceTimer);
      }
      this.resizeDebounceTimer = window.setTimeout(() => {
        this.updatePosition();
      }, this.resizeDelay);
    };
    this.focusHandler = () => {
      setTimeout(() => this.update(this.editor.view));
    };
    this.blurHandler = ({ event }) => {
      var _a;
      if (this.editor.isDestroyed) {
        this.destroy();
        return;
      }
      if (this.preventHide) {
        this.preventHide = false;
        return;
      }
      if ((event == null ? void 0 : event.relatedTarget) && ((_a = this.element.parentNode) == null ? void 0 : _a.contains(event.relatedTarget))) {
        return;
      }
      if ((event == null ? void 0 : event.relatedTarget) === this.editor.view.dom) {
        return;
      }
      this.hide();
    };
    this.handleDebouncedUpdate = (view, oldState) => {
      const selectionChanged = !(oldState == null ? void 0 : oldState.selection.eq(view.state.selection));
      const docChanged = !(oldState == null ? void 0 : oldState.doc.eq(view.state.doc));
      if (!selectionChanged && !docChanged) {
        return;
      }
      if (this.updateDebounceTimer) {
        clearTimeout(this.updateDebounceTimer);
      }
      this.updateDebounceTimer = window.setTimeout(() => {
        this.updateHandler(view, selectionChanged, docChanged, oldState);
      }, this.updateDelay);
    };
    this.updateHandler = (view, selectionChanged, docChanged, oldState) => {
      const { composing } = view;
      const isSame = !selectionChanged && !docChanged;
      if (composing || isSame) {
        return;
      }
      const shouldShow = this.getShouldShow(oldState);
      if (!shouldShow) {
        this.hide();
        return;
      }
      this.show();
      this.updatePosition();
    };
    /**
     * Handles the transaction event to update the position of the bubble menu.
     * This allows external code to trigger a position update via:
     * `editor.view.dispatch(editor.state.tr.setMeta(pluginKey, 'updatePosition'))`
     * The `pluginKey` defaults to `bubbleMenu`
     */
    this.transactionHandler = ({ transaction: tr }) => {
      const meta = tr.getMeta(this.pluginKey);
      if (meta === "updatePosition") {
        this.updatePosition();
      } else if (meta && typeof meta === "object" && meta.type === "updateOptions") {
        this.updateOptions(meta.options);
      } else if (meta === "hide") {
        this.hide();
      } else if (meta === "show") {
        this.updatePosition();
        this.show();
      }
    };
    var _a;
    this.editor = editor;
    this.element = element;
    this.view = view;
    this.pluginKey = pluginKey;
    this.updateDelay = updateDelay;
    this.resizeDelay = resizeDelay;
    this.appendTo = appendTo;
    this.scrollTarget = (_a = options == null ? void 0 : options.scrollTarget) != null ? _a : window;
    this.getReferencedVirtualElement = getReferencedVirtualElement;
    this.floatingUIOptions = {
      ...this.floatingUIOptions,
      ...options
    };
    this.element.tabIndex = 0;
    if (shouldShow) {
      this.shouldShow = shouldShow;
    }
    this.element.addEventListener("mousedown", this.mousedownHandler, { capture: true });
    this.view.dom.addEventListener("dragstart", this.dragstartHandler);
    this.editor.on("focus", this.focusHandler);
    this.editor.on("blur", this.blurHandler);
    this.editor.on("transaction", this.transactionHandler);
    window.addEventListener("resize", this.resizeHandler);
    this.scrollTarget.addEventListener("scroll", this.resizeHandler);
    this.update(view, view.state);
    if (this.getShouldShow()) {
      this.show();
      this.updatePosition();
    }
  }
  get middlewares() {
    const middlewares = [];
    if (this.floatingUIOptions.flip) {
      middlewares.push(
        (0, import_dom.flip)(
          typeof this.floatingUIOptions.flip !== "boolean" ? this.floatingUIOptions.flip : void 0
        )
      );
    }
    if (this.floatingUIOptions.shift) {
      middlewares.push(
        (0, import_dom.shift)(
          typeof this.floatingUIOptions.shift !== "boolean" ? this.floatingUIOptions.shift : void 0
        )
      );
    }
    if (this.floatingUIOptions.offset) {
      middlewares.push(
        (0, import_dom.offset)(
          typeof this.floatingUIOptions.offset !== "boolean" ? this.floatingUIOptions.offset : void 0
        )
      );
    }
    if (this.floatingUIOptions.arrow) {
      middlewares.push((0, import_dom.arrow)(this.floatingUIOptions.arrow));
    }
    if (this.floatingUIOptions.size) {
      middlewares.push(
        (0, import_dom.size)(
          typeof this.floatingUIOptions.size !== "boolean" ? this.floatingUIOptions.size : void 0
        )
      );
    }
    if (this.floatingUIOptions.autoPlacement) {
      middlewares.push(
        (0, import_dom.autoPlacement)(
          typeof this.floatingUIOptions.autoPlacement !== "boolean" ? this.floatingUIOptions.autoPlacement : void 0
        )
      );
    }
    if (this.floatingUIOptions.hide) {
      middlewares.push(
        (0, import_dom.hide)(
          typeof this.floatingUIOptions.hide !== "boolean" ? this.floatingUIOptions.hide : void 0
        )
      );
    }
    if (this.floatingUIOptions.inline) {
      middlewares.push(
        (0, import_dom.inline)(
          typeof this.floatingUIOptions.inline !== "boolean" ? this.floatingUIOptions.inline : void 0
        )
      );
    }
    return middlewares;
  }
  get virtualElement() {
    var _a, _b, _c;
    const { selection } = this.editor.state;
    const referencedVirtualElement = (_a = this.getReferencedVirtualElement) == null ? void 0 : _a.call(this);
    if (referencedVirtualElement) {
      return referencedVirtualElement;
    }
    if (!((_c = (_b = this.view) == null ? void 0 : _b.dom) == null ? void 0 : _c.parentNode)) {
      return;
    }
    const domRect = (0, import_core.posToDOMRect)(this.view, selection.from, selection.to);
    let virtualElement = {
      getBoundingClientRect: () => domRect,
      getClientRects: () => [domRect]
    };
    if (selection instanceof import_state.NodeSelection) {
      let node = this.view.nodeDOM(selection.from);
      const nodeViewWrapper = node.dataset.nodeViewWrapper ? node : node.querySelector("[data-node-view-wrapper]");
      if (nodeViewWrapper) {
        node = nodeViewWrapper;
      }
      if (node) {
        virtualElement = {
          getBoundingClientRect: () => node.getBoundingClientRect(),
          getClientRects: () => [node.getBoundingClientRect()]
        };
      }
    }
    if (selection instanceof import_tables.CellSelection) {
      const { $anchorCell, $headCell } = selection;
      const from = $anchorCell ? $anchorCell.pos : $headCell.pos;
      const to = $headCell ? $headCell.pos : $anchorCell.pos;
      const fromDOM = this.view.nodeDOM(from);
      const toDOM = this.view.nodeDOM(to);
      if (!fromDOM || !toDOM) {
        return;
      }
      const clientRect = fromDOM === toDOM ? fromDOM.getBoundingClientRect() : combineDOMRects(
        fromDOM.getBoundingClientRect(),
        toDOM.getBoundingClientRect()
      );
      virtualElement = {
        getBoundingClientRect: () => clientRect,
        getClientRects: () => [clientRect]
      };
    }
    return virtualElement;
  }
  updatePosition() {
    if (!this.isVisible) {
      return;
    }
    const virtualElement = this.virtualElement;
    if (!virtualElement) {
      return;
    }
    (0, import_dom.computePosition)(virtualElement, this.element, {
      placement: this.floatingUIOptions.placement,
      strategy: this.floatingUIOptions.strategy,
      middleware: this.middlewares
    }).then(({ x, y, strategy, middlewareData }) => {
      var _a, _b;
      if (!this.isVisible || this.editor.isDestroyed || !this.element.isConnected) {
        return;
      }
      if (((_a = middlewareData.hide) == null ? void 0 : _a.referenceHidden) || ((_b = middlewareData.hide) == null ? void 0 : _b.escaped)) {
        this.element.style.visibility = "hidden";
        return;
      }
      this.element.style.visibility = "visible";
      this.element.style.width = "max-content";
      this.element.style.position = strategy;
      this.element.style.left = `${x}px`;
      this.element.style.top = `${y}px`;
      if (this.isVisible && this.floatingUIOptions.onUpdate) {
        this.floatingUIOptions.onUpdate();
      }
    });
  }
  update(view, oldState) {
    const { state } = view;
    const hasValidSelection = state.selection.from !== state.selection.to;
    if (this.updateDelay > 0 && hasValidSelection) {
      this.handleDebouncedUpdate(view, oldState);
      return;
    }
    const selectionChanged = !(oldState == null ? void 0 : oldState.selection.eq(view.state.selection));
    const docChanged = !(oldState == null ? void 0 : oldState.doc.eq(view.state.doc));
    this.updateHandler(view, selectionChanged, docChanged, oldState);
  }
  getShouldShow(oldState) {
    var _a;
    const { state } = this.view;
    const { selection } = state;
    const { ranges } = selection;
    const from = Math.min(...ranges.map((range) => range.$from.pos));
    const to = Math.max(...ranges.map((range) => range.$to.pos));
    const shouldShow = (_a = this.shouldShow) == null ? void 0 : _a.call(this, {
      editor: this.editor,
      element: this.element,
      view: this.view,
      state,
      oldState,
      from,
      to
    });
    return shouldShow || false;
  }
  show() {
    var _a;
    if (this.isVisible) {
      return;
    }
    this.element.style.visibility = "visible";
    this.element.style.opacity = "1";
    const appendToElement = typeof this.appendTo === "function" ? this.appendTo() : this.appendTo;
    (_a = appendToElement != null ? appendToElement : this.view.dom.parentElement) == null ? void 0 : _a.appendChild(this.element);
    if (this.floatingUIOptions.onShow) {
      this.floatingUIOptions.onShow();
    }
    this.isVisible = true;
  }
  hide() {
    if (!this.isVisible) {
      return;
    }
    this.element.style.visibility = "hidden";
    this.element.style.opacity = "0";
    this.element.remove();
    if (this.floatingUIOptions.onHide) {
      this.floatingUIOptions.onHide();
    }
    this.isVisible = false;
  }
  updateOptions(newProps) {
    var _a;
    if (newProps.updateDelay !== void 0) {
      this.updateDelay = newProps.updateDelay;
    }
    if (newProps.resizeDelay !== void 0) {
      this.resizeDelay = newProps.resizeDelay;
    }
    if (newProps.appendTo !== void 0) {
      this.appendTo = newProps.appendTo;
    }
    if (newProps.getReferencedVirtualElement !== void 0) {
      this.getReferencedVirtualElement = newProps.getReferencedVirtualElement;
    }
    if (newProps.shouldShow !== void 0) {
      if (newProps.shouldShow) {
        this.shouldShow = newProps.shouldShow;
      }
    }
    if (newProps.options !== void 0) {
      const newScrollTarget = (_a = newProps.options.scrollTarget) != null ? _a : window;
      if (newScrollTarget !== this.scrollTarget) {
        this.scrollTarget.removeEventListener("scroll", this.resizeHandler);
        this.scrollTarget = newScrollTarget;
        this.scrollTarget.addEventListener("scroll", this.resizeHandler);
      }
      this.floatingUIOptions = {
        ...this.floatingUIOptions,
        ...newProps.options
      };
    }
  }
  destroy() {
    this.hide();
    this.element.removeEventListener("mousedown", this.mousedownHandler, { capture: true });
    this.view.dom.removeEventListener("dragstart", this.dragstartHandler);
    window.removeEventListener("resize", this.resizeHandler);
    this.scrollTarget.removeEventListener("scroll", this.resizeHandler);
    this.editor.off("focus", this.focusHandler);
    this.editor.off("blur", this.blurHandler);
    this.editor.off("transaction", this.transactionHandler);
    if (this.floatingUIOptions.onDestroy) {
      this.floatingUIOptions.onDestroy();
    }
  }
};
var BubbleMenuPlugin = (options) => {
  return new import_state.Plugin({
    key: typeof options.pluginKey === "string" ? new import_state.PluginKey(options.pluginKey) : options.pluginKey,
    view: (view) => new BubbleMenuView({ view, ...options })
  });
};

// src/bubble-menu.ts
var BubbleMenu = import_core2.Extension.create({
  name: "bubbleMenu",
  addOptions() {
    return {
      element: null,
      pluginKey: "bubbleMenu",
      updateDelay: void 0,
      appendTo: void 0,
      shouldShow: null
    };
  },
  addProseMirrorPlugins() {
    if (!this.options.element) {
      return [];
    }
    return [
      BubbleMenuPlugin({
        pluginKey: this.options.pluginKey,
        editor: this.editor,
        element: this.options.element,
        updateDelay: this.options.updateDelay,
        options: this.options.options,
        appendTo: this.options.appendTo,
        getReferencedVirtualElement: this.options.getReferencedVirtualElement,
        shouldShow: this.options.shouldShow
      })
    ];
  }
});

// src/index.ts
var index_default = BubbleMenu;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BubbleMenu,
  BubbleMenuPlugin,
  BubbleMenuView
});
//# sourceMappingURL=index.cjs.map