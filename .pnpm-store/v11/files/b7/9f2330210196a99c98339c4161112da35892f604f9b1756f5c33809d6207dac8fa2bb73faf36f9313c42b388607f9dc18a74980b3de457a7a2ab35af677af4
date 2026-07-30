import React from 'react';
import type { ReactNode } from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
export type CheckableTagOption<CheckableTagValue> = {
    value: CheckableTagValue;
    label: ReactNode;
    className?: string;
    style?: React.CSSProperties;
};
interface CheckableTagGroupSingleProps<CheckableTagValue> {
    multiple?: false;
    value?: CheckableTagValue | null;
    defaultValue?: CheckableTagValue | null;
    onChange?: (value: CheckableTagValue | null) => void;
}
interface CheckableTagGroupMultipleProps<CheckableTagValue> {
    multiple: true;
    value?: CheckableTagValue[];
    defaultValue?: CheckableTagValue[];
    onChange?: (value: CheckableTagValue[]) => void;
}
export type CheckableTagGroupSemanticType = {
    classNames?: {
        root?: string;
        item?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        item?: React.CSSProperties;
    };
};
export type CheckableTagGroupSemanticAllType = GenerateSemantic<CheckableTagGroupSemanticType, CheckableTagGroupBaseProps<any>>;
type CheckableTagGroupBaseProps<CheckableTagValue> = {
    prefixCls?: string;
    rootClassName?: string;
    options?: (CheckableTagOption<CheckableTagValue> | CheckableTagValue)[];
    disabled?: boolean;
} & (CheckableTagGroupSingleProps<CheckableTagValue> | CheckableTagGroupMultipleProps<CheckableTagValue>) & Pick<React.HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'id' | 'role'> & {
    [key: `data-${string}`]: any;
    [key: `aria-${string}`]: any;
};
export type CheckableTagGroupProps<CheckableTagValue = any> = CheckableTagGroupBaseProps<CheckableTagValue> & {
    classNames?: CheckableTagGroupSemanticAllType['classNamesAndFn'];
    styles?: CheckableTagGroupSemanticAllType['stylesAndFn'];
};
export interface CheckableTagGroupRef {
    nativeElement: HTMLDivElement;
}
declare const CheckableTagGroup: (<CheckableTagValue extends string | number>(props: CheckableTagGroupProps<CheckableTagValue> & {
    ref?: React.Ref<CheckableTagGroupRef>;
}) => React.ReactElement<any>) & {
    displayName?: string;
};
export default CheckableTagGroup;
