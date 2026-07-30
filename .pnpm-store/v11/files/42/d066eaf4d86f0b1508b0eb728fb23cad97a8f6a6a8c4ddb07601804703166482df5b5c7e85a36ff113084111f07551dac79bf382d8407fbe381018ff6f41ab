import * as React from 'react';
import type { StepsProps as RcStepsProps } from '@rc-component/steps';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { GetProp } from '../_util/type';
import type { SizeType } from '../config-provider/SizeContext';
type RcIconRenderTypeInfo = Parameters<NonNullable<RcStepsProps['iconRender']>>[1];
export type IconRenderType = (oriNode: React.ReactNode, info: Pick<RcIconRenderTypeInfo, 'index' | 'active' | 'item' | 'components'>) => React.ReactNode;
export type StepsSemanticType = {
    classNames?: {
        root?: string;
        item?: string;
        itemWrapper?: string;
        itemIcon?: string;
        itemSection?: string;
        itemHeader?: string;
        itemTitle?: string;
        itemSubtitle?: string;
        itemContent?: string;
        itemRail?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        item?: React.CSSProperties;
        itemWrapper?: React.CSSProperties;
        itemIcon?: React.CSSProperties;
        itemSection?: React.CSSProperties;
        itemHeader?: React.CSSProperties;
        itemTitle?: React.CSSProperties;
        itemSubtitle?: React.CSSProperties;
        itemContent?: React.CSSProperties;
        itemRail?: React.CSSProperties;
    };
};
export type StepsSemanticAllType = GenerateSemantic<StepsSemanticType, StepsProps>;
interface StepItem {
    key?: React.Key;
    className?: string;
    style?: React.CSSProperties;
    classNames?: GetProp<RcStepsProps, 'items'>[number]['classNames'];
    styles?: GetProp<RcStepsProps, 'items'>[number]['styles'];
    /** @deprecated Please use `content` instead */
    description?: React.ReactNode;
    content?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLElement>;
    status?: 'wait' | 'process' | 'finish' | 'error';
    disabled?: boolean;
    title?: React.ReactNode;
    subTitle?: React.ReactNode;
}
export type ProgressDotRender = (iconDot: React.ReactNode, info: {
    index: number;
    status: NonNullable<RcStepsProps['status']>;
    title: React.ReactNode;
    /** @deprecated Please use `content` instead. */
    description: React.ReactNode;
    content: React.ReactNode;
}) => React.ReactNode;
export interface BaseStepsProps {
    className?: string;
    rootClassName?: string;
    classNames?: StepsSemanticAllType['classNamesAndFn'];
    styles?: StepsSemanticAllType['stylesAndFn'];
    variant?: 'filled' | 'outlined';
    /**
     * Note: `default` is deprecated and will be removed in v7, please use `medium` instead.
     */
    size?: Exclude<SizeType, 'large'> | 'default';
    type?: 'default' | 'navigation' | 'inline' | 'panel' | 'dot';
    /** @deprecated Please use `orientation` instead. */
    direction?: 'horizontal' | 'vertical';
    orientation?: 'horizontal' | 'vertical';
    /** @deprecated Please use `titlePlacement` instead. */
    labelPlacement?: 'horizontal' | 'vertical';
    titlePlacement?: 'horizontal' | 'vertical';
    /** @deprecated Please use `type` and `iconRender` instead. */
    progressDot?: boolean | ProgressDotRender;
    responsive?: boolean;
    ellipsis?: boolean;
    /**
     * Maximum number of step items to display (`>= 3`).
     * Hidden step ranges are collapsed into disabled ellipsis steps.
     */
    maxCount?: number;
    /**
     * Set offset cell, only work when `type` is `inline`.
     */
    offset?: number;
    current?: number;
    initial?: number;
    items?: StepItem[];
    percent?: number;
    status?: 'wait' | 'process' | 'finish' | 'error';
    iconRender?: IconRenderType;
    onChange?: (current: number) => void;
}
export interface StepsProps extends BaseStepsProps {
    prefixCls?: string;
    style?: React.CSSProperties;
}
declare const Steps: {
    (props: StepsProps): React.JSX.Element;
    displayName: string;
};
export default Steps;
