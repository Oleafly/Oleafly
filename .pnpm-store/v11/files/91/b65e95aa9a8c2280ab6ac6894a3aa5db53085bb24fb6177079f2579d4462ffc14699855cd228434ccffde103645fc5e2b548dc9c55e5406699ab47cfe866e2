import * as React from 'react';
import type { JSX } from 'react';
import type { DirectionType } from '../config-provider';
import type { BaseTypographyProps, TypographySemanticType } from './Base';
export interface TypographyProps<C extends keyof JSX.IntrinsicElements = any> extends BaseTypographyProps {
}
interface InternalProps extends React.HTMLAttributes<HTMLElement> {
    className?: string;
    rootClassName?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
    component?: keyof JSX.IntrinsicElements;
    direction?: DirectionType;
    classNames?: TypographySemanticType['classNames'];
    styles?: TypographySemanticType['styles'];
    prefixCls: string;
}
declare const InternalTypography: React.ForwardRefExoticComponent<InternalProps & React.RefAttributes<HTMLElement>>;
declare const Typography: React.ForwardRefExoticComponent<TypographyProps<keyof JSX.IntrinsicElements> & React.RefAttributes<HTMLElement>>;
export default Typography;
export { InternalTypography };
