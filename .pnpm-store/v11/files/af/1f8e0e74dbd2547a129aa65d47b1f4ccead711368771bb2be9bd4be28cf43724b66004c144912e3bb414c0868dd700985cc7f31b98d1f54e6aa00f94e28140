"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ToastTitle = void 0;
var React = _interopRequireWildcard(require("react"));
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _useId = require("@base-ui/utils/useId");
var _ToastRootContext = require("../root/ToastRootContext");
var _useRenderElement = require("../../internals/useRenderElement");
/**
 * A title that labels the toast.
 * Renders an `<h2>` element.
 *
 * Documentation: [Base UI Toast](https://base-ui.com/react/components/toast)
 */
const ToastTitle = exports.ToastTitle = /*#__PURE__*/React.forwardRef(function ToastTitle(componentProps, forwardedRef) {
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
    setTitleId
  } = (0, _ToastRootContext.useToastRootContext)();
  const children = childrenProp ?? toast.title;
  const shouldRender = Boolean(children);
  const id = (0, _useId.useId)(idProp);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!shouldRender) {
      return undefined;
    }
    setTitleId(id);
    return () => {
      setTitleId(undefined);
    };
  }, [shouldRender, id, setTitleId]);
  const state = {
    type: toast.type
  };
  const element = (0, _useRenderElement.useRenderElement)('h2', componentProps, {
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
if (process.env.NODE_ENV !== "production") ToastTitle.displayName = "ToastTitle";