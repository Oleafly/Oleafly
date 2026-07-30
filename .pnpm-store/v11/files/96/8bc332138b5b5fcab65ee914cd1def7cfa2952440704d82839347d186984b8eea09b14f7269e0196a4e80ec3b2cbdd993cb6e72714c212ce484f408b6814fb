import * as React from 'react';
import type { GetIndicatorSize, MoreProps, TabsProps as RcTabsProps, Tab } from '@rc-component/tabs';
import RcTabs from '@rc-component/tabs';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { SizeType } from '../config-provider/SizeContext';
import TabPane from './TabPane';
import type { TabPaneProps } from './TabPane';
export type TabsType = 'line' | 'card' | 'editable-card';
export type TabPosition = 'top' | 'right' | 'bottom' | 'left';
export type TabPlacement = 'top' | 'end' | 'bottom' | 'start';
export type { TabPaneProps };
export type TabsSemanticType = {
    classNames?: {
        root?: string;
        item?: string;
        remove?: string;
        indicator?: string;
        body?: string;
        content?: string;
        header?: string;
        popup?: {
            root?: string;
        };
    };
    styles?: {
        root?: React.CSSProperties;
        item?: React.CSSProperties;
        remove?: React.CSSProperties;
        indicator?: React.CSSProperties;
        body?: React.CSSProperties;
        content?: React.CSSProperties;
        header?: React.CSSProperties;
        popup?: {
            root?: React.CSSProperties;
        };
    };
};
export type TabsSemanticAllType = GenerateSemantic<TabsSemanticType, TabsProps>;
export interface CompatibilityProps {
    /** @deprecated Please use `destroyOnHidden` instead */
    destroyInactiveTabPane?: boolean;
}
export interface TabsRef {
    nativeElement: React.ComponentRef<typeof RcTabs> | null;
}
export interface BaseTabsProps {
    type?: TabsType;
    size?: SizeType;
    hideAdd?: boolean;
    centered?: boolean;
    className?: string;
    rootClassName?: string;
    classNames?: TabsSemanticAllType['classNamesAndFn'];
    styles?: TabsSemanticAllType['stylesAndFn'];
    /** @deprecated please use `tabPlacement` instead */
    tabPosition?: TabPosition;
    tabPlacement?: TabPlacement;
    onEdit?: (e: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => void;
    children?: React.ReactNode;
    /** @deprecated Please use `indicator={{ size: ... }}` instead */
    indicatorSize?: GetIndicatorSize;
    items?: (Tab & CompatibilityProps)[];
}
export interface TabsProps extends BaseTabsProps, CompatibilityProps, Omit<RcTabsProps, 'editable' | 'items' | 'classNames' | 'styles' | 'popupClassName'> {
    addIcon?: React.ReactNode;
    moreIcon?: React.ReactNode;
    more?: MoreProps;
    removeIcon?: React.ReactNode;
    /** @deprecated Please use `classNames.popup` instead */
    popupClassName?: string;
}
declare const InternalTabs: React.ForwardRefExoticComponent<TabsProps & React.RefAttributes<TabsRef>>;
type CompoundedComponent = typeof InternalTabs & {
    TabPane: typeof TabPane;
};
declare const Tabs: CompoundedComponent;
export default Tabs;
