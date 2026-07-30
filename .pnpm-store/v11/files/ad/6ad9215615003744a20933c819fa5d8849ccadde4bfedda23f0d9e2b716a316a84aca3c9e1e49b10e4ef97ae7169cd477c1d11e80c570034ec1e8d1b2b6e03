import * as React from 'react';
export type ProgressClassNames = {
    root?: string;
    content?: string;
    rail?: string;
    indicator?: string;
};
export type ProgressStyles = {
    root?: React.CSSProperties;
    content?: React.CSSProperties;
    rail?: React.CSSProperties;
    indicator?: React.CSSProperties;
};
export interface ProgressProps {
    prefixCls: string;
    percent?: number;
    render?: (progress: React.ReactNode, percent: number) => React.ReactNode;
    classNames?: ProgressClassNames;
    styles?: ProgressStyles;
    rootClassName?: string;
    rootStyle?: React.CSSProperties;
    width?: React.CSSProperties['width'];
    height?: React.CSSProperties['height'];
}
declare const Progress: React.FC<ProgressProps>;
export default Progress;
