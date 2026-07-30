import * as React from 'react';
import type { CascaderProps as RcCascaderProps } from '@rc-component/cascader';
import { Panel } from '@rc-component/cascader';
import type { CascaderProps, DefaultOptionType } from '.';
type RcPanelProps = React.ComponentProps<typeof Panel>;
type RcPanelPickType = Extract<keyof RcPanelProps, keyof RcCascaderProps>;
export type PanelPickType = Exclude<RcPanelPickType, 'checkable'> | 'multiple' | 'rootClassName';
export type CascaderPanelProps<OptionType extends DefaultOptionType = DefaultOptionType, ValueField extends keyof OptionType = keyof OptionType, Multiple extends boolean = boolean> = Pick<CascaderProps<OptionType, ValueField, Multiple>, PanelPickType>;
export type CascaderPanelAutoProps<OptionType extends DefaultOptionType = DefaultOptionType, ValueField extends keyof OptionType = keyof OptionType> = (CascaderPanelProps<OptionType, ValueField> & {
    multiple?: false;
}) | (CascaderPanelProps<OptionType, ValueField, true> & {
    multiple: true;
});
declare function CascaderPanel<OptionType extends DefaultOptionType = DefaultOptionType, ValueField extends keyof OptionType = keyof OptionType>(props: CascaderPanelAutoProps<OptionType, ValueField>): React.JSX.Element;
export default CascaderPanel;
