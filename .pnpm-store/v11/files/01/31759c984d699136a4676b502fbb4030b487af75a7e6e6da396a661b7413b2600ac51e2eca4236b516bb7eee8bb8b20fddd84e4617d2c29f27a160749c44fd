"use client";

// src/Context.tsx
import { createContext, useContext, useMemo } from "react";

// src/EditorContent.tsx
import React, { forwardRef } from "react";
import ReactDOM from "react-dom";
import { useSyncExternalStore } from "use-sync-external-store/shim/index.js";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
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
  const renderers = useSyncExternalStore(
    contentComponent.subscribe,
    contentComponent.getSnapshot,
    contentComponent.getServerSnapshot
  );
  return /* @__PURE__ */ jsx(Fragment, { children: Object.values(renderers) });
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
        [id]: ReactDOM.createPortal(renderer.reactElement, renderer.element, id)
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
var PureEditorContent = class extends React.Component {
  constructor(props) {
    super(props);
    this.editorContentRef = React.createRef();
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
    return /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("div", { ref: mergeRefs(innerRef, this.editorContentRef), ...rest }),
      (editor == null ? void 0 : editor.contentComponent) && /* @__PURE__ */ jsx(Portals, { contentComponent: editor.contentComponent })
    ] });
  }
};
var EditorContentWithKey = forwardRef(
  (props, ref) => {
    const key = React.useMemo(() => {
      return Math.floor(Math.random() * 4294967295).toString();
    }, [props.editor]);
    return React.createElement(PureEditorContent, {
      key,
      innerRef: ref,
      ...props
    });
  }
);
var EditorContent = React.memo(EditorContentWithKey);

// src/useEditor.ts
import { Editor } from "@tiptap/core";
import { useDebugValue as useDebugValue2, useEffect as useEffect2, useRef, useState as useState2 } from "react";
import { useSyncExternalStore as useSyncExternalStore2 } from "use-sync-external-store/shim/index.js";

// src/useEditorState.ts
import { deepEqual } from "fast-equals";
import { useDebugValue, useEffect, useLayoutEffect, useState } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector.js";
var useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
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
  const [editorStateManager] = useState(() => new EditorStateManager(options.editor));
  const selectedState = useSyncExternalStoreWithSelector(
    editorStateManager.subscribe,
    editorStateManager.getSnapshot,
    editorStateManager.getServerSnapshot,
    options.selector,
    (_a = options.equalityFn) != null ? _a : deepEqual
  );
  useIsomorphicLayoutEffect(() => {
    return editorStateManager.watch(options.editor);
  }, [options.editor, editorStateManager]);
  useDebugValue(selectedState);
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
    const editor = new Editor(optionsToApply);
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
  const mostRecentOptions = useRef(options);
  mostRecentOptions.current = options;
  const [instanceManager] = useState2(() => new EditorInstanceManager(mostRecentOptions));
  const editor = useSyncExternalStore2(
    instanceManager.subscribe,
    instanceManager.getEditor,
    instanceManager.getServerSnapshot
  );
  useDebugValue2(editor);
  useEffect2(instanceManager.onRender(deps));
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
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var EditorContext = createContext({
  editor: null
});
var EditorConsumer = EditorContext.Consumer;
var useCurrentEditor = () => useContext(EditorContext);
function EditorProvider({
  children,
  slotAfter,
  slotBefore,
  editorContainerProps = {},
  ...editorOptions
}) {
  const editor = useEditor(editorOptions);
  const contextValue = useMemo(() => ({ editor }), [editor]);
  if (!editor) {
    return null;
  }
  return /* @__PURE__ */ jsxs2(EditorContext.Provider, { value: contextValue, children: [
    slotBefore,
    /* @__PURE__ */ jsx2(EditorConsumer, { children: ({ editor: currentEditor }) => /* @__PURE__ */ jsx2(EditorContent, { editor: currentEditor, ...editorContainerProps }) }),
    children,
    slotAfter
  ] });
}

// src/useReactNodeView.ts
import { createContext as createContext2, createElement, useContext as useContext2 } from "react";
var ReactNodeViewContext = createContext2({
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
  return createElement(
    ReactNodeViewContext.Provider,
    { value: { nodeViewContentChildren: content } },
    children
  );
};
var useReactNodeView = () => useContext2(ReactNodeViewContext);

// src/NodeViewContent.tsx
import { jsx as jsx3 } from "react/jsx-runtime";
function NodeViewContent({
  as: Tag = "div",
  ...props
}) {
  const { nodeViewContentRef, nodeViewContentChildren } = useReactNodeView();
  return (
    // @ts-ignore
    /* @__PURE__ */ jsx3(
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
    )
  );
}

// src/NodeViewWrapper.tsx
import React3 from "react";
import { jsx as jsx4 } from "react/jsx-runtime";
var NodeViewWrapper = React3.forwardRef((props, ref) => {
  const { onDragStart } = useReactNodeView();
  const Tag = props.as || "div";
  return (
    // @ts-ignore
    /* @__PURE__ */ jsx4(
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
    )
  );
});

// src/ReactMarkViewRenderer.tsx
import { MarkView } from "@tiptap/core";
import React4 from "react";

// src/ReactRenderer.tsx
import { version as reactVersion } from "react";
import { flushSync } from "react-dom";
import { jsx as jsx5 } from "react/jsx-runtime";
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
    if (reactVersion) {
      const majorVersion = parseInt(reactVersion.split(".")[0], 10);
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
      flushSync(() => {
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
    this.reactElement = /* @__PURE__ */ jsx5(Component, { ...elementProps });
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
import { jsx as jsx6 } from "react/jsx-runtime";
var ReactMarkViewContext = React4.createContext({
  markViewContentRef: () => {
  }
});
var MarkViewContent = (props) => {
  const { as: Tag = "span", ...rest } = props;
  const { markViewContentRef } = React4.useContext(ReactMarkViewContext);
  return (
    // @ts-ignore
    /* @__PURE__ */ jsx6(Tag, { ...rest, ref: markViewContentRef, "data-mark-view-content": "" })
  );
};
var ReactMarkView = class extends MarkView {
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
    const ReactMarkViewProvider = React4.memo(
      (componentProps2) => {
        return /* @__PURE__ */ jsx6(ReactMarkViewContext.Provider, { value: context, children: React4.createElement(component, componentProps2) });
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
import { getRenderedAttributes, isNodeViewSelected, NodeView } from "@tiptap/core";
import { createElement as createElement2, createRef, memo } from "react";
import { jsx as jsx7 } from "react/jsx-runtime";
var ReactNodeView = class extends NodeView {
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
      ref: createRef()
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
    const ReactNodeViewProvider = memo(
      (componentProps) => {
        return /* @__PURE__ */ jsx7(ReactNodeViewContext.Provider, { value: context, children: createElement2(Component, componentProps) });
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
      const isSelected = isNodeViewSelected({
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
        const HTMLAttributes = getRenderedAttributes(this.node, extensionAttributes);
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
import { createContext as createContext3, useContext as useContext3, useMemo as useMemo2 } from "react";
import { jsx as jsx8 } from "react/jsx-runtime";
var TiptapContext = createContext3({
  get editor() {
    throw new Error("useTiptap must be used within a <Tiptap> provider");
  }
});
TiptapContext.displayName = "TiptapContext";
var useTiptap = () => useContext3(TiptapContext);
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
  const tiptapContextValue = useMemo2(
    () => ({ editor: resolvedEditor }),
    [resolvedEditor]
  );
  const legacyContextValue = useMemo2(() => ({ editor: resolvedEditor }), [resolvedEditor]);
  return /* @__PURE__ */ jsx8(EditorContext.Provider, { value: legacyContextValue, children: /* @__PURE__ */ jsx8(TiptapContext.Provider, { value: tiptapContextValue, children }) });
}
TiptapWrapper.displayName = "Tiptap";
function TiptapContent({ ...rest }) {
  const { editor } = useTiptap();
  return /* @__PURE__ */ jsx8(EditorContent, { editor, ...rest });
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
export * from "@tiptap/core";
export {
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
  useTiptapState
};
//# sourceMappingURL=index.js.map