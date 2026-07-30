import type { CSSProperties } from 'react';
import React from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { InputStatus } from '../_util/statusUtils';
import type { PaginationType, TransferKey } from './interface';
import type { TransferCustomListBodyProps, TransferListProps } from './Section';
export type { TransferOperationProps } from './Actions';
export type { TransferSearchProps } from './search';
export type { TransferListProps } from './Section';
export type TransferSemanticType = {
    classNames?: {
        root?: string;
        section?: string;
        header?: string;
        title?: string;
        body?: string;
        list?: string;
        item?: string;
        itemIcon?: string;
        itemContent?: string;
        footer?: string;
        actions?: string;
        source?: TransferSectionSemanticClassNames;
        target?: TransferSectionSemanticClassNames;
    };
    styles?: {
        root?: React.CSSProperties;
        section?: React.CSSProperties;
        header?: React.CSSProperties;
        title?: React.CSSProperties;
        body?: React.CSSProperties;
        list?: React.CSSProperties;
        item?: React.CSSProperties;
        itemIcon?: React.CSSProperties;
        itemContent?: React.CSSProperties;
        footer?: React.CSSProperties;
        actions?: React.CSSProperties;
        source?: TransferSectionSemanticStyles;
        target?: TransferSectionSemanticStyles;
    };
};
type TransferSectionSemanticClassNames = {
    section?: string;
    header?: string;
    title?: string;
    body?: string;
    list?: string;
    item?: string;
    itemIcon?: string;
    itemContent?: string;
    footer?: string;
};
type TransferSectionSemanticStyles = {
    section?: React.CSSProperties;
    header?: React.CSSProperties;
    title?: React.CSSProperties;
    body?: React.CSSProperties;
    list?: React.CSSProperties;
    item?: React.CSSProperties;
    itemIcon?: React.CSSProperties;
    itemContent?: React.CSSProperties;
    footer?: React.CSSProperties;
};
export type TransferSemanticAllType = GenerateSemantic<TransferSemanticType, TransferProps>;
export type TransferDirection = 'left' | 'right';
export interface RenderResultObject {
    label: React.ReactElement;
    value: string;
}
export type RenderResult = React.ReactElement | RenderResultObject | string | null;
export interface TransferItem {
    key?: TransferKey;
    title?: string;
    description?: string;
    disabled?: boolean;
    [name: string]: any;
}
export type KeyWise<T> = T & {
    key: TransferKey;
};
export type KeyWiseTransferItem = KeyWise<TransferItem>;
type TransferRender<RecordType> = (item: RecordType) => RenderResult;
export interface ListStyle {
    direction: TransferDirection;
}
export type SelectAllLabel = React.ReactNode | ((info: {
    selectedCount: number;
    totalCount: number;
}) => React.ReactNode);
export interface TransferLocale {
    titles?: React.ReactNode[];
    notFoundContent?: React.ReactNode | React.ReactNode[];
    searchPlaceholder: string;
    itemUnit: string;
    itemsUnit: string;
    remove?: string;
    selectAll?: string;
    deselectAll?: string;
    selectCurrent?: string;
    selectInvert?: string;
    removeAll?: string;
    removeCurrent?: string;
}
export interface TransferSearchOption {
    placeholder?: string;
    defaultValue?: string;
}
export interface TransferProps<RecordType = any> extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onScroll' | 'children'> {
    prefixCls?: string;
    className?: string;
    rootClassName?: string;
    style?: React.CSSProperties;
    /** @deprecated Please use `styles.section` instead. */
    listStyle?: ((style: ListStyle) => CSSProperties) | CSSProperties;
    /** @deprecated Please use `styles.actions` instead. */
    operationStyle?: CSSProperties;
    classNames?: TransferSemanticAllType['classNamesAndFn'];
    styles?: TransferSemanticAllType['stylesAndFn'];
    disabled?: boolean;
    dataSource?: RecordType[];
    targetKeys?: TransferKey[];
    selectedKeys?: TransferKey[];
    render?: TransferRender<RecordType>;
    onChange?: (targetKeys: TransferKey[], direction: TransferDirection, moveKeys: TransferKey[]) => void;
    onSelectChange?: (sourceSelectedKeys: TransferKey[], targetSelectedKeys: TransferKey[]) => void;
    titles?: React.ReactNode[];
    /** @deprecated Please use `actions` instead. */
    operations?: string[];
    actions?: React.ReactNode[];
    showSearch?: boolean | TransferSearchOption;
    filterOption?: (inputValue: string, item: RecordType, direction: TransferDirection) => boolean;
    locale?: Partial<TransferLocale>;
    footer?: (props: TransferListProps<RecordType>, info?: {
        direction: TransferDirection;
    }) => React.ReactNode;
    rowKey?: (record: RecordType) => TransferKey;
    onSearch?: (direction: TransferDirection, value: string) => void;
    onScroll?: (direction: TransferDirection, e: React.SyntheticEvent<HTMLUListElement>) => void;
    children?: (props: TransferCustomListBodyProps<RecordType>) => React.ReactNode;
    showSelectAll?: boolean;
    selectAllLabels?: SelectAllLabel[];
    oneWay?: boolean;
    pagination?: PaginationType;
    status?: InputStatus;
    selectionsIcon?: React.ReactNode;
}
declare const Transfer: {
    <RecordType extends TransferItem = TransferItem>(props: TransferProps<RecordType>): React.JSX.Element;
    displayName: string;
    List: {
        <RecordType extends KeyWiseTransferItem>(props: TransferListProps<RecordType>): React.JSX.Element;
        displayName: string;
    };
    Search: React.FC<import("./search").TransferSearchProps>;
    Operation: React.FC<import("./Actions").TransferOperationProps>;
};
export default Transfer;
