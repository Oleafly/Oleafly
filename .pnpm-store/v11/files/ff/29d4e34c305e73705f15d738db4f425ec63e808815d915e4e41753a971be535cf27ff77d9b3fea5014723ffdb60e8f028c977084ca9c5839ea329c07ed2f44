import * as React from 'react';
import type { SizeType } from '../config-provider/SizeContext';
export type ElementSemanticType = {
    classNames?: {
        root?: string;
        content?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        content?: React.CSSProperties;
    };
};
export interface SkeletonElementProps {
    prefixCls?: string;
    className?: string;
    rootClassName?: string;
    style?: React.CSSProperties;
    /**
     * Note: `default` is deprecated and will be removed in v7, please use `medium` instead.
     */
    size?: SizeType | number | 'default';
    shape?: 'circle' | 'square' | 'round' | 'default';
    active?: boolean;
    classNames?: ElementSemanticType['classNames'];
    styles?: ElementSemanticType['styles'];
}
declare const Element: React.FC<SkeletonElementProps>;
export default Element;
