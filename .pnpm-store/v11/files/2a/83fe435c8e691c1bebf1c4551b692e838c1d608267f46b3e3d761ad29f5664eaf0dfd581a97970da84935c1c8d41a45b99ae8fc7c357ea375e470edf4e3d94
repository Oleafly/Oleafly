import { DivProps } from '@lobehub/ui';
import { FC } from 'react';
import type { IconType } from "../types";
import type { IconAvatarProps } from './IconAvatar';
import type { IconCombineProps } from './IconCombine';
type ProviderIconType = FC<IconType & any> & {
    Avatar: FC<Omit<IconAvatarProps, 'Icon'> & any>;
    Brand?: FC<IconType & any>;
    BrandColor?: FC<IconType & any>;
    Color?: FC<IconType & any>;
    Combine?: FC<Omit<IconCombineProps, 'Icon' | 'Text'> & any>;
    Text?: FC<IconType & any>;
};
export interface ProviderMapping {
    Combine?: FC<DivProps & {
        size: number;
        type: 'color' | 'mono';
    }>;
    Icon: ProviderIconType;
    combineMultiple?: number;
    keywords: string[];
    props?: any;
}
export declare const providerMappings: ProviderMapping[];
export {};
