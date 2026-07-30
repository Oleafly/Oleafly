import * as React from 'react';
import type { FloatingTreeType } from "../types.js";
import { FloatingTreeStore } from "./FloatingTreeStore.js";
/**
 * Returns the parent node id for nested floating elements, if available.
 * Returns `null` for top-level floating elements.
 */
export declare const useFloatingParentNodeId: () => string | null;
/**
 * Returns the nearest floating tree context, if available.
 */
export declare const useFloatingTree: (externalTree?: FloatingTreeStore) => FloatingTreeType | null;
/**
 * Registers a node into the `FloatingTree`, returning its id.
 * @see https://floating-ui.com/docs/FloatingTree
 */
export declare function useFloatingNodeId(externalTree?: FloatingTreeStore): string | undefined;
export interface FloatingNodeProps {
  children?: React.ReactNode;
  id: string | undefined;
}
/**
 * Provides parent node context for nested floating elements.
 * @see https://floating-ui.com/docs/FloatingTree
 * @internal
 */
export declare function FloatingNode(props: FloatingNodeProps): React.JSX.Element;
export interface FloatingTreeProps {
  children?: React.ReactNode;
  externalTree?: FloatingTreeStore | undefined;
}
/**
 * Provides context for nested floating elements when they are not children of
 * each other on the DOM.
 * This is not necessary in all cases, except when there must be explicit communication between parent and child floating elements. It is necessary for:
 * - The `bubbles` option in the `useDismiss()` Hook
 * - Nested virtual list navigation
 * - Nested floating elements that each open on hover
 * - Custom communication between parent and child floating elements
 * @see https://floating-ui.com/docs/FloatingTree
 * @internal
 */
export declare function FloatingTree(props: FloatingTreeProps): React.JSX.Element;