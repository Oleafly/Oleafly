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

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Indicator: () => RadioGroupIndicator,
  Item: () => RadioGroupItem,
  RadioGroup: () => RadioGroup,
  RadioGroupIndicator: () => RadioGroupIndicator,
  RadioGroupItem: () => RadioGroupItem,
  Root: () => RadioGroup,
  createRadioGroupScope: () => createRadioGroupScope,
  unstable_ItemBubbleInput: () => RadioGroupItemBubbleInput,
  unstable_ItemProvider: () => RadioGroupItemProvider,
  unstable_ItemTrigger: () => RadioGroupItemTrigger,
  unstable_RadioGroupItemBubbleInput: () => RadioGroupItemBubbleInput,
  unstable_RadioGroupItemProvider: () => RadioGroupItemProvider,
  unstable_RadioGroupItemTrigger: () => RadioGroupItemTrigger
});
module.exports = __toCommonJS(index_exports);

// src/radio-group.tsx
var React2 = __toESM(require("react"));
var import_primitive2 = require("@radix-ui/primitive");
var import_react_compose_refs2 = require("@radix-ui/react-compose-refs");
var import_react_context2 = require("@radix-ui/react-context");
var import_react_primitive2 = require("@radix-ui/react-primitive");
var RovingFocusGroup = __toESM(require("@radix-ui/react-roving-focus"));
var import_react_roving_focus = require("@radix-ui/react-roving-focus");
var import_react_use_controllable_state = require("@radix-ui/react-use-controllable-state");
var import_react_direction = require("@radix-ui/react-direction");

// src/radio.tsx
var React = __toESM(require("react"));
var import_primitive = require("@radix-ui/primitive");
var import_react_compose_refs = require("@radix-ui/react-compose-refs");
var import_react_context = require("@radix-ui/react-context");
var import_react_use_size = require("@radix-ui/react-use-size");
var import_react_use_previous = require("@radix-ui/react-use-previous");
var import_react_presence = require("@radix-ui/react-presence");
var import_react_primitive = require("@radix-ui/react-primitive");
var import_jsx_runtime = require("react/jsx-runtime");
var RADIO_NAME = "Radio";
var [createRadioContext, createRadioScope] = (0, import_react_context.createContextScope)(RADIO_NAME);
var [RadioProviderImpl, useRadioContext] = createRadioContext(RADIO_NAME);
function RadioProvider(props) {
  const {
    __scopeRadio,
    checked = false,
    children,
    disabled,
    form,
    name,
    onCheck,
    required,
    value = "on",
    // @ts-expect-error
    internal_do_not_use_render
  } = props;
  const [control, setControl] = React.useState(null);
  const [bubbleInput, setBubbleInput] = React.useState(null);
  const hasConsumerStoppedPropagationRef = React.useRef(false);
  const isFormControl = control ? !!form || !!control.closest("form") : (
    // We set this to true by default so that events bubble to forms without JS (SSR)
    true
  );
  const context = {
    checked,
    disabled,
    required,
    name,
    form,
    value,
    control,
    setControl,
    hasConsumerStoppedPropagationRef,
    isFormControl,
    bubbleInput,
    setBubbleInput,
    onCheck: () => onCheck?.()
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RadioProviderImpl, { scope: __scopeRadio, ...context, children: isFunction(internal_do_not_use_render) ? internal_do_not_use_render(context) : children });
}
var TRIGGER_NAME = "RadioTrigger";
var RadioTrigger = React.forwardRef(
  ({ __scopeRadio, onClick, ...radioProps }, forwardedRef) => {
    const {
      checked,
      disabled,
      value,
      setControl,
      onCheck,
      hasConsumerStoppedPropagationRef,
      isFormControl,
      bubbleInput
    } = useRadioContext(TRIGGER_NAME, __scopeRadio);
    const composedRefs = (0, import_react_compose_refs.useComposedRefs)(forwardedRef, setControl);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_react_primitive.Primitive.button,
      {
        type: "button",
        role: "radio",
        "aria-checked": checked,
        "data-state": getState(checked),
        "data-disabled": disabled ? "" : void 0,
        disabled,
        value,
        ...radioProps,
        ref: composedRefs,
        onClick: (0, import_primitive.composeEventHandlers)(onClick, (event) => {
          if (!checked) onCheck();
          if (bubbleInput && isFormControl) {
            hasConsumerStoppedPropagationRef.current = event.isPropagationStopped();
            if (!hasConsumerStoppedPropagationRef.current) event.stopPropagation();
          }
        })
      }
    );
  }
);
RadioTrigger.displayName = TRIGGER_NAME;
var Radio = React.forwardRef(
  (props, forwardedRef) => {
    const { __scopeRadio, name, checked, required, disabled, value, onCheck, form, ...radioProps } = props;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      RadioProvider,
      {
        __scopeRadio,
        checked,
        disabled,
        required,
        onCheck,
        name,
        form,
        value,
        internal_do_not_use_render: ({ isFormControl }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            RadioTrigger,
            {
              ...radioProps,
              ref: forwardedRef,
              __scopeRadio
            }
          ),
          isFormControl && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            RadioBubbleInput,
            {
              __scopeRadio
            }
          )
        ] })
      }
    );
  }
);
Radio.displayName = RADIO_NAME;
var INDICATOR_NAME = "RadioIndicator";
var RadioIndicator = React.forwardRef(
  (props, forwardedRef) => {
    const { __scopeRadio, forceMount, ...indicatorProps } = props;
    const context = useRadioContext(INDICATOR_NAME, __scopeRadio);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react_presence.Presence, { present: forceMount || context.checked, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_react_primitive.Primitive.span,
      {
        "data-state": getState(context.checked),
        "data-disabled": context.disabled ? "" : void 0,
        ...indicatorProps,
        ref: forwardedRef
      }
    ) });
  }
);
RadioIndicator.displayName = INDICATOR_NAME;
var BUBBLE_INPUT_NAME = "RadioBubbleInput";
var RadioBubbleInput = React.forwardRef(
  ({ __scopeRadio, ...props }, forwardedRef) => {
    const {
      control,
      checked,
      required,
      disabled,
      name,
      value,
      form,
      bubbleInput,
      setBubbleInput,
      hasConsumerStoppedPropagationRef
    } = useRadioContext(BUBBLE_INPUT_NAME, __scopeRadio);
    const composedRefs = (0, import_react_compose_refs.useComposedRefs)(forwardedRef, setBubbleInput);
    const prevChecked = (0, import_react_use_previous.usePrevious)(checked);
    const controlSize = (0, import_react_use_size.useSize)(control);
    React.useEffect(() => {
      const input = bubbleInput;
      if (!input) return;
      const inputProto = window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(
        inputProto,
        "checked"
      );
      const setChecked = descriptor.set;
      const bubbles = !hasConsumerStoppedPropagationRef.current;
      if (prevChecked !== checked && setChecked) {
        const event = new Event("click", { bubbles });
        setChecked.call(input, checked);
        input.dispatchEvent(event);
      }
    }, [bubbleInput, prevChecked, checked, hasConsumerStoppedPropagationRef]);
    const defaultCheckedRef = React.useRef(checked);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_react_primitive.Primitive.input,
      {
        type: "radio",
        "aria-hidden": true,
        defaultChecked: defaultCheckedRef.current,
        required,
        disabled,
        name,
        value,
        form,
        ...props,
        tabIndex: -1,
        ref: composedRefs,
        style: {
          ...props.style,
          ...controlSize,
          position: "absolute",
          pointerEvents: "none",
          opacity: 0,
          margin: 0,
          // We transform because the input is absolutely positioned but we have
          // rendered it **after** the button. This pulls it back to sit on top
          // of the button.
          transform: "translateX(-100%)"
        }
      }
    );
  }
);
RadioBubbleInput.displayName = BUBBLE_INPUT_NAME;
function isFunction(value) {
  return typeof value === "function";
}
function getState(checked) {
  return checked ? "checked" : "unchecked";
}

// src/radio-group.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
var RADIO_GROUP_NAME = "RadioGroup";
var [createRadioGroupContext, createRadioGroupScope] = (0, import_react_context2.createContextScope)(RADIO_GROUP_NAME, [
  import_react_roving_focus.createRovingFocusGroupScope,
  createRadioScope
]);
var useRovingFocusGroupScope = (0, import_react_roving_focus.createRovingFocusGroupScope)();
var useRadioScope = createRadioScope();
var [RadioGroupProvider, useRadioGroupContext] = createRadioGroupContext(RADIO_GROUP_NAME);
var RadioGroup = React2.forwardRef(
  (props, forwardedRef) => {
    const {
      __scopeRadioGroup,
      name,
      form,
      defaultValue,
      value: valueProp,
      required = false,
      disabled = false,
      orientation,
      dir,
      loop = true,
      onValueChange,
      ...groupProps
    } = props;
    const rovingFocusGroupScope = useRovingFocusGroupScope(__scopeRadioGroup);
    const direction = (0, import_react_direction.useDirection)(dir);
    const [value, setValue] = (0, import_react_use_controllable_state.useControllableState)({
      prop: valueProp,
      defaultProp: defaultValue ?? null,
      onChange: onValueChange,
      caller: RADIO_GROUP_NAME
    });
    const [control, setControl] = React2.useState(null);
    const composedRefs = (0, import_react_compose_refs2.useComposedRefs)(forwardedRef, setControl);
    const initialValueRef = React2.useRef(value);
    React2.useEffect(() => {
      const associatedForm = form ? control?.ownerDocument.getElementById(form) : control?.closest("form");
      if (associatedForm instanceof HTMLFormElement) {
        const reset = () => setValue(initialValueRef.current);
        associatedForm.addEventListener("reset", reset);
        return () => associatedForm.removeEventListener("reset", reset);
      }
    }, [control, form, setValue]);
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      RadioGroupProvider,
      {
        scope: __scopeRadioGroup,
        name,
        form,
        required,
        disabled,
        value,
        onValueChange: setValue,
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          RovingFocusGroup.Root,
          {
            asChild: true,
            ...rovingFocusGroupScope,
            orientation,
            dir: direction,
            loop,
            children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              import_react_primitive2.Primitive.div,
              {
                role: "radiogroup",
                "aria-required": required,
                "aria-orientation": orientation,
                "data-disabled": disabled ? "" : void 0,
                dir: direction,
                ...groupProps,
                ref: composedRefs
              }
            )
          }
        )
      }
    );
  }
);
RadioGroup.displayName = RADIO_GROUP_NAME;
var ITEM_NAME = "RadioGroupItem";
var ITEM_PROVIDER_NAME = "RadioGroupItemProvider";
var ITEM_TRIGGER_NAME = "RadioGroupItemTrigger";
var ITEM_BUBBLE_INPUT_NAME = "RadioGroupItemBubbleInput";
function RadioGroupItemProvider(props) {
  const {
    __scopeRadioGroup,
    value,
    disabled,
    children,
    // @ts-expect-error
    internal_do_not_use_render
  } = props;
  const context = useRadioGroupContext(ITEM_PROVIDER_NAME, __scopeRadioGroup);
  const radioScope = useRadioScope(__scopeRadioGroup);
  const isDisabled = context.disabled || disabled;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    RadioProvider,
    {
      ...radioScope,
      checked: context.value === value,
      disabled: isDisabled,
      required: context.required,
      name: context.name,
      form: context.form,
      value,
      onCheck: () => context.onValueChange(value),
      internal_do_not_use_render,
      children
    }
  );
}
var RadioGroupItemTrigger = React2.forwardRef((props, forwardedRef) => {
  const { __scopeRadioGroup, ...triggerProps } = props;
  const rovingFocusGroupScope = useRovingFocusGroupScope(__scopeRadioGroup);
  const radioScope = useRadioScope(__scopeRadioGroup);
  const { checked, disabled } = useRadioContext(ITEM_TRIGGER_NAME, radioScope.__scopeRadio);
  const ref = React2.useRef(null);
  const composedRefs = (0, import_react_compose_refs2.useComposedRefs)(forwardedRef, ref);
  const isArrowKeyPressedRef = React2.useRef(false);
  React2.useEffect(() => {
    const handleKeyDown = (event) => {
      if (ARROW_KEYS.includes(event.key)) {
        isArrowKeyPressedRef.current = true;
      }
    };
    const handleKeyUp = () => isArrowKeyPressedRef.current = false;
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    RovingFocusGroup.Item,
    {
      asChild: true,
      ...rovingFocusGroupScope,
      focusable: !disabled,
      active: checked,
      children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        RadioTrigger,
        {
          ...radioScope,
          ...triggerProps,
          ref: composedRefs,
          onKeyDown: (0, import_primitive2.composeEventHandlers)(triggerProps.onKeyDown, (event) => {
            if (event.key === "Enter") event.preventDefault();
          }),
          onFocus: (0, import_primitive2.composeEventHandlers)(triggerProps.onFocus, () => {
            if (isArrowKeyPressedRef.current) {
              ref.current?.click();
            }
          })
        }
      )
    }
  );
});
RadioGroupItemTrigger.displayName = ITEM_TRIGGER_NAME;
var RadioGroupItem = React2.forwardRef(
  (props, forwardedRef) => {
    const { __scopeRadioGroup, value, disabled, ...itemProps } = props;
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      RadioGroupItemProvider,
      {
        __scopeRadioGroup,
        value,
        disabled,
        internal_do_not_use_render: ({ isFormControl }) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            RadioGroupItemTrigger,
            {
              ...itemProps,
              ref: forwardedRef,
              __scopeRadioGroup
            }
          ),
          isFormControl && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            RadioGroupItemBubbleInput,
            {
              __scopeRadioGroup
            }
          )
        ] })
      }
    );
  }
);
RadioGroupItem.displayName = ITEM_NAME;
var RadioGroupItemBubbleInput = React2.forwardRef((props, forwardedRef) => {
  const { __scopeRadioGroup, ...bubbleProps } = props;
  const radioScope = useRadioScope(__scopeRadioGroup);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(RadioBubbleInput, { ...radioScope, ...bubbleProps, ref: forwardedRef });
});
RadioGroupItemBubbleInput.displayName = ITEM_BUBBLE_INPUT_NAME;
var INDICATOR_NAME2 = "RadioGroupIndicator";
var RadioGroupIndicator = React2.forwardRef(
  (props, forwardedRef) => {
    const { __scopeRadioGroup, ...indicatorProps } = props;
    const radioScope = useRadioScope(__scopeRadioGroup);
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(RadioIndicator, { ...radioScope, ...indicatorProps, ref: forwardedRef });
  }
);
RadioGroupIndicator.displayName = INDICATOR_NAME2;
//# sourceMappingURL=index.js.map
