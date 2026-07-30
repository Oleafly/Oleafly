import { FC } from 'react';
import type { IconAvatarProps } from "./IconAvatar";
import type { IconCombineProps } from "./IconCombine";
import type { IconType } from "../types";
type ModelIconType = FC<IconType & any> & {
    Avatar: FC<Omit<IconAvatarProps, 'Icon'> & any>;
    Brand?: FC<IconType & any>;
    BrandColor?: FC<IconType & any>;
    Color?: FC<IconType & any>;
    Combine?: FC<Omit<IconCombineProps, 'Icon' | 'Text'> & any>;
    Text?: FC<IconType & any>;
};
export interface ModelMapping {
    Icon: ModelIconType;
    keywords: string[];
    props?: any;
}
export declare const modelMappings: ModelMapping[];
export {};
