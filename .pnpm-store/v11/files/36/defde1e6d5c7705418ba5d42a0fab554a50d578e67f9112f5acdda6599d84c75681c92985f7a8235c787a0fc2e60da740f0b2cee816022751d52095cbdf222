import * as React from 'react';
import RcImage from '@rc-component/image';
import type { DeprecatedPreviewConfig, ImageSemanticAllType } from '.';
import type { MaskType } from '../_util/hooks';
import type { GetProps } from '../_util/type';
export declare const icons: {
    rotateLeft: React.JSX.Element;
    rotateRight: React.JSX.Element;
    zoomIn: React.JSX.Element;
    zoomOut: React.JSX.Element;
    close: React.JSX.Element;
    left: React.JSX.Element;
    right: React.JSX.Element;
    flipX: React.JSX.Element;
    flipY: React.JSX.Element;
};
type RcPreviewGroupProps = GetProps<typeof RcImage.PreviewGroup>;
type OriginPreviewConfig = Omit<NonNullable<Exclude<RcPreviewGroupProps['preview'], boolean>>, 'maskClosable'>;
export type GroupPreviewConfig = OriginPreviewConfig & DeprecatedPreviewConfig & {
    /** @deprecated Use `onOpenChange` instead */
    onVisibleChange?: (visible: boolean, prevVisible: boolean, current: number) => void;
    mask?: MaskType;
};
export interface PreviewGroupProps extends Omit<RcPreviewGroupProps, 'preview' | 'styles' | 'classNames'> {
    preview?: boolean | GroupPreviewConfig;
    classNames?: ImageSemanticAllType['classNamesAndFn'];
    styles?: ImageSemanticAllType['stylesAndFn'];
}
declare const InternalPreviewGroup: React.FC<PreviewGroupProps>;
export default InternalPreviewGroup;
