import * as React from 'react';
import type { TextAreaProps } from '@rc-component/input';
import type { GetProp } from '../_util/type';
import type { DirectionType } from '../config-provider';
import type { TypographyProps } from './Typography';
interface EditableProps {
    prefixCls: string;
    value: string;
    'aria-label'?: string;
    onSave: (value: string) => void;
    onCancel: () => void;
    onEnd?: () => void;
    className?: string;
    style?: React.CSSProperties;
    direction?: DirectionType;
    maxLength?: number;
    autoSize?: TextAreaProps['autoSize'];
    enterIcon?: React.ReactNode;
    component?: string;
    classNames: NonNullable<GetProp<TypographyProps, 'classNames', 'Return'>>;
    styles: NonNullable<GetProp<TypographyProps, 'styles', 'Return'>>;
}
declare const Editable: React.FC<EditableProps>;
export default Editable;
