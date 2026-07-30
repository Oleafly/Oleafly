import { DivProps } from "../types/index.mjs";
import { TooltipProps } from "../base-ui/Tooltip/type.mjs";
import "../Tooltip/index.mjs";
import { CSSProperties, ElementType, Ref } from "react";
//#region src/Text/type.d.ts
interface TextProps extends DivProps {
  align?: 'left' | 'center' | 'right';
  as?: ElementType;
  code?: boolean;
  color?: string;
  delete?: boolean;
  disabled?: boolean;
  ellipsis?: boolean | {
    rows?: number;
    tooltip?: boolean | string | TooltipProps;
    tooltipWhenOverflow?: boolean;
  };
  fontSize?: number | string;
  italic?: boolean;
  /**
   * Clamp lines with CSS line-clamp.
   *
   * Note: When `ellipsis` is provided, `ellipsis` takes precedence.
   */
  lineClamp?: number;
  lineHeight?: CSSProperties['lineHeight'];
  mark?: boolean;
  /**
   * Whether to disable wrapping (set `white-space: nowrap`).
   *
   * Note: When multi-line ellipsis is enabled, it will be ignored.
   */
  noWrap?: boolean;
  ref?: Ref<HTMLDivElement>;
  strong?: boolean;
  textDecoration?: CSSProperties['textDecoration'];
  textTransform?: CSSProperties['textTransform'];
  type?: 'secondary' | 'success' | 'warning' | 'danger' | 'info';
  underline?: boolean;
  weight?: 'bold' | 'bolder' | number;
  whiteSpace?: CSSProperties['whiteSpace'];
  wordBreak?: CSSProperties['wordBreak'];
}
//#endregion
export { TextProps };
//# sourceMappingURL=type.d.mts.map