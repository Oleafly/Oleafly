import * as React from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { AffixProps } from '../affix';
import type { AnchorLinkBaseProps } from './AnchorLink';
export interface AnchorLinkItemProps extends AnchorLinkBaseProps {
    key: React.Key;
    children?: AnchorLinkItemProps[];
}
export type AnchorContainer = HTMLElement | Window;
export type AnchorSemanticType = {
    classNames?: {
        root?: string;
        item?: string;
        itemTitle?: string;
        indicator?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        item?: React.CSSProperties;
        itemTitle?: React.CSSProperties;
        indicator?: React.CSSProperties;
    };
};
export type AnchorSemanticAllType = GenerateSemantic<AnchorSemanticType, AnchorProps>;
export interface AnchorProps {
    prefixCls?: string;
    className?: string;
    rootClassName?: string;
    style?: React.CSSProperties;
    classNames?: AnchorSemanticAllType['classNamesAndFn'];
    styles?: AnchorSemanticAllType['stylesAndFn'];
    /**
     * @deprecated Please use `items` instead.
     */
    children?: React.ReactNode;
    offsetTop?: number;
    bounds?: number;
    affix?: boolean | Omit<AffixProps, 'offsetTop' | 'target' | 'children'>;
    showInkInFixed?: boolean;
    getContainer?: () => AnchorContainer;
    /** Return customize highlight anchor */
    getCurrentAnchor?: (activeLink: string) => string;
    onClick?: (e: React.MouseEvent<HTMLElement>, link: {
        title: React.ReactNode;
        href: string;
    }) => void;
    /** Scroll to target offset value, if none, it's offsetTop prop value or 0. */
    targetOffset?: number;
    /** Listening event when scrolling change active link */
    onChange?: (currentActiveLink: string) => void;
    items?: AnchorLinkItemProps[];
    direction?: AnchorDirection;
    replace?: boolean;
}
export interface AnchorState {
    activeLink: null | string;
}
export interface AnchorDefaultProps extends AnchorProps {
    prefixCls: string;
    affix: boolean;
    showInkInFixed: boolean;
    getContainer: () => AnchorContainer;
}
export type AnchorDirection = 'vertical' | 'horizontal';
export interface AntAnchor {
    registerLink: (link: string, targetOffset?: number) => void;
    unregisterLink: (link: string) => void;
    activeLink: string | null;
    scrollTo: (link: string, targetOffset?: number) => void;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement, MouseEvent>, link: {
        title: React.ReactNode;
        href: string;
    }) => void;
    direction: AnchorDirection;
    classNames?: AnchorSemanticAllType['classNames'];
    styles?: AnchorSemanticAllType['styles'];
}
declare const Anchor: React.FC<AnchorProps>;
export default Anchor;
