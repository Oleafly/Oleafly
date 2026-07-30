import * as React from 'react';
import type { Tab, TabBarExtraContent } from '@rc-component/tabs';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { SizeType } from '../config-provider/SizeContext';
import type { TabsProps } from '../tabs';
export type CardType = 'inner';
/**
 * Note: `default` is deprecated and will be removed in v7, please use `medium` instead.
 */
export type CardSize = Exclude<SizeType, 'large'> | 'default';
export interface CardTabListType extends Omit<Tab, 'label'> {
    key: string;
    /** @deprecated Please use `label` instead */
    tab?: React.ReactNode;
    label?: React.ReactNode;
}
export type CardSemanticType = {
    classNames?: {
        root?: string;
        header?: string;
        body?: string;
        extra?: string;
        title?: string;
        actions?: string;
        cover?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        header?: React.CSSProperties;
        body?: React.CSSProperties;
        extra?: React.CSSProperties;
        title?: React.CSSProperties;
        actions?: React.CSSProperties;
        cover?: React.CSSProperties;
    };
};
export type CardSemanticAllType = GenerateSemantic<CardSemanticType, CardProps>;
export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
    prefixCls?: string;
    title?: React.ReactNode;
    extra?: React.ReactNode;
    /** @deprecated Please use `variant` instead */
    bordered?: boolean;
    /** @deprecated Please use `styles.header` instead */
    headStyle?: React.CSSProperties;
    /** @deprecated Please use `styles.body` instead */
    bodyStyle?: React.CSSProperties;
    style?: React.CSSProperties;
    loading?: boolean;
    hoverable?: boolean;
    children?: React.ReactNode;
    id?: string;
    className?: string;
    rootClassName?: string;
    size?: CardSize;
    type?: CardType;
    cover?: React.ReactNode;
    actions?: React.ReactNode[];
    tabList?: CardTabListType[];
    tabBarExtraContent?: TabBarExtraContent;
    onTabChange?: (key: string) => void;
    activeTabKey?: string;
    defaultActiveTabKey?: string;
    tabProps?: TabsProps;
    classNames?: CardSemanticAllType['classNamesAndFn'];
    styles?: CardSemanticAllType['stylesAndFn'];
    variant?: 'borderless' | 'outlined';
}
declare const Card: React.ForwardRefExoticComponent<CardProps & React.RefAttributes<HTMLDivElement>>;
export default Card;
