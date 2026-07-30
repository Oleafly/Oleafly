import * as React from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { Breakpoint } from '../_util/responsiveObserver';
export interface SiderContextProps {
    siderCollapsed?: boolean;
}
export declare const SiderContext: React.Context<SiderContextProps>;
export type CollapseType = 'clickTrigger' | 'responsive';
export type SiderTheme = 'light' | 'dark';
export type SiderSemanticType = {
    classNames?: {
        root?: string;
        body?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        body?: React.CSSProperties;
    };
};
export type SiderSemanticAllType = GenerateSemantic<SiderSemanticType, SiderProps>;
export interface SiderProps extends React.HTMLAttributes<HTMLDivElement> {
    prefixCls?: string;
    collapsible?: boolean;
    collapsed?: boolean;
    defaultCollapsed?: boolean;
    reverseArrow?: boolean;
    onCollapse?: (collapsed: boolean, type: CollapseType) => void;
    zeroWidthTriggerStyle?: React.CSSProperties;
    trigger?: React.ReactNode;
    width?: number | string;
    collapsedWidth?: number | string;
    breakpoint?: Breakpoint;
    theme?: SiderTheme;
    onBreakpoint?: (broken: boolean) => void;
    classNames?: SiderSemanticAllType['classNamesAndFn'];
    styles?: SiderSemanticAllType['stylesAndFn'];
}
export interface SiderState {
    collapsed?: boolean;
    below: boolean;
}
declare const Sider: React.ForwardRefExoticComponent<SiderProps & React.RefAttributes<HTMLDivElement>>;
export default Sider;
