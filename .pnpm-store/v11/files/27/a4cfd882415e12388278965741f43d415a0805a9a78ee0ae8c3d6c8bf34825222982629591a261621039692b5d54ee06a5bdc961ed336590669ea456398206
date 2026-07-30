import { FC } from 'react';
import type { IconAvatarProps } from "./IconAvatar";
import type { IconCombineProps } from "./IconCombine";
import type { IconType } from "../types";
type AgentIconType = FC<IconType & any> & {
    Avatar: FC<Omit<IconAvatarProps, 'Icon'> & any>;
    Brand?: FC<IconType & any>;
    BrandColor?: FC<IconType & any>;
    Color?: FC<IconType & any>;
    Combine?: FC<Omit<IconCombineProps, 'Icon' | 'Text'> & any>;
    Text?: FC<IconType & any>;
};
export interface AgentMapping {
    Icon: AgentIconType;
    keywords: string[];
    props?: any;
}
export declare const agentMappings: AgentMapping[];
export {};
