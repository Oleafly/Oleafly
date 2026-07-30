import * as React from 'react';
import type { JSX } from 'react';
import type { AutoSizeType } from '@rc-component/input';
import type { GenerateSemantic } from '../../_util/hooks/useMergeSemantic/semanticType';
import type { DirectionType } from '../../config-provider';
import type { TooltipProps } from '../../tooltip';
import type { TypographyProps } from '../Typography';
export type BaseType = 'secondary' | 'success' | 'warning' | 'danger';
export type TypographySemanticType = {
    classNames?: {
        root?: string;
        actions?: string;
        action?: string;
        textarea?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        actions?: React.CSSProperties;
        action?: React.CSSProperties;
        textarea?: React.CSSProperties;
    };
};
export interface BaseTypographyProps extends React.HTMLAttributes<HTMLElement> {
    id?: string;
    prefixCls?: string;
    className?: string;
    rootClassName?: string;
    style?: React.CSSProperties;
    classNames?: TypographySemanticAllType['classNamesAndFn'];
    styles?: TypographySemanticAllType['stylesAndFn'];
    children?: React.ReactNode;
    'aria-label'?: string;
    direction?: DirectionType;
    /** @private */
    component?: keyof JSX.IntrinsicElements;
}
export type TypographySemanticAllType = GenerateSemantic<TypographySemanticType, BaseTypographyProps>;
export interface CopyConfig {
    text?: string | (() => string | Promise<string>);
    onCopy?: (event?: React.MouseEvent<HTMLButtonElement>) => void;
    icon?: React.ReactNode;
    tooltips?: React.ReactNode;
    format?: 'text/plain' | 'text/html';
    tabIndex?: number;
}
export interface ActionsConfig {
    placement?: 'start' | 'end';
}
interface EditConfig {
    text?: string;
    editing?: boolean;
    icon?: React.ReactNode;
    tooltip?: React.ReactNode;
    onStart?: () => void;
    onChange?: (value: string) => void;
    onCancel?: () => void;
    onEnd?: () => void;
    maxLength?: number;
    autoSize?: boolean | AutoSizeType;
    triggerType?: ('icon' | 'text')[];
    enterIcon?: React.ReactNode;
    tabIndex?: number;
}
export interface EllipsisConfig {
    rows?: number;
    expandable?: boolean | 'collapsible';
    suffix?: string;
    symbol?: React.ReactNode | ((expanded: boolean) => React.ReactNode);
    defaultExpanded?: boolean;
    expanded?: boolean;
    onExpand?: (e: React.MouseEvent<HTMLElement, MouseEvent>, info: {
        expanded: boolean;
    }) => void;
    onEllipsis?: (ellipsis: boolean) => void;
    tooltip?: React.ReactNode | TooltipProps;
}
export interface BlockProps<C extends keyof JSX.IntrinsicElements = keyof JSX.IntrinsicElements> extends TypographyProps<C> {
    /**
     * @since 6.4.0
     */
    actions?: ActionsConfig;
    title?: string;
    editable?: boolean | EditConfig;
    copyable?: boolean | CopyConfig;
    type?: BaseType;
    disabled?: boolean;
    ellipsis?: boolean | EllipsisConfig;
    code?: boolean;
    mark?: boolean;
    underline?: boolean;
    delete?: boolean;
    strong?: boolean;
    keyboard?: boolean;
    italic?: boolean;
}
declare const Base: React.ForwardRefExoticComponent<BlockProps<keyof JSX.IntrinsicElements> & React.RefAttributes<HTMLElement>>;
export default Base;
