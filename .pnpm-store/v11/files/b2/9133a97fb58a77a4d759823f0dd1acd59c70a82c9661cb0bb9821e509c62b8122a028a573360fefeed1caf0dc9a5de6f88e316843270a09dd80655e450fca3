"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.LabelableProvider = void 0;
var React = _interopRequireWildcard(require("react"));
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useRefWithInit = require("@base-ui/utils/useRefWithInit");
var _useBaseUiId = require("../useBaseUiId");
var _LabelableContext = require("./LabelableContext");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * @internal
 */
const LabelableProvider = exports.LabelableProvider = function LabelableProvider(props) {
  const defaultId = (0, _useBaseUiId.useBaseUiId)();
  const initialControlId = props.controlId === undefined ? defaultId : props.controlId;
  const [controlId, setControlIdState] = React.useState(initialControlId);
  const [labelId, setLabelId] = React.useState(props.labelId);
  const [messageIds, setMessageIds] = React.useState([]);
  const registrationsRef = (0, _useRefWithInit.useRefWithInit)(() => new Map());
  const {
    messageIds: parentMessageIds
  } = (0, _LabelableContext.useLabelableContext)();
  const registerControlId = (0, _useStableCallback.useStableCallback)((source, nextId) => {
    const registrations = registrationsRef.current;
    if (nextId === undefined) {
      registrations.delete(source);
      return;
    }
    registrations.set(source, nextId);

    // Only flush when registering, not when unregistering.
    // This prevents loops during rapid unmount/remount cycles (e.g. React Activity).
    // The next registration will pick up the correct state.
    setControlIdState(prev => {
      if (registrations.size === 0) {
        return undefined;
      }
      let nextControlId;
      for (const id of registrations.values()) {
        if (prev !== undefined && id === prev) {
          return prev;
        }
        if (nextControlId === undefined) {
          nextControlId = id;
        }
      }
      return nextControlId;
    });
  });
  const getDescriptionProps = React.useCallback(externalProps => {
    const ids = externalProps['aria-describedby'] ? externalProps['aria-describedby'].split(' ') : [];
    ids.push(...parentMessageIds, ...messageIds);
    return {
      ...externalProps,
      'aria-describedby': Array.from(new Set(ids)).join(' ') || undefined
    };
  }, [parentMessageIds, messageIds]);
  const contextValue = React.useMemo(() => ({
    controlId,
    registerControlId,
    labelId,
    setLabelId,
    messageIds,
    setMessageIds,
    getDescriptionProps
  }), [controlId, registerControlId, labelId, setLabelId, messageIds, setMessageIds, getDescriptionProps]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_LabelableContext.LabelableContext.Provider, {
    value: contextValue,
    children: props.children
  });
};
if (process.env.NODE_ENV !== "production") LabelableProvider.displayName = "LabelableProvider";