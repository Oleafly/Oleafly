import * as React from 'react';
import type { ImageProps as RcImageProps } from '@rc-component/image';
import type { MaskType } from '../_util/hooks';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import PreviewGroup from './PreviewGroup';
import type { ProgressClassNames, ProgressStyles } from './Progress';
type OriginPreviewConfig = Omit<NonNullable<Exclude<RcImageProps['preview'], boolean>>, 'maskClosable'>;
export type DeprecatedPreviewConfig = {
    /** @deprecated Use `open` instead */
    visible?: boolean;
    /** @deprecated Use `classNames.root` instead */
    rootClassName?: string;
    /**
     * @deprecated This has been removed.
     * Preview will always be rendered after show.
     */
    forceRender?: boolean;
    /**
     * @deprecated This has been removed.
     * Preview will always be rendered after show.
     */
    destroyOnClose?: boolean;
    /** @deprecated Use `actionsRender` instead */
    toolbarRender?: OriginPreviewConfig['actionsRender'];
};
export type PreviewConfig = OriginPreviewConfig & DeprecatedPreviewConfig & {
    /** @deprecated Use `onOpenChange` instead */
    onVisibleChange?: (visible: boolean, prevVisible: boolean) => void;
    /** @deprecated Use `classNames.cover` instead */
    maskClassName?: string;
    mask?: MaskType | React.ReactNode;
};
export interface CompositionImage<P> extends React.FC<P> {
    PreviewGroup: typeof PreviewGroup;
}
export interface ImageProgressConfig {
    percent?: number;
    /** Custom render function, receives default progress UI and percent */
    render?: (progress: React.ReactNode, percent: number) => React.ReactNode;
}
export type PlaceholderType = React.ReactNode | {
    progress?: boolean | ImageProgressConfig;
};
export type ImageSemanticType = {
    classNames?: {
        root?: string;
        image?: string;
        cover?: string;
        placeholder?: {
            progress?: ProgressClassNames;
        };
        popup?: {
            root?: string;
            mask?: string;
            body?: string;
            footer?: string;
            actions?: string;
            close?: string;
        };
    };
    styles?: {
        root?: React.CSSProperties;
        image?: React.CSSProperties;
        cover?: React.CSSProperties;
        placeholder?: {
            progress?: ProgressStyles;
        };
        popup?: {
            root?: React.CSSProperties;
            mask?: React.CSSProperties;
            body?: React.CSSProperties;
            footer?: React.CSSProperties;
            actions?: React.CSSProperties;
            close?: React.CSSProperties;
        };
    };
};
export type ImageSemanticAllType = GenerateSemantic<ImageSemanticType, ImageProps>;
export interface ImageProps extends Omit<RcImageProps, 'preview' | 'classNames' | 'styles' | 'placeholder'> {
    preview?: boolean | PreviewConfig;
    /** @deprecated Use `styles.root` instead */
    wrapperStyle?: React.CSSProperties;
    classNames?: ImageSemanticAllType['classNamesAndFn'];
    styles?: ImageSemanticAllType['stylesAndFn'];
    placeholder?: PlaceholderType;
}
export type { ProgressClassNames, ProgressStyles };
declare const Image: CompositionImage<ImageProps>;
export type { PreviewConfig as ImagePreviewType };
export default Image;
