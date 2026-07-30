import * as React from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { Breakpoint } from '../_util/responsiveObserver';
import type { SizeType } from '../config-provider/SizeContext';
import DescriptionsContext from './DescriptionsContext';
import type { DescriptionsContextProps } from './DescriptionsContext';
import type { DescriptionsItemProps } from './Item';
import DescriptionsItem from './Item';
interface CompoundedComponent {
    Item: typeof DescriptionsItem;
}
export interface InternalDescriptionsItemType extends Omit<DescriptionsItemProps, 'span'> {
    key?: React.Key;
    filled?: boolean;
    span?: number;
}
export interface DescriptionsItemType extends Omit<DescriptionsItemProps, 'prefixCls'> {
    key?: React.Key;
}
export type DescriptionsSemanticType = {
    classNames?: {
        root?: string;
        header?: string;
        title?: string;
        extra?: string;
        label?: string;
        content?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        header?: React.CSSProperties;
        title?: React.CSSProperties;
        extra?: React.CSSProperties;
        label?: React.CSSProperties;
        content?: React.CSSProperties;
    };
};
export type DescriptionsSemanticAllType = GenerateSemantic<DescriptionsSemanticType, DescriptionsProps>;
export interface DescriptionsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
    prefixCls?: string;
    rootClassName?: string;
    bordered?: boolean;
    /**
     * Note: `default` is deprecated and will be removed in v7, please use `medium` instead.
     */
    size?: SizeType | 'default';
    /**
     * @deprecated use `items` instead
     */
    children?: React.ReactNode;
    title?: React.ReactNode;
    extra?: React.ReactNode;
    column?: number | Partial<Record<Breakpoint, number>>;
    layout?: 'horizontal' | 'vertical';
    colon?: boolean;
    /**
     * @deprecated use `styles.label` instead
     */
    labelStyle?: React.CSSProperties;
    /**
     * @deprecated use `styles.content` instead
     */
    contentStyle?: React.CSSProperties;
    classNames?: DescriptionsSemanticAllType['classNamesAndFn'];
    styles?: DescriptionsSemanticAllType['stylesAndFn'];
    items?: DescriptionsItemType[];
}
declare const Descriptions: React.FC<DescriptionsProps> & CompoundedComponent;
export type { DescriptionsContextProps };
export { DescriptionsContext };
export default Descriptions;
