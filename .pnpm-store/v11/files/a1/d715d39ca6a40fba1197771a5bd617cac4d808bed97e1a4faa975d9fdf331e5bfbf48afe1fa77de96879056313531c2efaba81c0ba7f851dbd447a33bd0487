import * as React from 'react';
import type { GenerateConfig } from '@rc-component/picker/generate';
import type { CellRenderInfo } from '@rc-component/picker/interface';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { AnyObject } from '../_util/type';
import enUS from './locale/en_US';
export type CalendarMode = 'year' | 'month';
export type HeaderRender<DateType> = (config: {
    value: DateType;
    type: CalendarMode;
    onChange: (date: DateType) => void;
    onTypeChange: (type: CalendarMode) => void;
}) => React.ReactNode;
export interface SelectInfo {
    source: 'year' | 'month' | 'date' | 'customize';
}
export type CalendarSemanticType = {
    classNames?: {
        root?: string;
        header?: string;
        body?: string;
        content?: string;
        item?: string;
        itemContent?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        header?: React.CSSProperties;
        body?: React.CSSProperties;
        content?: React.CSSProperties;
        item?: React.CSSProperties;
        itemContent?: React.CSSProperties;
    };
};
export type CalendarSemanticAllType<T = any> = GenerateSemantic<CalendarSemanticType, CalendarProps<T>>;
export interface CalendarProps<DateType> {
    prefixCls?: string;
    className?: string;
    rootClassName?: string;
    style?: React.CSSProperties;
    classNames?: CalendarSemanticAllType<DateType>['classNamesAndFn'];
    styles?: CalendarSemanticAllType<DateType>['stylesAndFn'];
    locale?: typeof enUS;
    validRange?: [DateType, DateType];
    disabledDate?: (date: DateType) => boolean;
    /** @deprecated Please use fullCellRender instead. */
    dateFullCellRender?: (date: DateType) => React.ReactNode;
    /** @deprecated Please use cellRender instead. */
    dateCellRender?: (date: DateType) => React.ReactNode;
    /** @deprecated Please use fullCellRender instead. */
    monthFullCellRender?: (date: DateType) => React.ReactNode;
    /** @deprecated Please use cellRender instead. */
    monthCellRender?: (date: DateType) => React.ReactNode;
    cellRender?: (date: DateType, info: CellRenderInfo<DateType>) => React.ReactNode;
    fullCellRender?: (date: DateType, info: CellRenderInfo<DateType>) => React.ReactNode;
    headerRender?: HeaderRender<DateType>;
    value?: DateType;
    defaultValue?: DateType;
    mode?: CalendarMode;
    fullscreen?: boolean;
    showWeek?: boolean;
    onChange?: (date: DateType) => void;
    onPanelChange?: (date: DateType, mode: CalendarMode) => void;
    onSelect?: (date: DateType, selectInfo: SelectInfo) => void;
}
declare const generateCalendar: <DateType extends AnyObject>(generateConfig: GenerateConfig<DateType>) => React.FC<Readonly<CalendarProps<DateType>>>;
export default generateCalendar;
