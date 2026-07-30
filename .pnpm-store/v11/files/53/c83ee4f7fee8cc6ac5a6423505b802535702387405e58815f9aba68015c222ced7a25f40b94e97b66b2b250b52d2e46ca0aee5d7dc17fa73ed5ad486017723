'use client';

import * as React from 'react';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useRefWithInit } from '@base-ui/utils/useRefWithInit';
import { useBaseUiId } from "../useBaseUiId.mjs";
import { LabelableContext, useLabelableContext } from "./LabelableContext.mjs";

/**
 * @internal
 */
import { jsx as _jsx } from "react/jsx-runtime";
export const LabelableProvider = function LabelableProvider(props) {
  const defaultId = useBaseUiId();
  const initialControlId = props.controlId === undefined ? defaultId : props.controlId;
  const [controlId, setControlIdState] = React.useState(initialControlId);
  const [labelId, setLabelId] = React.useState(props.labelId);
  const [messageIds, setMessageIds] = React.useState([]);
  const registrationsRef = useRefWithInit(() => new Map());
  const {
    messageIds: parentMessageIds
  } = useLabelableContext();
  const registerControlId = useStableCallback((source, nextId) => {
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
  return /*#__PURE__*/_jsx(LabelableContext.Provider, {
    value: contextValue,
    children: props.children
  });
};
if (process.env.NODE_ENV !== "production") LabelableProvider.displayName = "LabelableProvider";