"use client";
import { jsx } from 'react/jsx-runtime';
import * as React from 'react';
import { useId, useRef, useMemo } from 'react';
import { PresenceContext } from '../../context/PresenceContext.mjs';
import { useConstant } from '../../utils/use-constant.mjs';
import { useIsomorphicLayoutEffect } from '../../utils/use-isomorphic-effect.mjs';
import { PopChild } from './PopChild.mjs';

const PresenceChild = ({ children, initial, isPresent, onExitComplete, custom, presenceAffectsLayout, mode, anchorX, anchorY, root }) => {
    const presenceChildren = useConstant(newChildrenMap);
    const id = useId();
    // Written in a layout effect (not render) so discarded concurrent
    // renders can't leave the refs pointing at uncommitted state.
    const isPresentRef = useRef(isPresent);
    const onExitCompleteRef = useRef(onExitComplete);
    useIsomorphicLayoutEffect(() => {
        isPresentRef.current = isPresent;
        onExitCompleteRef.current = onExitComplete;
    });
    let isReusedContext = true;
    let context = useMemo(() => {
        isReusedContext = false;
        return {
            id,
            initial,
            isPresent,
            custom,
            onExitComplete: (childId) => {
                presenceChildren.set(childId, true);
                for (const isComplete of presenceChildren.values()) {
                    if (!isComplete)
                        return; // can stop searching when any is incomplete
                }
                onExitComplete && onExitComplete();
            },
            register: (childId) => {
                presenceChildren.set(childId, false);
                return () => {
                    presenceChildren.delete(childId);
                    !isPresentRef.current &&
                        !presenceChildren.size &&
                        onExitCompleteRef.current?.();
                };
            },
        };
    }, [isPresent, presenceChildren, onExitComplete]);
    /**
     * If the presence of a child affects the layout of the components around it,
     * we want to make a new context value to ensure they get re-rendered
     * so they can detect that layout change.
     */
    if (presenceAffectsLayout && isReusedContext) {
        context = { ...context };
    }
    useMemo(() => {
        presenceChildren.forEach((_, key) => presenceChildren.set(key, false));
    }, [isPresent]);
    /**
     * If there's no `motion` components to fire exit animations, we want to remove this
     * component immediately.
     */
    React.useEffect(() => {
        !isPresent &&
            !presenceChildren.size &&
            onExitComplete &&
            onExitComplete();
    }, [isPresent]);
    children = (jsx(PopChild, { pop: mode === "popLayout", isPresent: isPresent, anchorX: anchorX, anchorY: anchorY, root: root, children: children }));
    return (jsx(PresenceContext.Provider, { value: context, children: children }));
};
function newChildrenMap() {
    return new Map();
}

export { PresenceChild };
//# sourceMappingURL=PresenceChild.mjs.map
