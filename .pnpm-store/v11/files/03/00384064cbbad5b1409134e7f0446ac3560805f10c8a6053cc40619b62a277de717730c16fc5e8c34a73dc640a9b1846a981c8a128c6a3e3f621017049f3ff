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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/menus/index.ts
var index_exports = {};
__export(index_exports, {
  BubbleMenu: () => BubbleMenu,
  FloatingMenu: () => FloatingMenu
});
module.exports = __toCommonJS(index_exports);

// src/menus/BubbleMenu.tsx
var import_extension_bubble_menu = require("@tiptap/extension-bubble-menu");
var import_react2 = require("@tiptap/react");
var import_react3 = __toESM(require("react"), 1);
var import_react_dom = require("react-dom");

// src/menus/getAutoPluginKey.ts
var import_state = require("@tiptap/pm/state");
function getAutoPluginKey(pluginKey, defaultName) {
  return pluginKey != null ? pluginKey : new import_state.PluginKey(defaultName);
}

// src/menus/useMenuElementProps.ts
var import_react = require("react");
var useIsomorphicLayoutEffect = typeof window !== "undefined" ? import_react.useLayoutEffect : import_react.useEffect;
var PLUGIN_MANAGED_STYLE_PROPERTIES = /* @__PURE__ */ new Set([
  "left",
  "opacity",
  "position",
  "top",
  "visibility",
  "width"
]);
var UNITLESS_STYLE_PROPERTIES = /* @__PURE__ */ new Set([
  "animationIterationCount",
  "aspectRatio",
  "borderImageOutset",
  "borderImageSlice",
  "borderImageWidth",
  "columnCount",
  "columns",
  "fillOpacity",
  "flex",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "gridArea",
  "gridColumn",
  "gridColumnEnd",
  "gridColumnStart",
  "gridRow",
  "gridRowEnd",
  "gridRowStart",
  "lineClamp",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "scale",
  "stopOpacity",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeMiterlimit",
  "strokeOpacity",
  "strokeWidth",
  "tabSize",
  "widows",
  "zIndex",
  "zoom"
]);
var ATTRIBUTE_EXCLUSIONS = /* @__PURE__ */ new Set(["children", "className", "style"]);
var DIRECT_PROPERTY_KEYS = /* @__PURE__ */ new Set(["tabIndex"]);
var FORWARDED_ATTRIBUTE_KEYS = /* @__PURE__ */ new Set([
  "accessKey",
  "autoCapitalize",
  "contentEditable",
  "contextMenu",
  "dir",
  "draggable",
  "enterKeyHint",
  "hidden",
  "id",
  "lang",
  "nonce",
  "role",
  "slot",
  "spellCheck",
  "tabIndex",
  "title",
  "translate"
]);
var SPECIAL_EVENT_NAMES = {
  Blur: "focusout",
  DoubleClick: "dblclick",
  Focus: "focusin",
  MouseEnter: "mouseenter",
  MouseLeave: "mouseleave"
};
function isEventProp(key, value) {
  return /^on[A-Z]/.test(key) && typeof value === "function";
}
function toAttributeName(key) {
  if (key.startsWith("aria-") || key.startsWith("data-")) {
    return key;
  }
  return key;
}
function isForwardedAttributeKey(key) {
  return key.startsWith("aria-") || key.startsWith("data-") || FORWARDED_ATTRIBUTE_KEYS.has(key);
}
function toStylePropertyName(key) {
  if (key.startsWith("--")) {
    return key;
  }
  return key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
function toEventConfig(key) {
  var _a;
  const useCapture = key.endsWith("Capture");
  const baseKey = useCapture ? key.slice(0, -7) : key;
  const reactEventName = baseKey.slice(2);
  const eventName = (_a = SPECIAL_EVENT_NAMES[reactEventName]) != null ? _a : reactEventName.toLowerCase();
  return {
    eventName,
    options: useCapture ? { capture: true } : void 0
  };
}
function createSyntheticEvent(element, nativeEvent) {
  let defaultPrevented = nativeEvent.defaultPrevented;
  let propagationStopped = false;
  const syntheticEvent = Object.create(nativeEvent);
  Object.defineProperties(syntheticEvent, {
    nativeEvent: { value: nativeEvent },
    currentTarget: { value: element },
    target: { value: nativeEvent.target },
    persist: { value: () => void 0 },
    isDefaultPrevented: { value: () => defaultPrevented },
    isPropagationStopped: { value: () => propagationStopped },
    preventDefault: {
      value: () => {
        defaultPrevented = true;
        nativeEvent.preventDefault();
      }
    },
    stopPropagation: {
      value: () => {
        propagationStopped = true;
        nativeEvent.stopPropagation();
      }
    }
  });
  return syntheticEvent;
}
function isDirectPropertyKey(key) {
  return DIRECT_PROPERTY_KEYS.has(key);
}
function setDirectProperty(element, key, value) {
  if (key === "tabIndex") {
    element.tabIndex = Number(value);
    return;
  }
  ;
  element[key] = value;
}
function clearDirectProperty(element, key) {
  if (key === "tabIndex") {
    element.removeAttribute("tabindex");
    return;
  }
  const propertyValue = element[key];
  if (typeof propertyValue === "boolean") {
    ;
    element[key] = false;
    return;
  }
  if (typeof propertyValue === "number") {
    ;
    element[key] = 0;
    return;
  }
  ;
  element[key] = "";
}
function toStyleValue(styleName, value) {
  if (typeof value !== "number" || value === 0 || styleName.startsWith("--") || UNITLESS_STYLE_PROPERTIES.has(styleName)) {
    return String(value);
  }
  return `${value}px`;
}
function removeStyleProperty(element, styleName) {
  if (PLUGIN_MANAGED_STYLE_PROPERTIES.has(styleName)) {
    return;
  }
  element.style.removeProperty(toStylePropertyName(styleName));
}
function applyStyleProperty(element, styleName, value) {
  if (PLUGIN_MANAGED_STYLE_PROPERTIES.has(styleName)) {
    return;
  }
  element.style.setProperty(toStylePropertyName(styleName), toStyleValue(styleName, value));
}
function syncAttributes(element, prevProps, nextProps) {
  const allKeys = /* @__PURE__ */ new Set([...Object.keys(prevProps), ...Object.keys(nextProps)]);
  allKeys.forEach((key) => {
    if (ATTRIBUTE_EXCLUSIONS.has(key) || !isForwardedAttributeKey(key) || isEventProp(key, prevProps[key]) || isEventProp(key, nextProps[key])) {
      return;
    }
    const prevValue = prevProps[key];
    const nextValue = nextProps[key];
    if (prevValue === nextValue) {
      return;
    }
    const attributeName = toAttributeName(key);
    if (nextValue == null || nextValue === false) {
      if (isDirectPropertyKey(key)) {
        clearDirectProperty(element, key);
      }
      element.removeAttribute(attributeName);
      return;
    }
    if (nextValue === true) {
      if (isDirectPropertyKey(key)) {
        setDirectProperty(element, key, true);
      }
      element.setAttribute(attributeName, "");
      return;
    }
    if (isDirectPropertyKey(key)) {
      setDirectProperty(element, key, nextValue);
      return;
    }
    element.setAttribute(attributeName, String(nextValue));
  });
}
function syncClassName(element, prevClassName, nextClassName) {
  if (prevClassName === nextClassName) {
    return;
  }
  if (nextClassName) {
    element.className = nextClassName;
    return;
  }
  element.removeAttribute("class");
}
function syncStyles(element, prevStyle, nextStyle) {
  const previousStyle = prevStyle != null ? prevStyle : {};
  const currentStyle = nextStyle != null ? nextStyle : {};
  const allStyleNames = /* @__PURE__ */ new Set([...Object.keys(previousStyle), ...Object.keys(currentStyle)]);
  allStyleNames.forEach((styleName) => {
    const prevValue = previousStyle[styleName];
    const nextValue = currentStyle[styleName];
    if (prevValue === nextValue) {
      return;
    }
    if (nextValue == null) {
      removeStyleProperty(element, styleName);
      return;
    }
    applyStyleProperty(element, styleName, nextValue);
  });
}
function syncEventListeners(element, prevListeners, nextProps) {
  prevListeners.forEach(({ eventName, listener, options }) => {
    element.removeEventListener(eventName, listener, options);
  });
  const nextListeners = [];
  Object.entries(nextProps).forEach(([key, value]) => {
    if (!isEventProp(key, value)) {
      return;
    }
    const { eventName, options } = toEventConfig(key);
    const listener = (event) => {
      value(createSyntheticEvent(element, event));
    };
    element.addEventListener(eventName, listener, options);
    nextListeners.push({ eventName, listener, options });
  });
  return nextListeners;
}
function useMenuElementProps(element, props) {
  const previousPropsRef = (0, import_react.useRef)({});
  const listenersRef = (0, import_react.useRef)([]);
  useIsomorphicLayoutEffect(() => {
    const previousProps = previousPropsRef.current;
    syncClassName(element, previousProps.className, props.className);
    syncStyles(element, previousProps.style, props.style);
    syncAttributes(element, previousProps, props);
    listenersRef.current = syncEventListeners(element, listenersRef.current, props);
    previousPropsRef.current = props;
    return () => {
      listenersRef.current.forEach(({ eventName, listener, options }) => {
        element.removeEventListener(eventName, listener, options);
      });
      listenersRef.current = [];
    };
  }, [element, props]);
}

// src/menus/BubbleMenu.tsx
var BubbleMenu = import_react3.default.forwardRef(
  ({
    pluginKey,
    editor,
    updateDelay,
    resizeDelay,
    appendTo,
    shouldShow = null,
    getReferencedVirtualElement,
    options,
    children,
    ...restProps
  }, ref) => {
    const menuEl = (0, import_react3.useRef)(document.createElement("div"));
    const resolvedPluginKey = (0, import_react3.useRef)(
      getAutoPluginKey(pluginKey, "bubbleMenu")
    ).current;
    useMenuElementProps(menuEl.current, restProps);
    if (typeof ref === "function") {
      ref(menuEl.current);
    } else if (ref) {
      ref.current = menuEl.current;
    }
    const { editor: currentEditor } = (0, import_react2.useCurrentEditor)();
    const pluginEditor = editor || currentEditor;
    const bubbleMenuPluginProps = {
      updateDelay,
      resizeDelay,
      appendTo,
      pluginKey: resolvedPluginKey,
      shouldShow,
      getReferencedVirtualElement,
      options
    };
    const bubbleMenuPluginPropsRef = (0, import_react3.useRef)(bubbleMenuPluginProps);
    bubbleMenuPluginPropsRef.current = bubbleMenuPluginProps;
    const [pluginInitialized, setPluginInitialized] = (0, import_react3.useState)(false);
    const skipFirstUpdateRef = (0, import_react3.useRef)(true);
    (0, import_react3.useEffect)(() => {
      if (pluginEditor == null ? void 0 : pluginEditor.isDestroyed) {
        return;
      }
      if (!pluginEditor) {
        console.warn(
          "BubbleMenu component is not rendered inside of an editor component or does not have editor prop."
        );
        return;
      }
      const bubbleMenuElement = menuEl.current;
      bubbleMenuElement.style.visibility = "hidden";
      bubbleMenuElement.style.position = "absolute";
      const plugin = (0, import_extension_bubble_menu.BubbleMenuPlugin)({
        ...bubbleMenuPluginPropsRef.current,
        editor: pluginEditor,
        element: bubbleMenuElement
      });
      pluginEditor.registerPlugin(plugin);
      const createdPluginKey = bubbleMenuPluginPropsRef.current.pluginKey;
      skipFirstUpdateRef.current = true;
      setPluginInitialized(true);
      return () => {
        setPluginInitialized(false);
        pluginEditor.unregisterPlugin(createdPluginKey);
        window.requestAnimationFrame(() => {
          if (bubbleMenuElement.parentNode) {
            bubbleMenuElement.parentNode.removeChild(bubbleMenuElement);
          }
        });
      };
    }, [pluginEditor]);
    (0, import_react3.useEffect)(() => {
      if (!pluginInitialized || !pluginEditor || pluginEditor.isDestroyed) {
        return;
      }
      if (skipFirstUpdateRef.current) {
        skipFirstUpdateRef.current = false;
        return;
      }
      pluginEditor.view.dispatch(
        pluginEditor.state.tr.setMeta(resolvedPluginKey, {
          type: "updateOptions",
          options: bubbleMenuPluginPropsRef.current
        })
      );
    }, [
      pluginInitialized,
      pluginEditor,
      updateDelay,
      resizeDelay,
      shouldShow,
      options,
      appendTo,
      getReferencedVirtualElement,
      resolvedPluginKey
    ]);
    return (0, import_react_dom.createPortal)(children, menuEl.current);
  }
);

// src/menus/FloatingMenu.tsx
var import_extension_floating_menu = require("@tiptap/extension-floating-menu");
var import_react4 = require("@tiptap/react");
var import_react5 = __toESM(require("react"), 1);
var import_react_dom2 = require("react-dom");
var FloatingMenu = import_react5.default.forwardRef(
  ({
    pluginKey,
    editor,
    updateDelay,
    resizeDelay,
    appendTo,
    shouldShow = null,
    options,
    children,
    ...restProps
  }, ref) => {
    const menuEl = (0, import_react5.useRef)(document.createElement("div"));
    const resolvedPluginKey = (0, import_react5.useRef)(
      getAutoPluginKey(pluginKey, "floatingMenu")
    ).current;
    useMenuElementProps(menuEl.current, restProps);
    if (typeof ref === "function") {
      ref(menuEl.current);
    } else if (ref) {
      ref.current = menuEl.current;
    }
    const { editor: currentEditor } = (0, import_react4.useCurrentEditor)();
    const pluginEditor = editor || currentEditor;
    const floatingMenuPluginProps = {
      updateDelay,
      resizeDelay,
      appendTo,
      pluginKey: resolvedPluginKey,
      shouldShow,
      options
    };
    const floatingMenuPluginPropsRef = (0, import_react5.useRef)(floatingMenuPluginProps);
    floatingMenuPluginPropsRef.current = floatingMenuPluginProps;
    const [pluginInitialized, setPluginInitialized] = (0, import_react5.useState)(false);
    const skipFirstUpdateRef = (0, import_react5.useRef)(true);
    (0, import_react5.useEffect)(() => {
      if (pluginEditor == null ? void 0 : pluginEditor.isDestroyed) {
        return;
      }
      if (!pluginEditor) {
        console.warn(
          "FloatingMenu component is not rendered inside of an editor component or does not have editor prop."
        );
        return;
      }
      const floatingMenuElement = menuEl.current;
      floatingMenuElement.style.visibility = "hidden";
      floatingMenuElement.style.position = "absolute";
      const plugin = (0, import_extension_floating_menu.FloatingMenuPlugin)({
        ...floatingMenuPluginPropsRef.current,
        editor: pluginEditor,
        element: floatingMenuElement
      });
      pluginEditor.registerPlugin(plugin);
      const createdPluginKey = floatingMenuPluginPropsRef.current.pluginKey;
      skipFirstUpdateRef.current = true;
      setPluginInitialized(true);
      return () => {
        setPluginInitialized(false);
        pluginEditor.unregisterPlugin(createdPluginKey);
        window.requestAnimationFrame(() => {
          if (floatingMenuElement.parentNode) {
            floatingMenuElement.parentNode.removeChild(floatingMenuElement);
          }
        });
      };
    }, [pluginEditor]);
    (0, import_react5.useEffect)(() => {
      if (!pluginInitialized || !pluginEditor || pluginEditor.isDestroyed) {
        return;
      }
      if (skipFirstUpdateRef.current) {
        skipFirstUpdateRef.current = false;
        return;
      }
      pluginEditor.view.dispatch(
        pluginEditor.state.tr.setMeta(resolvedPluginKey, {
          type: "updateOptions",
          options: floatingMenuPluginPropsRef.current
        })
      );
    }, [
      pluginInitialized,
      pluginEditor,
      updateDelay,
      resizeDelay,
      shouldShow,
      options,
      appendTo,
      resolvedPluginKey
    ]);
    return (0, import_react_dom2.createPortal)(children, menuEl.current);
  }
);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BubbleMenu,
  FloatingMenu
});
//# sourceMappingURL=index.cjs.map