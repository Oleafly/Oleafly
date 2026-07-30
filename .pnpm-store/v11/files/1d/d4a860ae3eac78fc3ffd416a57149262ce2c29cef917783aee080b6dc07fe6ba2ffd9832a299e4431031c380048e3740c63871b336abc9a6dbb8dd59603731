import type { Dayjs } from 'dayjs';
import generatePicker from './generatePicker';
import type { RangePickerProps as BaseRangePickerProps, DatePickerSemanticType, PickerProps, PickerPropsWithMultiple } from './generatePicker/interface';
export type DatePickerProps<ValueType = Dayjs, IsMultiple extends boolean = boolean> = PickerPropsWithMultiple<Dayjs, PickerProps<Dayjs>, ValueType, IsMultiple>;
export type MonthPickerProps<ValueType = Dayjs | Dayjs> = Omit<DatePickerProps<ValueType>, 'picker'>;
export type WeekPickerProps<ValueType = Dayjs | Dayjs> = Omit<DatePickerProps<ValueType>, 'picker'>;
export type RangePickerProps = BaseRangePickerProps<Dayjs>;
export type { DatePickerSemanticType };
declare const DatePicker: (<ValueType = Dayjs, IsMultiple extends boolean = false>(props: PickerPropsWithMultiple<Dayjs, PickerProps<Dayjs>, ValueType, IsMultiple>) => React.ReactElement) & {
    displayName?: string;
} & {
    displayName?: string;
    WeekPicker: (<ValueType = Dayjs, IsMultiple extends boolean = false>(props: PickerPropsWithMultiple<Dayjs, Omit<PickerProps<Dayjs>, "picker">, ValueType, IsMultiple>) => React.ReactElement) & {
        displayName?: string;
    };
    MonthPicker: (<ValueType = Dayjs, IsMultiple extends boolean = false>(props: PickerPropsWithMultiple<Dayjs, Omit<PickerProps<Dayjs>, "picker">, ValueType, IsMultiple>) => React.ReactElement) & {
        displayName?: string;
    };
    YearPicker: (<ValueType = Dayjs, IsMultiple extends boolean = false>(props: PickerPropsWithMultiple<Dayjs, Omit<PickerProps<Dayjs>, "picker">, ValueType, IsMultiple>) => React.ReactElement) & {
        displayName?: string;
    };
    RangePicker: import("react").ForwardRefExoticComponent<Omit<import("@rc-component/picker").RangePickerProps<Dayjs>, "classNames" | "styles" | "locale" | "generateConfig" | "hideHeader"> & {
        locale?: import("./generatePicker").PickerLocale;
        size?: import("../button").ButtonSize;
        placement?: "bottomLeft" | "bottomRight" | "topLeft" | "topRight";
        bordered?: boolean;
        status?: import("../_util/statusUtils").InputStatus;
        variant?: import("../config-provider").Variant;
        dropdownClassName?: string;
        popupClassName?: string;
        rootClassName?: string;
        popupStyle?: React.CSSProperties;
        classNames?: import("../_util/hooks/useMergeSemantic/semanticType").DeepClassNameType<{
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
            props: import("./generatePicker/interface").InjectDefaultProps<import("@rc-component/picker").RangePickerProps<Dayjs>>;
        }) => import("../_util/hooks/useMergeSemantic/semanticType").DeepClassNameType<{
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
        styles?: import("../_util/hooks/useMergeSemantic/semanticType").DeepStylesType<{
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
            props: import("./generatePicker/interface").InjectDefaultProps<import("@rc-component/picker").RangePickerProps<Dayjs>>;
        }) => import("../_util/hooks/useMergeSemantic/semanticType").DeepStylesType<{
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
    } & import("react").RefAttributes<import("@rc-component/picker").PickerRef>>;
    TimePicker: (<ValueType = Dayjs, IsMultiple extends boolean = false>(props: PickerPropsWithMultiple<Dayjs, Omit<import("./generatePicker/interface").GenericTimePickerProps<Dayjs>, "picker">, ValueType, IsMultiple>) => React.ReactElement) & {
        displayName?: string;
    };
    QuarterPicker: (<ValueType = Dayjs, IsMultiple extends boolean = false>(props: PickerPropsWithMultiple<Dayjs, Omit<PickerProps<Dayjs>, "picker">, ValueType, IsMultiple>) => React.ReactElement) & {
        displayName?: string;
    };
};
export type DatePickerType = typeof DatePicker & {
    _InternalPanelDoNotUseOrYouWillBeFired: typeof PurePanel;
    _InternalRangePanelDoNotUseOrYouWillBeFired: typeof PureRangePanel;
    generatePicker: typeof generatePicker;
};
declare const PurePanel: (props: import("../_util/type").AnyObject) => import("react").JSX.Element;
declare const PureRangePanel: (props: import("../_util/type").AnyObject) => import("react").JSX.Element;
declare const _default: DatePickerType;
export default _default;
