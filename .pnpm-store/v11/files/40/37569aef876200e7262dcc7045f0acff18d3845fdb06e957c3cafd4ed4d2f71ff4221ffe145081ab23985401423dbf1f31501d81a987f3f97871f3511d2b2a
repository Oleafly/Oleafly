import React from 'react';
import { LevaRootProps } from "./LevaRoot.js";
type LevaProps = Omit<Partial<LevaRootProps>, 'store'> & {
    isRoot?: boolean;
};
export declare function Leva({ isRoot, ...props }: LevaProps): React.JSX.Element;
/**
 * This hook is used by Leva useControls, and ensures that we spawn a Leva Panel
 * without the user having to put it into the component tree. This should only
 * happen when using the global store
 * @param isGlobalPanel
 */
export declare function useRenderRoot(isGlobalPanel: boolean): void;
export {};
