import * as React from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { SizeType } from '../config-provider/SizeContext';
export type ProgressSemanticType = {
    classNames?: {
        root?: string;
        body?: string;
        rail?: string;
        track?: string;
        indicator?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        body?: React.CSSProperties;
        rail?: React.CSSProperties;
        track?: React.CSSProperties;
        indicator?: React.CSSProperties;
    };
};
export type ProgressSemanticAllType = GenerateSemantic<ProgressSemanticType, ProgressProps>;
export declare const ProgressTypes: readonly ["line", "circle", "dashboard"];
export type ProgressType = (typeof ProgressTypes)[number];
declare const ProgressStatuses: readonly ["normal", "exception", "active", "success"];
/**
 * Note: `default` is deprecated and will be removed in v7, please use `medium` instead.
 */
export type ProgressSize = Exclude<SizeType, 'large'> | 'default';
export type StringGradients = Record<string, string>;
type FromToGradients = {
    from: string;
    to: string;
};
export type ProgressGradient = {
    direction?: string;
} & (StringGradients | FromToGradients);
export interface PercentPositionType {
    align?: 'start' | 'center' | 'end';
    type?: 'inner' | 'outer';
}
export interface SuccessProps {
    percent?: number;
    strokeColor?: string;
}
export type ProgressAriaProps = Pick<React.AriaAttributes, 'aria-label' | 'aria-labelledby'>;
export type GapPlacement = 'top' | 'bottom' | 'start' | 'end';
export type GapPosition = 'top' | 'bottom' | 'left' | 'right';
export interface ProgressProps extends ProgressAriaProps {
    prefixCls?: string;
    className?: string;
    rootClassName?: string;
    classNames?: ProgressSemanticAllType['classNamesAndFn'];
    styles?: ProgressSemanticAllType['stylesAndFn'];
    type?: ProgressType;
    percent?: number;
    format?: (percent?: number, successPercent?: number) => React.ReactNode;
    status?: (typeof ProgressStatuses)[number];
    showInfo?: boolean;
    strokeWidth?: number;
    strokeLinecap?: 'butt' | 'square' | 'round';
    strokeColor?: string | string[] | ProgressGradient;
    /** @deprecated Please use `railColor` instead */
    trailColor?: string;
    railColor?: string;
    /** @deprecated Use `size` instead */
    width?: number;
    success?: SuccessProps;
    style?: React.CSSProperties;
    gapDegree?: number;
    gapPlacement?: GapPlacement;
    /** @deprecated please use `gapPlacement` instead */
    gapPosition?: GapPosition;
    size?: number | [number | string, number] | ProgressSize | {
        width?: number;
        height?: number;
    };
    steps?: number | {
        count: number;
        gap: number;
    };
    percentPosition?: PercentPositionType;
    children?: React.ReactNode;
    rounding?: (step: number) => number;
}
declare const Progress: React.ForwardRefExoticComponent<ProgressProps & React.RefAttributes<HTMLDivElement>>;
export default Progress;
