import { CSSProperties } from "react";
//#region src/Skeleton/type.d.ts
interface SkeletonBlockProps {
  active?: boolean;
  className?: string;
  height?: number | string;
  style?: CSSProperties;
  width?: number | string;
}
interface SkeletonTitleProps extends Omit<SkeletonBlockProps, 'height'> {
  fontSize?: number;
  height?: number;
  lineHeight?: number;
  width?: number | string;
}
interface SkeletonParagraphProps extends Omit<SkeletonBlockProps, 'width' | 'height'> {
  fontSize?: number;
  gap?: number;
  height?: number;
  lineHeight?: number;
  rows?: number;
  width?: number | string | (number | string)[];
}
interface SkeletonTagsProps extends Omit<SkeletonBlockProps, 'width'> {
  count?: number;
  gap?: number;
  size?: 'small' | 'middle' | 'large';
  width?: number | string | (number | string)[];
}
interface SkeletonAvatarProps extends SkeletonBlockProps {
  shape?: 'circle' | 'square';
  size?: number | string;
}
interface SkeletonButtonProps extends SkeletonBlockProps {
  block?: boolean;
  shape?: 'circle' | 'round' | 'default';
  size?: 'large' | 'small' | 'default';
}
interface SkeletonProps extends SkeletonBlockProps {
  avatar?: SkeletonAvatarProps | boolean;
  classNames?: {
    avatar?: string;
    paragraph?: string;
    root?: string;
    title?: string;
  };
  gap?: number;
  paragraph?: SkeletonParagraphProps | boolean;
  styles?: {
    avatar?: CSSProperties;
    paragraph?: CSSProperties;
    root?: CSSProperties;
    title?: CSSProperties;
  };
  title?: SkeletonTitleProps | boolean;
}
//#endregion
export { SkeletonAvatarProps, SkeletonBlockProps, SkeletonButtonProps, SkeletonParagraphProps, SkeletonProps, SkeletonTagsProps, SkeletonTitleProps };
//# sourceMappingURL=type.d.mts.map