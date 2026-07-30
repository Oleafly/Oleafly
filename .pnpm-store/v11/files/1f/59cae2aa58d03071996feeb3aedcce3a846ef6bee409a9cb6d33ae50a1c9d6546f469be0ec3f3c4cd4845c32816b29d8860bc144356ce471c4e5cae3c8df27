import * as React from 'react';
import type { BlockProps, EllipsisConfig } from './Base';
export interface TextProps extends BlockProps<'span'>, Omit<React.HTMLAttributes<HTMLSpanElement>, 'type' | keyof BlockProps<'span'>> {
    ellipsis?: boolean | Omit<EllipsisConfig, 'expandable' | 'rows' | 'onExpand'>;
}
declare const Text: React.ForwardRefExoticComponent<TextProps & React.RefAttributes<HTMLSpanElement>>;
export default Text;
