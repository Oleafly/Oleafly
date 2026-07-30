import type { BaseSelectProps, useBaseProps } from '@rc-component/select';
import * as React from 'react';
export type RefOptionListProps = NonNullable<React.ComponentProps<BaseSelectProps['OptionList']>['ref']> extends React.Ref<infer Ref> ? Ref : never;
export type RawOptionListProps = Pick<ReturnType<typeof useBaseProps>, 'prefixCls' | 'multiple' | 'searchValue' | 'toggleOpen' | 'notFoundContent' | 'direction' | 'open' | 'disabled'> & {
    lockOptions?: boolean;
};
declare const RawOptionList: React.ForwardRefExoticComponent<Pick<import("@rc-component/select/lib/hooks/useBaseProps").BaseSelectContextProps, "prefixCls" | "searchValue" | "direction" | "notFoundContent" | "disabled" | "open" | "multiple" | "toggleOpen"> & {
    lockOptions?: boolean | undefined;
} & React.RefAttributes<import("@rc-component/select/lib/BaseSelect").RefOptionListProps>>;
export default RawOptionList;
