import * as React from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
export interface TransferLocale {
    description: string;
}
export type EmptySemanticType = {
    classNames?: {
        root?: string;
        image?: string;
        description?: string;
        footer?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        image?: React.CSSProperties;
        description?: React.CSSProperties;
        footer?: React.CSSProperties;
    };
};
export type EmptySemanticAllType = GenerateSemantic<EmptySemanticType, EmptyProps>;
export interface EmptyProps {
    prefixCls?: string;
    className?: string;
    rootClassName?: string;
    style?: React.CSSProperties;
    /** @deprecated Please use `styles.image` instead */
    imageStyle?: React.CSSProperties;
    image?: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
    classNames?: EmptySemanticAllType['classNamesAndFn'];
    styles?: EmptySemanticAllType['stylesAndFn'];
}
type CompoundedComponent = React.FC<EmptyProps> & {
    PRESENTED_IMAGE_DEFAULT: React.ReactNode;
    PRESENTED_IMAGE_SIMPLE: React.ReactNode;
};
declare const Empty: CompoundedComponent;
export default Empty;
