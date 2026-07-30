import { FlexboxProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { DivProps } from "../types/index.mjs";
import { ActionIconProps } from "../ActionIcon/type.mjs";
import "../ActionIcon/index.mjs";
import { CSSProperties, ReactNode, Ref } from "react";
import { BuiltinTheme } from "shiki";
//#region src/Highlighter/type.d.ts
interface SyntaxHighlighterProps extends DivProps {
  animated?: boolean;
  children: string;
  enableTransformer?: HighlighterProps['enableTransformer'];
  language: HighlighterProps['language'];
  ref?: Ref<HTMLDivElement>;
  theme?: HighlighterProps['theme'];
  variant?: HighlighterProps['variant'];
}
interface HighlighterProps extends Omit<FlexboxProps, 'children' | 'wrap'> {
  actionIconSize?: ActionIconProps['size'];
  actionsRender?: (props: {
    actionIconSize: ActionIconProps['size'];
    content: string;
    getContent: () => string;
    language: string;
    originalNode: ReactNode;
  }) => ReactNode;
  allowChangeLanguage?: boolean;
  animated?: boolean;
  bodyRender?: (props: {
    content: string;
    language: string;
    originalNode: ReactNode;
  }) => ReactNode;
  children: string;
  classNames?: {
    body?: string;
    content?: string;
    header?: string;
  };
  copyable?: boolean;
  defaultExpand?: boolean;
  enableTransformer?: boolean;
  fileName?: string;
  fullFeatured?: boolean;
  icon?: ReactNode;
  language: string;
  shadow?: boolean;
  showLanguage?: boolean;
  styles?: {
    body?: CSSProperties;
    content?: CSSProperties;
    header?: CSSProperties;
  };
  theme?: 'lobe-theme' | BuiltinTheme;
  variant?: 'filled' | 'outlined' | 'borderless';
  wrap?: boolean;
}
//#endregion
export { HighlighterProps, SyntaxHighlighterProps };
//# sourceMappingURL=type.d.mts.map