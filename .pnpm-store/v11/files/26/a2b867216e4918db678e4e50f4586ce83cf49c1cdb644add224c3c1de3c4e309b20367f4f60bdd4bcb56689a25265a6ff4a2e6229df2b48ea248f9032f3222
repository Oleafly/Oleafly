"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useLabelableId = useLabelableId;
var React = _interopRequireWildcard(require("react"));
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useRefWithInit = require("@base-ui/utils/useRefWithInit");
var _dom = require("@floating-ui/utils/dom");
var _noop = require("../noop");
var _useBaseUiId = require("../useBaseUiId");
var _LabelableContext = require("./LabelableContext");
function useLabelableId(params = {}) {
  const {
    id,
    implicit = false,
    controlRef
  } = params;
  const {
    controlId,
    registerControlId
  } = (0, _LabelableContext.useLabelableContext)();
  const defaultId = (0, _useBaseUiId.useBaseUiId)(id);
  const controlIdForEffect = implicit ? controlId : undefined;
  const controlSourceRef = (0, _useRefWithInit.useRefWithInit)(() => Symbol('labelable-control'));
  const hasRegisteredRef = React.useRef(false);
  const hadExplicitIdRef = React.useRef(id != null);
  const unregisterControlId = (0, _useStableCallback.useStableCallback)(() => {
    if (!hasRegisteredRef.current || registerControlId === _noop.NOOP) {
      return;
    }
    hasRegisteredRef.current = false;
    registerControlId(controlSourceRef.current, undefined);
  });
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (registerControlId === _noop.NOOP) {
      return undefined;
    }
    let nextId;
    if (implicit) {
      const elem = controlRef?.current;
      if ((0, _dom.isElement)(elem) && elem.closest('label') != null) {
        nextId = id ?? null;
      } else {
        nextId = controlIdForEffect ?? defaultId;
      }
    } else if (id != null) {
      hadExplicitIdRef.current = true;
      nextId = id;
    } else if (hadExplicitIdRef.current) {
      nextId = defaultId;
    } else {
      unregisterControlId();
      return undefined;
    }
    if (nextId === undefined) {
      unregisterControlId();
      return undefined;
    }
    hasRegisteredRef.current = true;
    registerControlId(controlSourceRef.current, nextId);
    return undefined;
  }, [id, controlRef, controlIdForEffect, registerControlId, implicit, defaultId, controlSourceRef, unregisterControlId]);
  React.useEffect(() => {
    return unregisterControlId;
  }, [unregisterControlId]);
  return controlId ?? defaultId;
}