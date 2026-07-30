'use client';

import * as React from 'react';
import { useFieldRootContext } from "../../internals/field-root-context/FieldRootContext.mjs";
import { getCombinedFieldValidityData } from "../utils/getCombinedFieldValidityData.mjs";
import { useTransitionStatus } from "../../internals/useTransitionStatus.mjs";

/**
 * Used to display a custom message based on the field's validity.
 * Requires `children` to be a function that accepts field validity state as an argument.
 *
 * Documentation: [Base UI Field](https://base-ui.com/react/components/field)
 */
import { jsx as _jsx } from "react/jsx-runtime";
export const FieldValidity = function FieldValidity(props) {
  const {
    children
  } = props;
  const {
    validityData,
    invalid
  } = useFieldRootContext(false);
  const combinedFieldValidityData = React.useMemo(() => getCombinedFieldValidityData(validityData, invalid), [validityData, invalid]);
  const isInvalid = combinedFieldValidityData.state.valid === false;
  const {
    transitionStatus
  } = useTransitionStatus(isInvalid);
  const fieldValidityState = React.useMemo(() => {
    return {
      ...combinedFieldValidityData,
      validity: combinedFieldValidityData.state,
      transitionStatus
    };
  }, [combinedFieldValidityData, transitionStatus]);
  return /*#__PURE__*/_jsx(React.Fragment, {
    children: children(fieldValidityState)
  });
};
if (process.env.NODE_ENV !== "production") FieldValidity.displayName = "FieldValidity";