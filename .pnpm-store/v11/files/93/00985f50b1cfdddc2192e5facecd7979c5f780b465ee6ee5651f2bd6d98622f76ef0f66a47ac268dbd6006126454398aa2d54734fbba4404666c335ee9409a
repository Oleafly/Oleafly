import * as React from 'react';
import type { TableProps as RcTableProps } from '@rc-component/table';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { AnyObject } from '../_util/type';
import type { SizeType } from '../config-provider/SizeContext';
import type { PaginationSemanticType } from '../pagination/Pagination';
import type { SpinProps } from '../spin';
import type { ColumnsType, ColumnType, FilterValue, GetPopupContainer, RefInternalTable, SorterResult, SorterTooltipProps, SortOrder, TableCurrentDataSource, TableLocale, TablePaginationConfig, TableRowSelection } from './interface';
export type { ColumnsType, TablePaginationConfig };
type ComponentsSemanticClassNames = {
    wrapper?: string;
    cell?: string;
    row?: string;
};
type ComponentsSemanticStyles = {
    wrapper?: React.CSSProperties;
    cell?: React.CSSProperties;
    row?: React.CSSProperties;
};
export type TableSemanticType = {
    classNames?: {
        root?: string;
        section?: string;
        title?: string;
        footer?: string;
        body?: ComponentsSemanticClassNames;
        content?: string;
        header?: ComponentsSemanticClassNames;
        pagination?: PaginationSemanticType['classNames'];
    };
    styles?: {
        root?: React.CSSProperties;
        section?: React.CSSProperties;
        title?: React.CSSProperties;
        footer?: React.CSSProperties;
        body?: ComponentsSemanticStyles;
        content?: React.CSSProperties;
        header?: ComponentsSemanticStyles;
        pagination?: PaginationSemanticType['styles'];
    };
};
export type TableSemanticAllType<T = any> = GenerateSemantic<TableSemanticType, TableProps<T>>;
export interface TableProps<RecordType = AnyObject> extends Omit<RcTableProps<RecordType>, 'transformColumns' | 'internalHooks' | 'internalRefs' | 'data' | 'columns' | 'scroll' | 'emptyText' | 'classNames' | 'styles'> {
    classNames?: TableSemanticAllType<RecordType>['classNamesAndFn'];
    styles?: TableSemanticAllType<RecordType>['stylesAndFn'];
    dropdownPrefixCls?: string;
    dataSource?: RcTableProps<RecordType>['data'];
    column?: Partial<ColumnType<RecordType>>;
    columns?: ColumnsType<RecordType>;
    pagination?: false | TablePaginationConfig;
    loading?: boolean | SpinProps;
    size?: SizeType;
    bordered?: boolean;
    locale?: TableLocale;
    rootClassName?: string;
    onChange?: (pagination: TablePaginationConfig, filters: Record<string, FilterValue | null>, sorter: SorterResult<RecordType> | SorterResult<RecordType>[], extra: TableCurrentDataSource<RecordType>) => void;
    rowSelection?: TableRowSelection<RecordType>;
    getPopupContainer?: GetPopupContainer;
    scroll?: RcTableProps<RecordType>['scroll'] & {
        scrollToFirstRowOnChange?: boolean;
    };
    sortDirections?: SortOrder[];
    showSorterTooltip?: boolean | SorterTooltipProps;
    virtual?: boolean;
}
/** Same as `TableProps` but we need record parent render times */
export interface InternalTableProps<RecordType = AnyObject> extends TableProps<RecordType> {
    _renderTimes: number;
}
declare const _default_1: RefInternalTable;
export default _default_1;
