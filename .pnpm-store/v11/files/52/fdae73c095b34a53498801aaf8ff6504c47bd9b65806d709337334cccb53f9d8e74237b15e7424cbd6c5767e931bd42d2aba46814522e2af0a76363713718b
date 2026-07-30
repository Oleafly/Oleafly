"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.IndexGuessBehavior = void 0;
exports.useCompositeListItem = useCompositeListItem;
var React = _interopRequireWildcard(require("react"));
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _CompositeListContext = require("./CompositeListContext");
let IndexGuessBehavior = exports.IndexGuessBehavior = /*#__PURE__*/function (IndexGuessBehavior) {
  IndexGuessBehavior[IndexGuessBehavior["None"] = 0] = "None";
  IndexGuessBehavior[IndexGuessBehavior["GuessFromOrder"] = 1] = "GuessFromOrder";
  return IndexGuessBehavior;
}({});
/**
 * Used to register a list item and its index (DOM position) in the `CompositeList`.
 */
function useCompositeListItem(params = {}) {
  const {
    label,
    metadata,
    textRef,
    indexGuessBehavior,
    index: externalIndex
  } = params;
  const {
    register,
    unregister,
    subscribeMapChange,
    elementsRef,
    labelsRef,
    nextIndexRef
  } = (0, _CompositeListContext.useCompositeListContext)();
  const indexRef = React.useRef(-1);
  const [index, setIndex] = React.useState(externalIndex ?? (indexGuessBehavior === IndexGuessBehavior.GuessFromOrder ? () => {
    if (indexRef.current === -1) {
      const newIndex = nextIndexRef.current;
      nextIndexRef.current += 1;
      indexRef.current = newIndex;
    }
    return indexRef.current;
  } : -1));
  const componentRef = React.useRef(null);
  const ref = React.useCallback(node => {
    componentRef.current = node;
    if (index !== -1 && node !== null) {
      elementsRef.current[index] = node;
      if (labelsRef) {
        const isLabelDefined = label !== undefined;
        labelsRef.current[index] = isLabelDefined ? label : textRef?.current?.textContent ?? node.textContent;
      }
    }
  }, [index, elementsRef, labelsRef, label, textRef]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (externalIndex != null) {
      return undefined;
    }
    const node = componentRef.current;
    if (node) {
      register(node, metadata);
      return () => {
        unregister(node);
      };
    }
    return undefined;
  }, [externalIndex, register, unregister, metadata]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (externalIndex != null) {
      return undefined;
    }
    return subscribeMapChange(map => {
      const i = componentRef.current ? map.get(componentRef.current)?.index : null;
      if (i != null) {
        setIndex(i);
      }
    });
  }, [externalIndex, subscribeMapChange, setIndex]);
  return {
    ref,
    index
  };
}