"use strict";
"use client";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  EditorConsumer: () => EditorConsumer,
  EditorContent: () => EditorContent,
  EditorContext: () => EditorContext,
  EditorProvider: () => EditorProvider,
  MarkViewContent: () => MarkViewContent,
  NodeViewContent: () => NodeViewContent,
  NodeViewWrapper: () => NodeViewWrapper,
  PureEditorContent: () => PureEditorContent,
  ReactMarkView: () => ReactMarkView,
  ReactMarkViewContext: () => ReactMarkViewContext,
  ReactMarkViewRenderer: () => ReactMarkViewRenderer,
  ReactNodeView: () => ReactNodeView,
  ReactNodeViewContentProvider: () => ReactNodeViewContentProvider,
  ReactNodeViewContext: () => ReactNodeViewContext,
  ReactNodeViewRenderer: () => ReactNodeViewRenderer,
  ReactRenderer: () => ReactRenderer,
  Tiptap: () => Tiptap,
  TiptapContent: () => TiptapContent,
  TiptapContext: () => TiptapContext,
  TiptapWrapper: () => TiptapWrapper,
  createContentComponent: () => createContentComponent,
  useCurrentEditor: () => useCurrentEditor,
  useEditor: () => useEditor,
  useEditorState: () => useEditorState,
  useReactNodeView: () => useReactNodeView,
  useTiptap: () => useTiptap,
  useTiptapState: () => useTiptapState
});
module.exports = __toCommonJS(index_exports);

// src/Context.tsx
var import_react4 = require("react");

// src/EditorContent.tsx
var import_react = __toESM(require("react"), 1);
var import_react_dom = __toESM(require("react-dom"), 1);
var import_shim = require("use-sync-external-store/shim/index.js");
var import_jsx_runtime = require("react/jsx-runtime");
var mergeRefs = (...refs) => {
  return (node) => {
    refs.forEach((ref) => {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ;
        ref.current = node;
      }
    });
  };
};
var Portals = ({ contentComponent }) => {
  const renderers = (0, import_shim.useSyncExternalStore)(
    contentComponent.subscribe,
    contentComponent.getSnapshot,
    contentComponent.getServerSnapshot
  );
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: Object.values(renderers) });
};
function createContentComponent() {
  const subscribers = /* @__PURE__ */ new Set();
  let renderers = {};
  let isNotificationQueued = false;
  const notifySubscribers = () => {
    if (isNotificationQueued || !subscribers.size) {
      return;
    }
    isNotificationQueued = true;
    queueMicrotask(() => {
      isNotificationQueued = false;
      subscribers.forEach((subscriber) => subscriber());
    });
  };
  return {
    /**
     * Subscribe to the editor instance's changes.
     */
    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    getSnapshot() {
      return renderers;
    },
    getServerSnapshot() {
      return renderers;
    },
    /**
     * Adds a new NodeView Renderer to the editor.
     */
    setRenderer(id, renderer) {
      renderers = {
        ...renderers,
        [id]: import_react_dom.default.createPortal(renderer.reactElement, renderer.element, id)
      };
      notifySubscribers();
    },
    /**
     * Removes a NodeView Renderer from the editor.
     */
    removeRenderer(id) {
      const nextRenderers = { ...renderers };
      delete nextRenderers[id];
      renderers = nextRenderers;
      notifySubscribers();
    }
  };
}
var PureEditorContent = class extends import_react.default.Component {
  constructor(props) {
    super(props);
    this.editorContentRef = import_react.default.createRef();
  }
  componentDidMount() {
    this.init();
  }
  componentDidUpdate() {
    this.init();
  }
  init() {
    var _a;
    const editor = this.props.editor;
    if (editor && !editor.isDestroyed && ((_a = editor.view.dom) == null ? void 0 : _a.parentNode)) {
      if (editor.contentComponent) {
        return;
      }
      const element = this.editorContentRef.current;
      element.append(...editor.view.dom.parentNode.childNodes);
      editor.setOptions({
        element
      });
      editor.contentComponent = createContentComponent();
      editor.createNodeViews();
      editor.isEditorContentInitialized = true;
      this.forceUpdate();
    }
  }
  componentWillUnmount() {
    var _a;
    const editor = this.props.editor;
    if (!editor) {
      return;
    }
    editor.isEditorContentInitialized = false;
    if (!editor.isDestroyed) {
      editor.view.setProps({
        nodeViews: {}
      });
    }
    editor.contentComponent = null;
    try {
      if (!((_a = editor.view.dom) == null ? void 0 : _a.parentNode)) {
        return;
      }
      const newElement = document.createElement("div");
      newElement.append(...editor.view.dom.parentNode.childNodes);
      editor.setOptions({
        element: newElement
      });
    } catch {
    }
  }
  render() {
    const { editor, innerRef, ...rest } = this.props;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref: mergeRefs(innerRef, this.editorContentRef), ...rest }),
      (editor == null ? void 0 : editor.contentComponent) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Portals, { contentComponent: editor.contentComponent })
    ] });
  }
};
var EditorContentWithKey = (0, import_react.forwardRef)(
  (props, ref) => {
    const key = import_react.default.useMemo(() => {
      return Math.floor(Math.random() * 4294967295).toString();
    }, [props.editor]);
    return import_react.default.createElement(PureEditorContent, {
      key,
      innerRef: ref,
      ...props
    });
  }
);
var EditorContent = import_react.default.memo(EditorContentWithKey);

// src/useEditor.ts
var import_core = require("@tiptap/core");
var import_react3 = require("react");
var import_shim2 = require("use-sync-external-store/shim/index.js");

// src/useEditorState.ts
var import_fast_equals = require("fast-equals");
var import_react2 = require("react");
var import_with_selector = require("use-sync-external-store/shim/with-selector.js");
var useIsomorphicLayoutEffect = typeof window !== "undefined" ? import_react2.useLayoutEffect : import_react2.useEffect;
var EditorStateManager = class {
  constructor(initialEditor) {
    this.transactionNumber = 0;
    this.lastTransactionNumber = 0;
    this.subscribers = /* @__PURE__ */ new Set();
    this.editor = initialEditor;
    this.lastSnapshot = { editor: initialEditor, transactionNumber: 0 };
    this.getSnapshot = this.getSnapshot.bind(this);
    this.getServerSnapshot = this.getServerSnapshot.bind(this);
    this.watch = this.watch.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }
  /**
   * Get the current editor instance.
   */
  getSnapshot() {
    if (this.transactionNumber === this.lastTransactionNumber) {
      return this.lastSnapshot;
    }
    this.lastTransactionNumber = this.transactionNumber;
    this.lastSnapshot = { editor: this.editor, transactionNumber: this.transactionNumber };
    return this.lastSnapshot;
  }
  /**
   * Always disable the editor on the server-side.
   */
  getServerSnapshot() {
    return { editor: null, transactionNumber: 0 };
  }
  /**
   * Subscribe to the editor instance's changes.
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
  /**
   * Watch the editor instance for changes.
   */
  watch(nextEditor) {
    this.editor = nextEditor;
    if (this.editor) {
      const fn = () => {
        this.transactionNumber += 1;
        this.subscribers.forEach((callback) => callback());
      };
      const currentEditor = this.editor;
      currentEditor.on("transaction", fn);
      return () => {
        currentEditor.off("transaction", fn);
      };
    }
    return void 0;
  }
};
function useEditorState(options) {
  var _a;
  const [editorStateManager] = (0, import_react2.useState)(() => new EditorStateManager(options.editor));
  const selectedState = (0, import_with_selector.useSyncExternalStoreWithSelector)(
    editorStateManager.subscribe,
    editorStateManager.getSnapshot,
    editorStateManager.getServerSnapshot,
    options.selector,
    (_a = options.equalityFn) != null ? _a : import_fast_equals.deepEqual
  );
  useIsomorphicLayoutEffect(() => {
    return editorStateManager.watch(options.editor);
  }, [options.editor, editorStateManager]);
  (0, import_react2.useDebugValue)(selectedState);
  return selectedState;
}

// src/useEditor.ts
var isDev = process.env.NODE_ENV !== "production";
var isSSR = typeof window === "undefined";
var isNext = isSSR || Boolean(typeof window !== "undefined" && window.next);
var EditorInstanceManager = class _EditorInstanceManager {
  constructor(options) {
    /**
     * The current editor instance.
     */
    this.editor = null;
    /**
     * The subscriptions to notify when the editor instance
     * has been created or destroyed.
     */
    this.subscriptions = /* @__PURE__ */ new Set();
    /**
     * Whether the editor has been mounted.
     */
    this.isComponentMounted = false;
    /**
     * The most recent dependencies array.
     */
    this.previousDeps = null;
    /**
     * The unique instance ID. This is used to identify the editor instance. And will be re-generated for each new instance.
     */
    this.instanceId = "";
    this.options = options;
    this.subscriptions = /* @__PURE__ */ new Set();
    this.setEditor(this.getInitialEditor());
    this.scheduleDestroy();
    this.getEditor = this.getEditor.bind(this);
    this.getServerSnapshot = this.getServerSnapshot.bind(this);
    this.subscribe = this.subscribe.bind(this);
    this.refreshEditorInstance = this.refreshEditorInstance.bind(this);
    this.scheduleDestroy = this.scheduleDestroy.bind(this);
    this.onRender = this.onRender.bind(this);
    this.createEditor = this.createEditor.bind(this);
  }
  setEditor(editor) {
    this.editor = editor;
    this.instanceId = Math.random().toString(36).slice(2, 9);
    this.subscriptions.forEach((cb) => cb());
  }
  getInitialEditor() {
    const explicit = this.options.current.immediatelyRender;
    let immediatelyRender = explicit != null ? explicit : true;
    if (isSSR) {
      if (immediatelyRender && isDev) {
        console.warn(
          "SSR detected. `immediatelyRender` has been set to false to avoid hydration mismatches"
        );
      }
      immediatelyRender = false;
    } else if (isNext && explicit === void 0) {
      immediatelyRender = false;
      if (isDev) {
        console.warn(
          "Next.js detected. `immediatelyRender` defaults to false to avoid hydration mismatches. Pass `immediatelyRender: true` explicitly if you are rendering the editor only on the client."
        );
      }
    }
    return immediatelyRender ? this.createEditor() : null;
  }
  /**
   * Create a new editor instance. And attach event listeners.
   */
  createEditor() {
    const optionsToApply = {
      ...this.options.current,
      // Always call the most recent version of the callback function by default
      onBeforeCreate: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onBeforeCreate) == null ? void 0 : _b.call(_a, ...args);
      },
      onBlur: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onBlur) == null ? void 0 : _b.call(_a, ...args);
      },
      onCreate: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onCreate) == null ? void 0 : _b.call(_a, ...args);
      },
      onDestroy: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onDestroy) == null ? void 0 : _b.call(_a, ...args);
      },
      onFocus: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onFocus) == null ? void 0 : _b.call(_a, ...args);
      },
      onSelectionUpdate: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onSelectionUpdate) == null ? void 0 : _b.call(_a, ...args);
      },
      onTransaction: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onTransaction) == null ? void 0 : _b.call(_a, ...args);
      },
      onUpdate: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onUpdate) == null ? void 0 : _b.call(_a, ...args);
      },
      onContentError: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onContentError) == null ? void 0 : _b.call(_a, ...args);
      },
      onDrop: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onDrop) == null ? void 0 : _b.call(_a, ...args);
      },
      onPaste: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onPaste) == null ? void 0 : _b.call(_a, ...args);
      },
      onDelete: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onDelete) == null ? void 0 : _b.call(_a, ...args);
      },
      onMount: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onMount) == null ? void 0 : _b.call(_a, ...args);
      },
      onUnmount: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onUnmount) == null ? void 0 : _b.call(_a, ...args);
      }
    };
    const editor = new import_core.Editor(optionsToApply);
    return editor;
  }
  /**
   * Get the current editor instance.
   */
  getEditor() {
    return this.editor;
  }
  /**
   * Always disable the editor on the server-side.
   */
  getServerSnapshot() {
    return null;
  }
  /**
   * Subscribe to the editor instance's changes.
   */
  subscribe(onStoreChange) {
    this.subscriptions.add(onStoreChange);
    return () => {
      this.subscriptions.delete(onStoreChange);
    };
  }
  static compareOptions(a, b) {
    return Object.keys(a).every((key) => {
      if ([
        "onCreate",
        "onBeforeCreate",
        "onDestroy",
        "onUpdate",
        "onTransaction",
        "onFocus",
        "onBlur",
        "onSelectionUpdate",
        "onContentError",
        "onDrop",
        "onPaste"
      ].includes(key)) {
        return true;
      }
      if (key === "extensions" && a.extensions && b.extensions) {
        if (a.extensions.length !== b.extensions.length) {
          return false;
        }
        return a.extensions.every((extension, index) => {
          var _a;
          if (extension !== ((_a = b.extensions) == null ? void 0 : _a[index])) {
            return false;
          }
          return true;
        });
      }
      if (a[key] !== b[key]) {
        return false;
      }
      return true;
    });
  }
  /**
   * On each render, we will create, update, or destroy the editor instance.
   * @param deps The dependencies to watch for changes
   * @returns A cleanup function
   */
  onRender(deps) {
    return () => {
      this.isComponentMounted = true;
      clearTimeout(this.scheduledDestructionTimeout);
      if (this.editor && !this.editor.isDestroyed && deps.length === 0) {
        if (!_EditorInstanceManager.compareOptions(this.options.current, this.editor.options)) {
          this.editor.setOptions({
            ...this.options.current,
            editable: this.editor.isEditable
          });
        }
      } else {
        this.refreshEditorInstance(deps);
      }
      return () => {
        this.isComponentMounted = false;
        this.scheduleDestroy();
      };
    };
  }
  /**
   * Recreate the editor instance if the dependencies have changed.
   */
  refreshEditorInstance(deps) {
    if (this.editor && !this.editor.isDestroyed) {
      if (this.previousDeps === null) {
        this.previousDeps = deps;
        return;
      }
      const depsAreEqual = this.previousDeps.length === deps.length && this.previousDeps.every((dep, index) => dep === deps[index]);
      if (depsAreEqual) {
        return;
      }
    }
    if (this.editor && !this.editor.isDestroyed) {
      this.editor.destroy();
    }
    this.setEditor(this.createEditor());
    this.previousDeps = deps;
  }
  /**
   * Schedule the destruction of the editor instance.
   * This will only destroy the editor if it was not mounted on the next tick.
   * This is to avoid destroying the editor instance when it's actually still mounted.
   */
  scheduleDestroy() {
    const currentInstanceId = this.instanceId;
    const currentEditor = this.editor;
    this.scheduledDestructionTimeout = setTimeout(() => {
      if (this.isComponentMounted && this.instanceId === currentInstanceId) {
        if (currentEditor) {
          currentEditor.setOptions(this.options.current);
        }
        return;
      }
      if (currentEditor && !currentEditor.isDestroyed) {
        currentEditor.destroy();
        if (this.instanceId === currentInstanceId) {
          this.setEditor(null);
        }
      }
    }, 1);
  }
};
function useEditor(options = {}, deps = []) {
  const mostRecentOptions = (0, import_react3.useRef)(options);
  mostRecentOptions.current = options;
  const [instanceManager] = (0, import_react3.useState)(() => new EditorInstanceManager(mostRecentOptions));
  const editor = (0, import_shim2.useSyncExternalStore)(
    instanceManager.subscribe,
    instanceManager.getEditor,
    instanceManager.getServerSnapshot
  );
  (0, import_react3.useDebugValue)(editor);
  (0, import_react3.useEffect)(instanceManager.onRender(deps));
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => {
      if (options.shouldRerenderOnTransaction === false || options.shouldRerenderOnTransaction === void 0) {
        return null;
      }
      if (options.immediatelyRender && transactionNumber === 0) {
        return 0;
      }
      return transactionNumber + 1;
    }
  });
  return editor;
}

// src/Context.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var EditorContext = (0, import_react4.createContext)({
  editor: null
});
var EditorConsumer = EditorContext.Consumer;
var useCurrentEditor = () => (0, import_react4.useContext)(EditorContext);
function EditorProvider({
  children,
  slotAfter,
  slotBefore,
  editorContainerProps = {},
  ...editorOptions
}) {
  const editor = useEditor(editorOptions);
  const contextValue = (0, import_react4.useMemo)(() => ({ editor }), [editor]);
  if (!editor) {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(EditorContext.Provider, { value: contextValue, children: [
    slotBefore,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EditorConsumer, { children: ({ editor: currentEditor }) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EditorContent, { editor: currentEditor, ...editorContainerProps }) }),
    children,
    slotAfter
  ] });
}

// src/useReactNodeView.ts
var import_react5 = require("react");
var ReactNodeViewContext = (0, import_react5.createContext)({
  onDragStart: () => {
  },
  nodeViewContentChildren: void 0,
  nodeViewContentRef: () => {
  }
});
var ReactNodeViewContentProvider = ({
  children,
  content
}) => {
  return (0, import_react5.createElement)(
    ReactNodeViewContext.Provider,
    { value: { nodeViewContentChildren: content } },
    children
  );
};
var useReactNodeView = () => (0, import_react5.useContext)(ReactNodeViewContext);

// src/NodeViewContent.tsx
var import_jsx_runtime3 = (
  // @ts-ignore
  require("react/jsx-runtime")
);
function NodeViewContent({
  as: Tag = "div",
  ...props
}) {
  const { nodeViewContentRef, nodeViewContentChildren } = useReactNodeView();
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    Tag,
    {
      ...props,
      ref: nodeViewContentRef,
      "data-node-view-content": "",
      style: {
        whiteSpace: "pre-wrap",
        ...props.style
      },
      children: nodeViewContentChildren
    }
  );
}

// src/NodeViewWrapper.tsx
var import_react6 = __toESM(require("react"), 1);
var import_jsx_runtime4 = (
  // @ts-ignore
  require("react/jsx-runtime")
);
var NodeViewWrapper = import_react6.default.forwardRef((props, ref) => {
  const { onDragStart } = useReactNodeView();
  const Tag = props.as || "div";
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    Tag,
    {
      ...props,
      ref,
      "data-node-view-wrapper": "",
      onDragStart,
      style: {
        whiteSpace: "normal",
        ...props.style
      }
    }
  );
});

// src/ReactMarkViewRenderer.tsx
var import_core2 = require("@tiptap/core");
var import_react8 = __toESM(require("react"), 1);

// src/ReactRenderer.tsx
var import_react7 = require("react");
var import_react_dom2 = require("react-dom");
var import_jsx_runtime5 = require("react/jsx-runtime");
function isClassComponent(Component) {
  return !!(typeof Component === "function" && Component.prototype && Component.prototype.isReactComponent);
}
function isForwardRefComponent(Component) {
  return !!(typeof Component === "object" && Component.$$typeof && (Component.$$typeof.toString() === "Symbol(react.forward_ref)" || Component.$$typeof.description === "react.forward_ref"));
}
function isMemoComponent(Component) {
  return !!(typeof Component === "object" && Component.$$typeof && (Component.$$typeof.toString() === "Symbol(react.memo)" || Component.$$typeof.description === "react.memo"));
}
function canReceiveRef(Component) {
  if (isClassComponent(Component)) {
    return true;
  }
  if (isForwardRefComponent(Component)) {
    return true;
  }
  if (isMemoComponent(Component)) {
    const wrappedComponent = Component.type;
    if (wrappedComponent) {
      return isClassComponent(wrappedComponent) || isForwardRefComponent(wrappedComponent);
    }
  }
  return false;
}
function isReact19Plus() {
  try {
    if (import_react7.version) {
      const majorVersion = parseInt(import_react7.version.split(".")[0], 10);
      return majorVersion >= 19;
    }
  } catch {
  }
  return false;
}
var ReactRenderer = class {
  /**
   * Immediately creates element and renders the provided React component.
   */
  constructor(component, { editor, props = {}, as = "div", className = "" }) {
    this.ref = null;
    /**
     * Flag to track if the renderer has been destroyed, preventing queued or asynchronous renders from executing after teardown.
     */
    this.destroyed = false;
    this.id = Math.floor(Math.random() * 4294967295).toString();
    this.component = component;
    this.editor = editor;
    this.props = props;
    this.element = document.createElement(as);
    this.element.classList.add("react-renderer");
    if (className) {
      this.element.classList.add(...className.split(" "));
    }
    if (this.editor.isEditorContentInitialized) {
      (0, import_react_dom2.flushSync)(() => {
        this.render();
      });
    } else {
      queueMicrotask(() => {
        if (this.destroyed) {
          return;
        }
        this.render();
      });
    }
  }
  /**
   * Render the React component.
   */
  render() {
    var _a;
    if (this.destroyed) {
      return;
    }
    const Component = this.component;
    const props = this.props;
    const editor = this.editor;
    const isReact19 = isReact19Plus();
    const componentCanReceiveRef = canReceiveRef(Component);
    const elementProps = { ...props };
    if (elementProps.ref && !(isReact19 || componentCanReceiveRef)) {
      delete elementProps.ref;
    }
    if (!elementProps.ref && (isReact19 || componentCanReceiveRef)) {
      elementProps.ref = (ref) => {
        this.ref = ref;
      };
    }
    this.reactElement = /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Component, { ...elementProps });
    (_a = editor == null ? void 0 : editor.contentComponent) == null ? void 0 : _a.setRenderer(this.id, this);
  }
  /**
   * Re-renders the React component with new props.
   * Skips the render if none of the supplied props actually changed,
   * to avoid unnecessary portal re-creation.
   */
  updateProps(props = {}) {
    if (this.destroyed) {
      return;
    }
    let changed = false;
    const keys = Object.keys(props);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (props[key] !== this.props[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      return;
    }
    this.props = {
      ...this.props,
      ...props
    };
    this.render();
  }
  /**
   * Destroy the React component.
   */
  destroy() {
    var _a;
    this.destroyed = true;
    const editor = this.editor;
    (_a = editor == null ? void 0 : editor.contentComponent) == null ? void 0 : _a.removeRenderer(this.id);
    try {
      if (this.element && this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
    } catch {
    }
  }
  /**
   * Update the attributes of the element that holds the React component.
   */
  updateAttributes(attributes) {
    Object.keys(attributes).forEach((key) => {
      this.element.setAttribute(key, attributes[key]);
    });
  }
};

// src/ReactMarkViewRenderer.tsx
var import_jsx_runtime6 = (
  // @ts-ignore
  require("react/jsx-runtime")
);
var ReactMarkViewContext = import_react8.default.createContext({
  markViewContentRef: () => {
  }
});
var MarkViewContent = (props) => {
  const { as: Tag = "span", ...rest } = props;
  const { markViewContentRef } = import_react8.default.useContext(ReactMarkViewContext);
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Tag, { ...rest, ref: markViewContentRef, "data-mark-view-content": "" });
};
var ReactMarkView = class extends import_core2.MarkView {
  constructor(component, props, options) {
    super(component, props, options);
    const { as = "span", attrs, className = "" } = options || {};
    const componentProps = {
      ...props,
      updateAttributes: this.updateAttributes.bind(this)
    };
    this.contentDOMElement = document.createElement("span");
    const markViewContentRef = (el) => {
      if (el && !el.contains(this.contentDOMElement)) {
        el.appendChild(this.contentDOMElement);
      }
    };
    const context = {
      markViewContentRef
    };
    const ReactMarkViewProvider = import_react8.default.memo(
      (componentProps2) => {
        return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ReactMarkViewContext.Provider, { value: context, children: import_react8.default.createElement(component, componentProps2) });
      }
    );
    ReactMarkViewProvider.displayName = "ReactMarkView";
    this.renderer = new ReactRenderer(ReactMarkViewProvider, {
      editor: props.editor,
      props: componentProps,
      as,
      className: `mark-${props.mark.type.name} ${className}`.trim()
    });
    if (attrs) {
      this.renderer.updateAttributes(attrs);
    }
  }
  get dom() {
    return this.renderer.element;
  }
  get contentDOM() {
    return this.contentDOMElement;
  }
};
function ReactMarkViewRenderer(component, options = {}) {
  return (props) => new ReactMarkView(component, props, options);
}

// src/ReactNodeViewRenderer.tsx
var import_core3 = require("@tiptap/core");
var import_react9 = require("react");
var import_jsx_runtime7 = require("react/jsx-runtime");
var ReactNodeView = class extends import_core3.NodeView {
  constructor(component, props, options) {
    super(component, props, options);
    /**
     * The requestAnimationFrame ID used for selection updates.
     */
    this.selectionRafId = null;
    /**
     * Fires on editor updates when trackNodeViewPosition is enabled.
     * Detects position shifts where update() is NOT called (e.g. typing above).
     */
    this.handlePositionUpdate = () => {
      const newPos = this.getPos();
      if (typeof newPos !== "number" || newPos === this.currentPos) {
        return;
      }
      this.currentPos = newPos;
      this.renderer.updateProps({ getPos: () => this.getPos() });
      if (typeof this.options.attrs === "function") {
        this.updateElementAttributes();
      }
    };
    this.cachedExtensionWithSyncedStorage = null;
    if (!this.node.isLeaf) {
      if (this.options.contentDOMElementTag) {
        this.contentDOMElement = document.createElement(this.options.contentDOMElementTag);
      } else {
        this.contentDOMElement = document.createElement(this.node.isInline ? "span" : "div");
      }
      this.contentDOMElement.dataset.nodeViewContentReact = "";
      this.contentDOMElement.dataset.nodeViewWrapper = "";
      this.contentDOMElement.style.whiteSpace = "inherit";
      const contentTarget = this.dom.querySelector("[data-node-view-content]");
      if (!contentTarget) {
        return;
      }
      contentTarget.appendChild(this.contentDOMElement);
    }
    if (this.options.trackNodeViewPosition) {
      this.editor.on("update", this.handlePositionUpdate);
    }
  }
  /**
   * Returns a proxy of the extension that redirects storage access to the editor's mutable storage.
   * This preserves the original prototype chain (instanceof checks, methods like configure/extend work).
   * Cached to avoid proxy creation on every update.
   */
  get extensionWithSyncedStorage() {
    if (!this.cachedExtensionWithSyncedStorage) {
      const editor = this.editor;
      const extension = this.extension;
      this.cachedExtensionWithSyncedStorage = new Proxy(extension, {
        get(target, prop, receiver) {
          var _a;
          if (prop === "storage") {
            return (_a = editor.storage[extension.name]) != null ? _a : {};
          }
          return Reflect.get(target, prop, receiver);
        }
      });
    }
    return this.cachedExtensionWithSyncedStorage;
  }
  /**
   * Setup the React component.
   * Called on initialization.
   */
  mount() {
    const props = {
      editor: this.editor,
      node: this.node,
      decorations: this.decorations,
      innerDecorations: this.innerDecorations,
      view: this.view,
      selected: false,
      extension: this.extensionWithSyncedStorage,
      HTMLAttributes: this.HTMLAttributes,
      getPos: () => this.getPos(),
      updateAttributes: (attributes = {}) => this.updateAttributes(attributes),
      deleteNode: () => this.deleteNode(),
      ref: (0, import_react9.createRef)()
    };
    const mountProps = props;
    if (!this.component.displayName) {
      const capitalizeFirstChar = (string) => {
        return string.charAt(0).toUpperCase() + string.substring(1);
      };
      this.component.displayName = capitalizeFirstChar(this.extension.name);
    }
    const onDragStart = this.onDragStart.bind(this);
    const nodeViewContentRef = (element) => {
      if (element && this.contentDOMElement && element.firstChild !== this.contentDOMElement) {
        if (element.hasAttribute("data-node-view-wrapper")) {
          element.removeAttribute("data-node-view-wrapper");
        }
        element.appendChild(this.contentDOMElement);
      }
    };
    const context = { onDragStart, nodeViewContentRef };
    const Component = this.component;
    const ReactNodeViewProvider = (0, import_react9.memo)(
      (componentProps) => {
        return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ReactNodeViewContext.Provider, { value: context, children: (0, import_react9.createElement)(Component, componentProps) });
      }
    );
    ReactNodeViewProvider.displayName = "ReactNodeView";
    let as = this.node.isInline ? "span" : "div";
    if (this.options.as) {
      as = this.options.as;
    }
    const { className = "" } = this.options;
    this.handleSelectionUpdate = this.handleSelectionUpdate.bind(this);
    this.renderer = new ReactRenderer(ReactNodeViewProvider, {
      editor: this.editor,
      props: mountProps,
      as,
      className: `node-${this.node.type.name} ${className}`.trim()
    });
    this.editor.on("selectionUpdate", this.handleSelectionUpdate);
    this.updateElementAttributes();
    this.currentPos = this.getPos();
  }
  /**
   * Return the DOM element.
   * This is the element that will be used to display the node view.
   */
  get dom() {
    var _a;
    if (this.renderer.element.firstElementChild && !((_a = this.renderer.element.firstElementChild) == null ? void 0 : _a.hasAttribute("data-node-view-wrapper"))) {
      throw Error("Please use the NodeViewWrapper component for your node view.");
    }
    return this.renderer.element;
  }
  /**
   * Return the content DOM element.
   * This is the element that will be used to display the rich-text content of the node.
   */
  get contentDOM() {
    if (this.node.isLeaf) {
      return null;
    }
    return this.contentDOMElement;
  }
  /**
   * On editor selection update, check if the node is selected.
   * If it is, call `selectNode`, otherwise call `deselectNode`.
   */
  handleSelectionUpdate() {
    if (this.selectionRafId) {
      cancelAnimationFrame(this.selectionRafId);
      this.selectionRafId = null;
    }
    this.selectionRafId = requestAnimationFrame(() => {
      this.selectionRafId = null;
      const pos = this.currentPos;
      if (typeof pos !== "number") {
        return;
      }
      const isSelected = (0, import_core3.isNodeViewSelected)({
        selection: this.editor.state.selection,
        pos,
        nodeSize: this.node.nodeSize,
        selectedOnTextSelection: this.options.selectedOnTextSelection
      });
      if (isSelected) {
        if (this.renderer.props.selected) {
          return;
        }
        this.selectNode();
      } else {
        if (!this.renderer.props.selected) {
          return;
        }
        this.deselectNode();
      }
    });
  }
  /**
   * On update, update the React component.
   * To prevent unnecessary updates, the `update` option can be used.
   */
  update(node, decorations, innerDecorations) {
    const rerenderComponent = (props) => {
      this.renderer.updateProps(props);
      if (typeof this.options.attrs === "function") {
        this.updateElementAttributes();
      }
    };
    if (node.type !== this.node.type) {
      return false;
    }
    if (typeof this.options.update === "function") {
      const oldNode = this.node;
      const oldDecorations = this.decorations;
      const oldInnerDecorations = this.innerDecorations;
      this.node = node;
      this.decorations = decorations;
      this.innerDecorations = innerDecorations;
      this.currentPos = this.getPos();
      return this.options.update({
        oldNode,
        oldDecorations,
        newNode: node,
        newDecorations: decorations,
        oldInnerDecorations,
        innerDecorations,
        updateProps: () => rerenderComponent({
          node,
          decorations,
          innerDecorations,
          extension: this.extensionWithSyncedStorage
        })
      });
    }
    const nodeChanged = node !== this.node;
    if (!nodeChanged) {
      this.node = node;
      this.decorations = decorations;
      this.innerDecorations = innerDecorations;
      return true;
    }
    const newPos = this.getPos();
    this.node = node;
    this.decorations = decorations;
    this.innerDecorations = innerDecorations;
    this.currentPos = newPos;
    const extraProps = {
      node,
      decorations,
      innerDecorations,
      extension: this.extensionWithSyncedStorage
    };
    if (this.options.trackNodeViewPosition) {
      extraProps.getPos = () => this.getPos();
    }
    rerenderComponent(extraProps);
    return true;
  }
  /**
   * Select the node.
   * Add the `selected` prop and the `ProseMirror-selectednode` class.
   */
  selectNode() {
    this.renderer.updateProps({
      selected: true
    });
    this.renderer.element.classList.add("ProseMirror-selectednode");
  }
  /**
   * Deselect the node.
   * Remove the `selected` prop and the `ProseMirror-selectednode` class.
   */
  deselectNode() {
    this.renderer.updateProps({
      selected: false
    });
    this.renderer.element.classList.remove("ProseMirror-selectednode");
  }
  /**
   * Destroy the React component instance.
   */
  destroy() {
    this.renderer.destroy();
    this.editor.off("selectionUpdate", this.handleSelectionUpdate);
    if (this.options.trackNodeViewPosition) {
      this.editor.off("update", this.handlePositionUpdate);
    }
    this.contentDOMElement = null;
    if (this.selectionRafId) {
      cancelAnimationFrame(this.selectionRafId);
      this.selectionRafId = null;
    }
  }
  /**
   * Update the attributes of the top-level element that holds the React component.
   * Applying the attributes defined in the `attrs` option.
   */
  updateElementAttributes() {
    if (this.options.attrs) {
      let attrsObj = {};
      if (typeof this.options.attrs === "function") {
        const extensionAttributes = this.editor.extensionManager.attributes;
        const HTMLAttributes = (0, import_core3.getRenderedAttributes)(this.node, extensionAttributes);
        attrsObj = this.options.attrs({ node: this.node, HTMLAttributes });
      } else {
        attrsObj = this.options.attrs;
      }
      this.renderer.updateAttributes(attrsObj);
    }
  }
};
function ReactNodeViewRenderer(component, options) {
  return (props) => {
    if (!props.editor.contentComponent) {
      return {};
    }
    return new ReactNodeView(component, props, options);
  };
}

// src/Tiptap.tsx
var import_react10 = require("react");
var import_jsx_runtime8 = require("react/jsx-runtime");
var TiptapContext = (0, import_react10.createContext)({
  get editor() {
    throw new Error("useTiptap must be used within a <Tiptap> provider");
  }
});
TiptapContext.displayName = "TiptapContext";
var useTiptap = () => (0, import_react10.useContext)(TiptapContext);
function useTiptapState(selector, equalityFn) {
  const { editor } = useTiptap();
  return useEditorState({
    editor,
    selector,
    equalityFn
  });
}
function TiptapWrapper({ children, ...props }) {
  const resolvedEditor = "editor" in props ? props.editor : props.instance;
  if (!resolvedEditor) {
    throw new Error("Tiptap: An editor instance is required. Pass a non-null `editor` prop.");
  }
  const tiptapContextValue = (0, import_react10.useMemo)(
    () => ({ editor: resolvedEditor }),
    [resolvedEditor]
  );
  const legacyContextValue = (0, import_react10.useMemo)(() => ({ editor: resolvedEditor }), [resolvedEditor]);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(EditorContext.Provider, { value: legacyContextValue, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(TiptapContext.Provider, { value: tiptapContextValue, children }) });
}
TiptapWrapper.displayName = "Tiptap";
function TiptapContent({ ...rest }) {
  const { editor } = useTiptap();
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(EditorContent, { editor, ...rest });
}
TiptapContent.displayName = "Tiptap.Content";
var Tiptap = Object.assign(TiptapWrapper, {
  /**
   * The Tiptap Content component that renders the EditorContent with the editor instance from the context.
   * @see TiptapContent
   */
  Content: TiptapContent
});

// src/index.ts
__reExport(index_exports, require("@tiptap/core"), module.exports);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EditorConsumer,
  EditorContent,
  EditorContext,
  EditorProvider,
  MarkViewContent,
  NodeViewContent,
  NodeViewWrapper,
  PureEditorContent,
  ReactMarkView,
  ReactMarkViewContext,
  ReactMarkViewRenderer,
  ReactNodeView,
  ReactNodeViewContentProvider,
  ReactNodeViewContext,
  ReactNodeViewRenderer,
  ReactRenderer,
  Tiptap,
  TiptapContent,
  TiptapContext,
  TiptapWrapper,
  createContentComponent,
  useCurrentEditor,
  useEditor,
  useEditorState,
  useReactNodeView,
  useTiptap,
  useTiptapState,
  ...require("@tiptap/core")
});
//# sourceMappingURL=index.cjs.map