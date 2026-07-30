import * as React from 'react';
import type { PaginationLocale, PaginationProps as RcPaginationProps } from '@rc-component/pagination';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { SizeType } from '../config-provider/SizeContext';
import type { SelectProps } from '../select';
export type PaginationSemanticType = {
    classNames?: {
        root?: string;
        item?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        item?: React.CSSProperties;
    };
};
export type PaginationSemanticAllType = GenerateSemantic<PaginationSemanticType, PaginationProps>;
export interface PaginationProps extends Omit<RcPaginationProps, 'showSizeChanger' | 'pageSizeOptions' | 'classNames' | 'styles'> {
    showQuickJumper?: boolean | {
        goButton?: React.ReactNode;
    };
    size?: SizeType;
    responsive?: boolean;
    role?: string;
    totalBoundaryShowSizeChanger?: number;
    rootClassName?: string;
    showSizeChanger?: boolean | SelectProps;
    /** @deprecated Not official support. Will be removed in next major version. */
    selectComponentClass?: any;
    /** `string` type will be removed in next major version. */
    pageSizeOptions?: (string | number)[];
    classNames?: PaginationSemanticAllType['classNamesAndFn'];
    styles?: PaginationSemanticAllType['stylesAndFn'];
}
export type PaginationPosition = 'top' | 'bottom' | 'both';
export interface PaginationConfig extends Omit<PaginationProps, 'rootClassName'> {
    position?: PaginationPosition;
}
export type { PaginationLocale };
declare const Pagination: React.FC<PaginationProps>;
export default Pagination;
