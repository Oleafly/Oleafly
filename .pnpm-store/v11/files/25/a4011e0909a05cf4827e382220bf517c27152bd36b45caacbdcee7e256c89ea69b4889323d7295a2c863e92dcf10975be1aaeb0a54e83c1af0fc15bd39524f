"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useCheckboxGroupParent = useCheckboxGroupParent;
var React = _interopRequireWildcard(require("react"));
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useBaseUiId = require("../internals/useBaseUiId");
const EMPTY = [];
function useCheckboxGroupParent(params) {
  const {
    allValues = EMPTY,
    value = EMPTY,
    onValueChange: onValueChangeProp
  } = params;
  const uncontrolledStateRef = React.useRef(value);
  const disabledStatesRef = React.useRef(new Map());
  const [status, setStatus] = React.useState('mixed');
  const id = (0, _useBaseUiId.useBaseUiId)();
  const checked = value.length === allValues.length;
  const indeterminate = value.length !== allValues.length && value.length > 0;
  const onValueChange = (0, _useStableCallback.useStableCallback)(onValueChangeProp);
  const getParentProps = React.useCallback(() => ({
    id,
    indeterminate,
    checked,
    // TODO: custom `id` on child checkboxes breaks this
    // https://github.com/mui/base-ui/issues/2691
    'aria-controls': allValues.map(v => `${id}-${v}`).join(' '),
    onCheckedChange(_, eventDetails) {
      const uncontrolledState = uncontrolledStateRef.current;

      // None except the disabled ones that are checked, which can't be changed.
      const none = allValues.filter(v => disabledStatesRef.current.get(v) && uncontrolledState.includes(v));
      // "All" that are valid:
      // - any that aren't disabled
      // - disabled ones that are checked
      const all = allValues.filter(v => !disabledStatesRef.current.get(v) || disabledStatesRef.current.get(v) && uncontrolledState.includes(v));
      const allOnOrOff = uncontrolledState.length === all.length || uncontrolledState.length === 0;
      if (allOnOrOff) {
        if (value.length === all.length) {
          onValueChange(none, eventDetails);
        } else {
          onValueChange(all, eventDetails);
        }
        return;
      }
      let nextStatus = 'mixed';
      let nextValue = uncontrolledState;
      if (status === 'mixed') {
        nextStatus = 'on';
        nextValue = all;
      } else if (status === 'on') {
        nextStatus = 'off';
        nextValue = none;
      }
      onValueChange(nextValue, eventDetails);
      if (!eventDetails.isCanceled) {
        setStatus(nextStatus);
      }
    }
  }), [allValues, checked, id, indeterminate, onValueChange, status, value.length]);
  const getChildProps = React.useCallback(childValue => ({
    checked: value.includes(childValue),
    onCheckedChange(nextChecked, eventDetails) {
      const newValue = value.slice();
      if (nextChecked) {
        newValue.push(childValue);
      } else {
        newValue.splice(newValue.indexOf(childValue), 1);
      }
      onValueChange(newValue, eventDetails);
      if (!eventDetails.isCanceled) {
        uncontrolledStateRef.current = newValue;
        setStatus('mixed');
      }
    }
  }), [onValueChange, value]);
  return React.useMemo(() => ({
    id,
    indeterminate,
    getParentProps,
    getChildProps,
    disabledStatesRef
  }), [id, indeterminate, getParentProps, getChildProps]);
}