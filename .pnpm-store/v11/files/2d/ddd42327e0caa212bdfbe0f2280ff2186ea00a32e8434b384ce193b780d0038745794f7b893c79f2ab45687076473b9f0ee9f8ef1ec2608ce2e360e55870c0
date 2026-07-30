"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ToastDescription = void 0;
var React = _interopRequireWildcard(require("react"));
var _useId = require("@base-ui/utils/useId");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _ToastRootContext = require("../root/ToastRootContext");
var _useRenderElement = require("../../internals/useRenderElement");
/**
 * A description that describes the toast.
 * Can be used as the default message for the toast when no title is provided.
 * Renders a `<p>` element.
 *
 * Documentation: [Base UI Toast](https://base-ui.com/react/components/toast)
 */
const ToastDescription = exports.ToastDescription = /*#__PURE__*/React.forwardRef(function ToastDescription(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    id: idProp,
    children: childrenProp,
    ...elementProps
  } = componentProps;
  const {
    toast,
    setDescriptionId
  } = (0, _ToastRootContext.useToastRootContext)();
  const children = childrenProp ?? toast.description;
  const shouldRender = Boolean(children);
  const id = (0, _useId.useId)(idProp);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!shouldRender) {
      return undefined;
    }
    setDescriptionId(id);
    return () => {
      setDescriptionId(undefined);
    };
  }, [shouldRender, id, setDescriptionId]);
  const state = {
    type: toast.type
  };
  const element = (0, _useRenderElement.useRenderElement)('p', componentProps, {
    ref: forwardedRef,
    state,
    props: {
      ...elementProps,
      id,
      children
    }
  });
  if (!shouldRender) {
    return null;
  }
  return element;
});
if (process.env.NODE_ENV !== "production") ToastDescription.displayName = "ToastDescription";