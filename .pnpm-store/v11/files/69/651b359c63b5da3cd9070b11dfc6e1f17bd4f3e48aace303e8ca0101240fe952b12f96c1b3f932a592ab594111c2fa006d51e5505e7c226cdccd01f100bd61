"use client";

// src/menus/BubbleMenu.tsx
import { BubbleMenuPlugin } from "@tiptap/extension-bubble-menu";
import { useCurrentEditor } from "@tiptap/react";
import React, { useEffect as useEffect2, useRef as useRef2, useState } from "react";
import { createPortal } from "react-dom";

// src/menus/getAutoPluginKey.ts
import { PluginKey } from "@tiptap/pm/state";
function getAutoPluginKey(pluginKey, defaultName) {
  return pluginKey != null ? pluginKey : new PluginKey(defaultName);
}

// src/menus/useMenuElementProps.ts
import { useEffect, useLayoutEffect, useRef } from "react";
var useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
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
  const previousPropsRef = useRef({});
  const listenersRef = useRef([]);
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
var BubbleMenu = React.forwardRef(
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
    const menuEl = useRef2(document.createElement("div"));
    const resolvedPluginKey = useRef2(
      getAutoPluginKey(pluginKey, "bubbleMenu")
    ).current;
    useMenuElementProps(menuEl.current, restProps);
    if (typeof ref === "function") {
      ref(menuEl.current);
    } else if (ref) {
      ref.current = menuEl.current;
    }
    const { editor: currentEditor } = useCurrentEditor();
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
    const bubbleMenuPluginPropsRef = useRef2(bubbleMenuPluginProps);
    bubbleMenuPluginPropsRef.current = bubbleMenuPluginProps;
    const [pluginInitialized, setPluginInitialized] = useState(false);
    const skipFirstUpdateRef = useRef2(true);
    useEffect2(() => {
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
      const plugin = BubbleMenuPlugin({
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
    useEffect2(() => {
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
    return createPortal(children, menuEl.current);
  }
);

// src/menus/FloatingMenu.tsx
import { FloatingMenuPlugin } from "@tiptap/extension-floating-menu";
import { useCurrentEditor as useCurrentEditor2 } from "@tiptap/react";
import React2, { useEffect as useEffect3, useRef as useRef3, useState as useState2 } from "react";
import { createPortal as createPortal2 } from "react-dom";
var FloatingMenu = React2.forwardRef(
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
    const menuEl = useRef3(document.createElement("div"));
    const resolvedPluginKey = useRef3(
      getAutoPluginKey(pluginKey, "floatingMenu")
    ).current;
    useMenuElementProps(menuEl.current, restProps);
    if (typeof ref === "function") {
      ref(menuEl.current);
    } else if (ref) {
      ref.current = menuEl.current;
    }
    const { editor: currentEditor } = useCurrentEditor2();
    const pluginEditor = editor || currentEditor;
    const floatingMenuPluginProps = {
      updateDelay,
      resizeDelay,
      appendTo,
      pluginKey: resolvedPluginKey,
      shouldShow,
      options
    };
    const floatingMenuPluginPropsRef = useRef3(floatingMenuPluginProps);
    floatingMenuPluginPropsRef.current = floatingMenuPluginProps;
    const [pluginInitialized, setPluginInitialized] = useState2(false);
    const skipFirstUpdateRef = useRef3(true);
    useEffect3(() => {
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
      const plugin = FloatingMenuPlugin({
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
    useEffect3(() => {
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
    return createPortal2(children, menuEl.current);
  }
);
export {
  BubbleMenu,
  FloatingMenu
};
//# sourceMappingURL=index.js.map