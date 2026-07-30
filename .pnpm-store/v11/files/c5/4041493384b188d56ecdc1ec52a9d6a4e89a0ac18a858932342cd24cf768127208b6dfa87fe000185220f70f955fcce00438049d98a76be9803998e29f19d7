import * as React from 'react';
import type { Orientation } from "../../internals/types.js";
import type { CompositeMetadata } from "../../internals/composite/list/CompositeList.js";
import type { ToolbarRoot } from "./ToolbarRoot.js";
export interface ToolbarRootContext {
  disabled: boolean;
  orientation: Orientation;
  setItemMap: React.Dispatch<React.SetStateAction<Map<Node, CompositeMetadata<ToolbarRoot.ItemMetadata> | null>>>;
}
export declare const ToolbarRootContext: React.Context<ToolbarRootContext | undefined>;
export declare function useToolbarRootContext(optional?: false): ToolbarRootContext;
export declare function useToolbarRootContext(optional: true): ToolbarRootContext | undefined;