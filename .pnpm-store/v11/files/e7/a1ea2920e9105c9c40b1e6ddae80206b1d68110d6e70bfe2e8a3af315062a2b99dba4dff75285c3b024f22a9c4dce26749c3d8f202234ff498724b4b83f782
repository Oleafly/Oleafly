import { TypographyProps } from "../../Markdown/type.mjs";
import "../../Markdown/index.mjs";
import { ReactNode } from "react";
import { Pluggable } from "unified";
//#region src/mdx/Mdx/index.d.ts
interface MdxProps extends Omit<TypographyProps, 'children'> {
  children: string;
  components?: any[];
  enableImageGallery?: boolean;
  enableLatex?: boolean;
  enableMermaid?: boolean;
  fallback?: ReactNode;
  fullFeaturedCodeBlock?: boolean;
  onDoubleClick?: () => void;
  rehypePlugins?: Pluggable[];
  remarkPlugins?: Pluggable[];
  variant?: 'normal' | 'chat';
}
declare const Mdx: import("react").NamedExoticComponent<MdxProps>;
//#endregion
export { MdxProps, Mdx as default };
//# sourceMappingURL=index.d.mts.map