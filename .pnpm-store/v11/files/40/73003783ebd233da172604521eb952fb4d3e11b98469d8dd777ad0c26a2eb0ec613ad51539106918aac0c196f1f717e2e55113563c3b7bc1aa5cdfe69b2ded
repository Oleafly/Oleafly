import React from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { FloatButtonGroupTrigger, FloatButtonProps } from './FloatButton';
export type FloatButtonGroupSemanticType = {
    classNames?: {
        root?: string;
        list?: string;
        item?: string;
        itemIcon?: string;
        itemContent?: string;
        trigger?: string;
        triggerIcon?: string;
        triggerContent?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        list?: React.CSSProperties;
        item?: React.CSSProperties;
        itemIcon?: React.CSSProperties;
        itemContent?: React.CSSProperties;
        trigger?: React.CSSProperties;
        triggerIcon?: React.CSSProperties;
        triggerContent?: React.CSSProperties;
    };
};
export type FloatButtonGroupSemanticAllType = GenerateSemantic<FloatButtonGroupSemanticType, FloatButtonGroupProps>;
export interface FloatButtonGroupProps extends Omit<FloatButtonProps, 'classNames' | 'styles'> {
    classNames?: FloatButtonGroupSemanticAllType['classNamesAndFn'];
    styles?: FloatButtonGroupSemanticAllType['stylesAndFn'];
    trigger?: FloatButtonGroupTrigger;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    closeIcon?: React.ReactNode;
    children: React.ReactNode;
    placement?: 'top' | 'left' | 'right' | 'bottom';
}
declare const FloatButtonGroup: React.FC<Readonly<FloatButtonGroupProps>>;
export default FloatButtonGroup;
