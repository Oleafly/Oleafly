'use client';

import * as React from 'react';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useControlled } from '@base-ui/utils/useControlled';
import { EMPTY_ARRAY } from '@base-ui/utils/empty';
import { useRenderElement } from "../internals/useRenderElement.mjs";
import { CompositeRoot } from "../internals/composite/root/CompositeRoot.mjs";
import { useToolbarRootContext } from "../toolbar/root/ToolbarRootContext.mjs";
import { useToolbarGroupContext } from "../toolbar/group/ToolbarGroupContext.mjs";
import { ToggleGroupContext } from "./ToggleGroupContext.mjs";
import { ToggleGroupDataAttributes } from "./ToggleGroupDataAttributes.mjs";
import { jsx as _jsx } from "react/jsx-runtime";
const stateAttributesMapping = {
  multiple(value) {
    if (value) {
      return {
        [ToggleGroupDataAttributes.multiple]: ''
      };
    }
    return null;
  }
};

/**
 * Provides a shared state to a series of toggle buttons.
 *
 * Documentation: [Base UI Toggle Group](https://base-ui.com/react/components/toggle-group)
 */
export const ToggleGroup = /*#__PURE__*/React.forwardRef(function ToggleGroup(componentProps, forwardedRef) {
  const {
    defaultValue: defaultValueProp,
    disabled: disabledProp = false,
    loopFocus = true,
    onValueChange,
    orientation = 'horizontal',
    multiple = false,
    value: valueProp,
    className,
    render,
    style,
    ...elementProps
  } = componentProps;
  const toolbarContext = useToolbarRootContext(true);
  const toolbarGroupContext = useToolbarGroupContext(true);
  const isValueInitialized = React.useMemo(() => valueProp !== undefined || defaultValueProp !== undefined, [valueProp, defaultValueProp]);
  const disabled = (toolbarContext?.disabled ?? false) || (toolbarGroupContext?.disabled ?? false) || disabledProp;
  const [groupValue, setValueState] = useControlled({
    controlled: valueProp,
    default: valueProp === undefined ? defaultValueProp ?? EMPTY_ARRAY : undefined,
    name: 'ToggleGroup',
    state: 'value'
  });
  const setGroupValue = useStableCallback((newValue, nextPressed, eventDetails) => {
    let newGroupValue;
    if (multiple) {
      newGroupValue = groupValue.slice();
      if (nextPressed) {
        newGroupValue.push(newValue);
      } else {
        newGroupValue.splice(groupValue.indexOf(newValue), 1);
      }
    } else {
      newGroupValue = nextPressed ? [newValue] : [];
    }
    onValueChange?.(newGroupValue, eventDetails);
    if (eventDetails.isCanceled) {
      return;
    }
    setValueState(newGroupValue);
  });
  const state = {
    disabled,
    multiple,
    orientation
  };
  const contextValue = React.useMemo(() => ({
    disabled,
    orientation,
    setGroupValue,
    value: groupValue,
    isValueInitialized
  }), [disabled, orientation, setGroupValue, groupValue, isValueInitialized]);
  const defaultProps = {
    role: 'group'
  };
  const element = useRenderElement('div', componentProps, {
    enabled: Boolean(toolbarContext),
    state,
    ref: forwardedRef,
    props: [defaultProps, elementProps],
    stateAttributesMapping
  });
  return /*#__PURE__*/_jsx(ToggleGroupContext.Provider, {
    value: contextValue,
    children: toolbarContext ? element : /*#__PURE__*/_jsx(CompositeRoot, {
      render: render,
      className: className,
      style: style,
      state: state,
      refs: [forwardedRef],
      props: [defaultProps, elementProps],
      stateAttributesMapping: stateAttributesMapping,
      loopFocus: loopFocus,
      enableHomeAndEndKeys: true,
      orientation: orientation
    })
  });
});
if (process.env.NODE_ENV !== "production") ToggleGroup.displayName = "ToggleGroup";