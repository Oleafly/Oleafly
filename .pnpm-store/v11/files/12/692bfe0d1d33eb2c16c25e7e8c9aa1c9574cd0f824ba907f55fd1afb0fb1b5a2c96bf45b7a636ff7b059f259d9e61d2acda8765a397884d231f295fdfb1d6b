import * as React from 'react';
import RcMentions from '@rc-component/mentions';
import type { MentionsProps as RcMentionsProps } from '@rc-component/mentions';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { InputStatus } from '../_util/statusUtils';
import type { Variant } from '../config-provider';
import type { SizeType } from '../config-provider/SizeContext';
export declare const Option: React.FC<import("@rc-component/mentions/lib/Option").OptionProps>;
export type MentionPlacement = 'top' | 'bottom';
export type MentionsOptionProps = NonNullable<RcMentionsProps['options']>[number];
type RcMentionsRef = React.ComponentRef<typeof RcMentions>;
export interface OptionProps {
    value: string;
    children: React.ReactNode;
    [key: string]: any;
}
export type MentionSemanticType = {
    classNames?: {
        root?: string;
        textarea?: string;
        popup?: string;
        suffix?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        textarea?: React.CSSProperties;
        popup?: React.CSSProperties;
        suffix?: React.CSSProperties;
    };
};
export type MentionSemanticAllType = GenerateSemantic<MentionSemanticType, MentionProps>;
export interface MentionProps extends Omit<RcMentionsProps, 'suffix' | 'classNames' | 'styles'> {
    rootClassName?: string;
    loading?: boolean;
    status?: InputStatus;
    options?: MentionsOptionProps[];
    popupClassName?: string;
    /**
     * @since 5.13.0
     * @default "outlined"
     */
    variant?: Variant;
    classNames?: MentionSemanticAllType['classNamesAndFn'];
    styles?: MentionSemanticAllType['stylesAndFn'];
    size?: SizeType;
}
export interface MentionsProps extends MentionProps {
}
export interface MentionsRef extends RcMentionsRef {
}
interface MentionsConfig {
    prefix?: string | string[];
    split?: string;
}
interface MentionsEntity {
    prefix: string;
    value: string;
}
declare const InternalMentions: React.ForwardRefExoticComponent<MentionProps & React.RefAttributes<MentionsRef>>;
type CompoundedComponent = typeof InternalMentions & {
    Option: typeof Option;
    _InternalPanelDoNotUseOrYouWillBeFired: typeof PurePanel;
    getMentions: (value: string, config?: MentionsConfig) => MentionsEntity[];
};
declare const Mentions: CompoundedComponent;
declare const PurePanel: (props: import("../_util/type").AnyObject) => React.JSX.Element;
export default Mentions;
