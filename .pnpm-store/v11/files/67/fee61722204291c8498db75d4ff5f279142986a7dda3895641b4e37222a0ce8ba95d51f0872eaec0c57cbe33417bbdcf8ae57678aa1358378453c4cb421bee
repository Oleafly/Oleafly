import * as React from 'react';
import type { PickerRef } from '@rc-component/picker';
import type { GenerateConfig } from '@rc-component/picker/generate/index';
import type { AnyObject } from '../../_util/type';
import type { PickerLocale } from './interface';
declare const generateRangePicker: <DateType extends AnyObject = AnyObject>(generateConfig: GenerateConfig<DateType>) => React.ForwardRefExoticComponent<Omit<import("@rc-component/picker").RangePickerProps<DateType>, "classNames" | "styles" | "locale" | "generateConfig" | "hideHeader"> & {
    locale?: PickerLocale;
    size?: import("../../button").ButtonSize;
    placement?: "bottomLeft" | "bottomRight" | "topLeft" | "topRight";
    bordered?: boolean;
    status?: import("../../_util/statusUtils").InputStatus;
    variant?: import("../../config-provider").Variant;
    dropdownClassName?: string;
    popupClassName?: string;
    rootClassName?: string;
    popupStyle?: React.CSSProperties;
    classNames?: import("../../_util/hooks/useMergeSemantic/semanticType").DeepClassNameType<{
        root?: string;
        prefix?: string;
        input?: string;
        suffix?: string;
        popup?: string | {
            root?: string;
            header?: string;
            body?: string;
            content?: string;
            item?: string;
            footer?: string;
            container?: string;
        };
    } | undefined> | ((info: {
        props: import("./interface").InjectDefaultProps<import("@rc-component/picker").RangePickerProps<DateType>>;
    }) => import("../../_util/hooks/useMergeSemantic/semanticType").DeepClassNameType<{
        root?: string;
        prefix?: string;
        input?: string;
        suffix?: string;
        popup?: string | {
            root?: string;
            header?: string;
            body?: string;
            content?: string;
            item?: string;
            footer?: string;
            container?: string;
        };
    } | undefined>);
    styles?: import("../../_util/hooks/useMergeSemantic/semanticType").DeepStylesType<{
        root?: React.CSSProperties;
        prefix?: React.CSSProperties;
        input?: React.CSSProperties;
        suffix?: React.CSSProperties;
        popup?: {
            root?: React.CSSProperties;
            header?: React.CSSProperties;
            body?: React.CSSProperties;
            content?: React.CSSProperties;
            item?: React.CSSProperties;
            footer?: React.CSSProperties;
            container?: React.CSSProperties;
        };
    } | undefined> | ((info: {
        props: import("./interface").InjectDefaultProps<import("@rc-component/picker").RangePickerProps<DateType>>;
    }) => import("../../_util/hooks/useMergeSemantic/semanticType").DeepStylesType<{
        root?: React.CSSProperties;
        prefix?: React.CSSProperties;
        input?: React.CSSProperties;
        suffix?: React.CSSProperties;
        popup?: {
            root?: React.CSSProperties;
            header?: React.CSSProperties;
            body?: React.CSSProperties;
            content?: React.CSSProperties;
            item?: React.CSSProperties;
            footer?: React.CSSProperties;
            container?: React.CSSProperties;
        };
    } | undefined>);
} & React.RefAttributes<PickerRef>>;
export default generateRangePicker;
