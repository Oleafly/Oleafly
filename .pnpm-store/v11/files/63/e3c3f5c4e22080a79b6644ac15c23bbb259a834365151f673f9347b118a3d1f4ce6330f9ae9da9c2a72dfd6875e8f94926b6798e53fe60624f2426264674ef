import { pickAttrs } from '@rc-component/util';
import * as React from 'react';
export type ClosableConfig = {
    closeIcon?: React.ReactNode;
    disabled?: boolean;
    onClose?: VoidFunction;
} & React.AriaAttributes;
export type ClosableType = boolean | ClosableConfig | null | undefined;
export type ParsedClosableConfig = ClosableConfig & Required<Pick<ClosableConfig, 'closeIcon' | 'disabled'>>;
/**
 * Normalizes the closable option into a boolean flag, config, and aria props.
 */
export default function useClosable(closable?: ClosableType): [boolean, ParsedClosableConfig, ReturnType<typeof pickAttrs>];
