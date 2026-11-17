import type { ComponentType } from 'react';
import type { DesignSystem } from './design';
import type { SlideTransition } from './transition';
export type Page = ComponentType & {
    transition?: SlideTransition;
};
export type SlideMeta = {
    title?: string;
    theme?: string;
    createdAt?: string;
};
export type SlideModule = {
    default: Page[];
    meta?: SlideMeta;
    design?: DesignSystem;
    notes?: (string | undefined)[];
    transition?: SlideTransition;
};
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;
