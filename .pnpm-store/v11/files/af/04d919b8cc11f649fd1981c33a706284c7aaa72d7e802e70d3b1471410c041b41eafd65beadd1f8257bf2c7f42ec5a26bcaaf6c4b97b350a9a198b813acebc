import { SegmentedSize, SegmentedVariant } from "./type.mjs";
import { CSSProperties, ComponentProps, FC, ReactNode } from "react";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
//#region src/base-ui/Segmented/atoms.d.ts
type SegmentedRootProps<Value extends string = string> = Omit<ComponentProps<typeof ToggleGroup<Value>>, 'className' | 'render'> & {
  block?: boolean;
  className?: string;
  glass?: boolean;
  shadow?: boolean;
  variant?: SegmentedVariant;
};
declare const SegmentedRoot: {
  <Value extends string = string>({ block, className, glass, shadow, variant, ...rest }: SegmentedRootProps<Value>): import("react").JSX.Element;
  displayName: string;
};
type SegmentedItemProps<Value extends string = string> = Omit<ComponentProps<typeof Toggle<Value>>, 'className' | 'render'> & {
  block?: boolean;
  className?: string;
  size?: SegmentedSize;
};
declare const SegmentedItem: {
  <Value extends string = string>({ block, className, size, ...rest }: SegmentedItemProps<Value>): import("react").JSX.Element;
  displayName: string;
};
interface SimpleSpanProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}
declare const SegmentedItemIcon: FC<SimpleSpanProps>;
declare const SegmentedItemLabel: FC<SimpleSpanProps>;
interface SegmentedIndicatorProps {
  className?: string;
  style?: CSSProperties;
}
declare const SegmentedIndicator: FC<SegmentedIndicatorProps>;
//#endregion
export { SegmentedIndicator, SegmentedIndicatorProps, SegmentedItem, SegmentedItemIcon, SegmentedItemLabel, SegmentedItemProps, SegmentedRoot, SegmentedRootProps };
//# sourceMappingURL=atoms.d.mts.map