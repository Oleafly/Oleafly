import * as React from 'react';
import type { Orientation } from "../../internals/types.mjs";
import type { CompositeMetadata } from "../../internals/composite/list/CompositeList.mjs";
import type { ToolbarRoot } from "./ToolbarRoot.mjs";
export interface ToolbarRootContext {
  disabled: boolean;
  orientation: Orientation;
  setItemMap: React.Dispatch<React.SetStateAction<Map<Node, CompositeMetadata<ToolbarRoot.ItemMetadata> | null>>>;
}
export declare const ToolbarRootContext: React.Context<ToolbarRootContext | undefined>;
export declare function useToolbarRootContext(optional?: false): ToolbarRootContext;
export declare function useToolbarRootContext(optional: true): ToolbarRootContext | undefined;