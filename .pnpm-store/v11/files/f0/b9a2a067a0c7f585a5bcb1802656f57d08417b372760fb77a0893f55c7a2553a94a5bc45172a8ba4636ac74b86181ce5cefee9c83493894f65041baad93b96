import type { AnyObject } from '../../_util/type';
import type { Locale } from '../../locale';
import type { ColumnsType, ColumnTitleProps, ColumnType, Key, SorterResult, SorterTooltipProps, SortOrder, TableLocale, TransformColumns } from '../interface';
export interface SortState<RecordType = AnyObject> {
    column: ColumnType<RecordType>;
    key: Key;
    sortOrder: SortOrder | null;
    multiplePriority: number | false;
}
export declare const getSortData: <RecordType extends AnyObject = AnyObject>(data: readonly RecordType[], sortStates: SortState<RecordType>[], childrenColumnName: string) => RecordType[];
interface SorterConfig<RecordType = AnyObject> {
    prefixCls: string;
    mergedColumns: ColumnsType<RecordType>;
    /**
     * Columns before applying the responsive filter.
     * Used to collect `defaultSortOrder` / controlled `sortOrder` for columns
     * that are currently hidden by `column.responsive`, so the user's sort
     * intent is preserved when the column appears at a different breakpoint.
     * Falls back to `mergedColumns` when not provided.
     */
    baseColumns?: ColumnsType<RecordType>;
    onSorterChange: (sorterResult: SorterResult<RecordType> | SorterResult<RecordType>[], sortStates: SortState<RecordType>[]) => void;
    sortDirections: SortOrder[];
    tableLocale?: TableLocale;
    showSorterTooltip?: boolean | SorterTooltipProps;
    globalLocale?: Locale['global'];
}
declare const useFilterSorter: <RecordType extends AnyObject = AnyObject>(props: SorterConfig<RecordType>) => [TransformColumns<RecordType>, SortState<RecordType>[], ColumnTitleProps<RecordType>, () => SorterResult<RecordType> | SorterResult<RecordType>[]];
export default useFilterSorter;
