import { CSSProperties, ReactNode, Ref } from "react";
import { ImageProps } from "antd";
import { PreviewConfig } from "antd/es/image/index.js";
import { GroupPreviewConfig } from "antd/es/image/PreviewGroup.js";
//#region src/Image/type.d.ts
interface PreviewGroupPreviewOptions extends GroupPreviewConfig {
  toolbarAddon?: ReactNode;
}
interface PreviewGroupProps {
  children?: ReactNode;
  enable?: boolean;
  items?: string[];
  preview?: boolean | PreviewGroupPreviewOptions;
}
interface ImagePreviewOptions extends PreviewConfig {
  toolbarAddon?: ReactNode;
}
interface ImageProps$1 extends Omit<ImageProps, 'preview'> {
  actions?: ReactNode;
  alwaysShowActions?: boolean;
  classNames?: {
    image?: string;
    wrapper?: string;
  };
  isLoading?: boolean;
  maxHeight?: number | string;
  maxWidth?: number | string;
  minHeight?: number | string;
  minWidth?: number | string;
  objectFit?: 'cover' | 'contain';
  preview?: boolean | ImagePreviewOptions;
  ref?: Ref<HTMLDivElement>;
  size?: number | string;
  styles?: {
    image?: CSSProperties;
    wrapper?: CSSProperties;
  };
  toolbarAddon?: ReactNode;
  variant?: 'borderless' | 'filled' | 'outlined';
}
//#endregion
export { ImagePreviewOptions, ImageProps$1 as ImageProps, PreviewGroupPreviewOptions, PreviewGroupProps };
//# sourceMappingURL=type.d.mts.map