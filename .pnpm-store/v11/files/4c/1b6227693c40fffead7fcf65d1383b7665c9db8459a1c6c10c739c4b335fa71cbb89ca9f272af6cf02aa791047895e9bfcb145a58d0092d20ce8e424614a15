import * as React from 'react';
import type { HTMLAriaDataAttributes } from '../_util/aria-data-attrs';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { FormatConfig, valueType } from './utils';
export type StatisticSemanticType = {
    classNames?: {
        root?: string;
        content?: string;
        value?: string;
        title?: string;
        header?: string;
        prefix?: string;
        suffix?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        content?: React.CSSProperties;
        value?: React.CSSProperties;
        title?: React.CSSProperties;
        header?: React.CSSProperties;
        prefix?: React.CSSProperties;
        suffix?: React.CSSProperties;
    };
};
export type StatisticSemanticAllType = GenerateSemantic<StatisticSemanticType, StatisticProps>;
export interface StatisticRef {
    nativeElement: HTMLDivElement;
}
interface StatisticReactProps extends FormatConfig {
    prefixCls?: string;
    className?: string;
    classNames?: StatisticSemanticAllType['classNamesAndFn'];
    styles?: StatisticSemanticAllType['stylesAndFn'];
    rootClassName?: string;
    style?: React.CSSProperties;
    value?: valueType;
    /** @deprecated Please use `styles.content` instead */
    valueStyle?: React.CSSProperties;
    valueRender?: (node: React.ReactNode) => React.ReactNode;
    title?: React.ReactNode;
    prefix?: React.ReactNode;
    suffix?: React.ReactNode;
    loading?: boolean;
    onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
    onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
}
export type StatisticProps = HTMLAriaDataAttributes & StatisticReactProps;
declare const Statistic: React.ForwardRefExoticComponent<React.AriaAttributes & {
    [key: `data-${string}`]: unknown;
} & Pick<React.HTMLAttributes<HTMLDivElement>, "role"> & StatisticReactProps & React.RefAttributes<StatisticRef>>;
export default Statistic;
