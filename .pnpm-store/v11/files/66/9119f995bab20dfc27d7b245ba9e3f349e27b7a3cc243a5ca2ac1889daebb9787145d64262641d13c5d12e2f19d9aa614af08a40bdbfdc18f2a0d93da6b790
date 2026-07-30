import type { AnyObject } from '../_util/type';
import type { SizeType } from '../config-provider/SizeContext';
import type { ColumnTitle, ColumnTitleProps, ColumnType, TablePaginationPlacement, TablePaginationPosition } from './interface';
export declare const getColumnKey: <RecordType extends AnyObject = AnyObject>(column: ColumnType<RecordType>, defaultKey: string) => string | number | bigint;
export declare function getColumnPos(index: number, pos?: string): string;
export declare const renderColumnTitle: <RecordType extends AnyObject = AnyObject>(title: ColumnTitle<RecordType>, props: ColumnTitleProps<RecordType>) => import("react").ReactNode;
/**
 * @description Safe get column title, Should filter object
 * @param title
 */
export declare const safeColumnTitle: <RecordType extends AnyObject = AnyObject>(title: ColumnTitle<RecordType>, props: ColumnTitleProps<RecordType>) => import("react").ReactNode;
export declare const normalizePlacement: (pos: TablePaginationPlacement | TablePaginationPosition) => "center" | "end" | "start";
export declare const getPaginationSize: (paginationSize: SizeType, mergedSize: SizeType) => SizeType;
