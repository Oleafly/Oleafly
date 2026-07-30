import { BubbleMenuPluginProps } from '@tiptap/extension-bubble-menu';
import React from 'react';
import { FloatingMenuPluginProps } from '@tiptap/extension-floating-menu';

type Optional$1<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
type BubbleMenuProps = Optional$1<Omit<Optional$1<BubbleMenuPluginProps, 'pluginKey'>, 'element'>, 'editor'> & React.HTMLAttributes<HTMLDivElement>;
declare const BubbleMenu: React.ForwardRefExoticComponent<Pick<Partial<Omit<Optional$1<BubbleMenuPluginProps, "pluginKey">, "element">>, "editor"> & Omit<Omit<Optional$1<BubbleMenuPluginProps, "pluginKey">, "element">, "editor"> & React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>>;

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
type FloatingMenuProps = Omit<Optional<FloatingMenuPluginProps, 'pluginKey'>, 'element' | 'editor'> & {
    editor: FloatingMenuPluginProps['editor'] | null;
    options?: FloatingMenuPluginProps['options'];
} & React.HTMLAttributes<HTMLDivElement>;
declare const FloatingMenu: React.ForwardRefExoticComponent<Omit<Optional<FloatingMenuPluginProps, "pluginKey">, "editor" | "element"> & {
    editor: FloatingMenuPluginProps["editor"] | null;
    options?: FloatingMenuPluginProps["options"];
} & React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>>;

export { BubbleMenu, type BubbleMenuProps, FloatingMenu, type FloatingMenuProps };
