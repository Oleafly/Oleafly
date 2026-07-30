import { DivProps } from "../types/index.mjs";
import { ActionIconProps } from "../ActionIcon/type.mjs";
import "../ActionIcon/index.mjs";
import { CSSProperties, ReactNode, Ref } from "react";
import { MermaidConfig } from "mermaid";
//#region src/Mermaid/type.d.ts
interface SyntaxMermaidProps {
  animated?: boolean;
  children: string;
  className?: string;
  fallbackClassName?: string;
  ref?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  theme?: MermaidProps['theme'];
  variant?: MermaidProps['variant'];
}
interface MermaidProps extends DivProps {
  actionIconSize?: ActionIconProps['size'];
  actionsRender?: (props: {
    actionIconSize: ActionIconProps['size'];
    content: string;
    getContent: () => string;
    originalNode: ReactNode;
  }) => ReactNode;
  animated?: boolean;
  bodyRender?: (props: {
    content: string;
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
  fileName?: string;
  fullFeatured?: boolean;
  language?: string;
  shadow?: boolean;
  showLanguage?: boolean;
  styles?: {
    body?: CSSProperties;
    content?: CSSProperties;
    header?: CSSProperties;
  };
  theme?: 'lobe-theme' | MermaidConfig['theme'];
  variant?: 'filled' | 'outlined' | 'borderless';
}
//#endregion
export { MermaidProps, SyntaxMermaidProps };
//# sourceMappingURL=type.d.mts.map