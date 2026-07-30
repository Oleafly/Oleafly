"use strict";
/* eslint-disable no-bitwise */
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CompositeList = CompositeList;
var React = _interopRequireWildcard(require("react"));
var _useRefWithInit = require("@base-ui/utils/useRefWithInit");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _CompositeListContext = require("./CompositeListContext");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * Provides context for a list of items in a composite component.
 * @internal
 */
function CompositeList(props) {
  const {
    children,
    elementsRef,
    labelsRef,
    onMapChange: onMapChangeProp
  } = props;
  const onMapChange = (0, _useStableCallback.useStableCallback)(onMapChangeProp);
  const nextIndexRef = React.useRef(0);
  const listeners = (0, _useRefWithInit.useRefWithInit)(createListeners).current;

  // We use a stable `map` to avoid O(n^2) re-allocation costs for large lists.
  // `mapTick` is our re-render trigger mechanism. We also need to update the
  // elements and label refs, but there's a lot of async work going on and sometimes
  // the effect that handles `onMapChange` gets called after those refs have been
  // filled, and we don't want to lose those values by setting their lengths to `0`.
  // We also need to have them at the proper length because floating-ui uses that
  // information for list navigation.

  const map = (0, _useRefWithInit.useRefWithInit)(createMap).current;
  // `mapTick` uses a counter rather than objects for low precision-loss risk and better memory efficiency
  const [mapTick, setMapTick] = React.useState(0);
  const lastTickRef = React.useRef(mapTick);
  const register = (0, _useStableCallback.useStableCallback)((node, metadata) => {
    map.set(node, metadata ?? null);
    lastTickRef.current += 1;
    setMapTick(lastTickRef.current);
  });
  const unregister = (0, _useStableCallback.useStableCallback)(node => {
    map.delete(node);
    lastTickRef.current += 1;
    setMapTick(lastTickRef.current);
  });
  const sortedMap = React.useMemo(() => {
    // `mapTick` is the `useMemo` trigger as `map` is stable.
    disableEslintWarning(mapTick);
    const newMap = new Map();
    // Filter out disconnected elements before sorting to avoid inconsistent
    // compareDocumentPosition results when elements are detached from the DOM.
    const sortedNodes = Array.from(map.keys()).filter(node => node.isConnected).sort(sortByDocumentPosition);
    sortedNodes.forEach((node, index) => {
      const metadata = map.get(node) ?? {};
      newMap.set(node, {
        ...metadata,
        index
      });
    });
    return newMap;
  }, [map, mapTick]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (typeof MutationObserver !== 'function' || sortedMap.size === 0) {
      return undefined;
    }
    const mutationObserver = new MutationObserver(entries => {
      const diff = new Set();
      const updateDiff = node => diff.has(node) ? diff.delete(node) : diff.add(node);
      entries.forEach(entry => {
        entry.removedNodes.forEach(updateDiff);
        entry.addedNodes.forEach(updateDiff);
      });
      if (diff.size === 0) {
        lastTickRef.current += 1;
        setMapTick(lastTickRef.current);
      }
    });
    sortedMap.forEach((_, node) => {
      if (node.parentElement) {
        mutationObserver.observe(node.parentElement, {
          childList: true
        });
      }
    });
    return () => {
      mutationObserver.disconnect();
    };
  }, [sortedMap]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    const shouldUpdateLengths = lastTickRef.current === mapTick;
    if (shouldUpdateLengths) {
      if (elementsRef.current.length !== sortedMap.size) {
        elementsRef.current.length = sortedMap.size;
      }
      if (labelsRef && labelsRef.current.length !== sortedMap.size) {
        labelsRef.current.length = sortedMap.size;
      }
      nextIndexRef.current = sortedMap.size;
    }
    onMapChange(sortedMap);
  }, [onMapChange, sortedMap, elementsRef, labelsRef, mapTick]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    return () => {
      elementsRef.current = [];
    };
  }, [elementsRef]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    return () => {
      if (labelsRef) {
        labelsRef.current = [];
      }
    };
  }, [labelsRef]);
  const subscribeMapChange = (0, _useStableCallback.useStableCallback)(fn => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  });
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    listeners.forEach(l => l(sortedMap));
  }, [listeners, sortedMap]);
  const contextValue = React.useMemo(() => ({
    register,
    unregister,
    subscribeMapChange,
    elementsRef,
    labelsRef,
    nextIndexRef
  }), [register, unregister, subscribeMapChange, elementsRef, labelsRef, nextIndexRef]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_CompositeListContext.CompositeListContext.Provider, {
    value: contextValue,
    children: children
  });
}
function createMap() {
  return new Map();
}
function createListeners() {
  return new Set();
}
function sortByDocumentPosition(a, b) {
  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING || position & Node.DOCUMENT_POSITION_CONTAINED_BY) {
    return -1;
  }
  if (position & Node.DOCUMENT_POSITION_PRECEDING || position & Node.DOCUMENT_POSITION_CONTAINS) {
    return 1;
  }
  return 0;
}
function disableEslintWarning(_) {}