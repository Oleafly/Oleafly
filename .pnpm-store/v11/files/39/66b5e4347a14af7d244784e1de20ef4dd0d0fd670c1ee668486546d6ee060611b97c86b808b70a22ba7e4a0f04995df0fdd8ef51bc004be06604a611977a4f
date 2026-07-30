import React from 'react';
import type { CellSemanticType } from './DescriptionsContext';
export interface CellProps {
    itemPrefixCls: string;
    span: number;
    className?: string;
    component: string;
    style?: React.CSSProperties;
    /** @deprecated Please use `styles.label` instead */
    labelStyle?: React.CSSProperties;
    /** @deprecated Please use `styles.content` instead */
    contentStyle?: React.CSSProperties;
    classNames?: CellSemanticType['classNames'];
    styles?: CellSemanticType['styles'];
    bordered?: boolean;
    label?: React.ReactNode;
    content?: React.ReactNode;
    colon?: boolean;
    type?: 'label' | 'content' | 'item';
}
declare const Cell: React.FC<CellProps>;
export default Cell;
