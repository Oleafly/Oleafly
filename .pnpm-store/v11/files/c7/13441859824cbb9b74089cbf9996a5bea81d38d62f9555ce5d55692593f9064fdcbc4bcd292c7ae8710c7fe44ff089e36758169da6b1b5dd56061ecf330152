import { Editor, Extension } from '@tiptap/core';
import * as _floating_ui_dom from '@floating-ui/dom';
import { offset, flip, shift, arrow, size, autoPlacement, hide, inline } from '@floating-ui/dom';
import { PluginKey, EditorState, Plugin, Transaction } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';

interface FloatingMenuPluginProps {
    /**
     * The plugin key for the floating menu.
     * @default 'floatingMenu'
     */
    pluginKey: PluginKey | string;
    /**
     * The editor instance.
     * @default null
     */
    editor: Editor;
    /**
     * The DOM element that contains your menu.
     * @default null
     */
    element: HTMLElement;
    /**
     * The delay in milliseconds before the menu should be updated.
     * This can be useful to prevent performance issues.
     * @type {number}
     * @default 250
     */
    updateDelay?: number;
    /**
     * The delay in milliseconds before the menu position should be updated on window resize.
     * This can be useful to prevent performance issues.
     * @type {number}
     * @default 60
     */
    resizeDelay?: number;
    /**
     * The DOM element to append your menu to. Default is the editor's parent element.
     *
     * Sometimes the menu needs to be appended to a different DOM context due to accessibility, clipping, or z-index issues.
     *
     * @type {HTMLElement}
     * @default null
     */
    appendTo?: HTMLElement | (() => HTMLElement);
    /**
     * A function that determines whether the menu should be shown or not.
     * If this function returns `false`, the menu will be hidden, otherwise it will be shown.
     */
    shouldShow?: ((props: {
        editor: Editor;
        view: EditorView;
        state: EditorState;
        oldState?: EditorState;
        from: number;
        to: number;
    }) => boolean) | null;
    /**
     * The options for the floating menu. Those are passed to Floating UI and include options for the placement, offset, flip, shift, arrow, size, autoPlacement,
     * hide, and inline middlewares.
     * @default {}
     * @see https://floating-ui.com/docs/computePosition#options
     */
    options?: {
        strategy?: 'absolute' | 'fixed';
        placement?: 'top' | 'right' | 'bottom' | 'left' | 'top-start' | 'top-end' | 'right-start' | 'right-end' | 'bottom-start' | 'bottom-end' | 'left-start' | 'left-end';
        offset?: Parameters<typeof offset>[0] | boolean;
        flip?: Parameters<typeof flip>[0] | boolean;
        shift?: Parameters<typeof shift>[0] | boolean;
        arrow?: Parameters<typeof arrow>[0] | false;
        size?: Parameters<typeof size>[0] | boolean;
        autoPlacement?: Parameters<typeof autoPlacement>[0] | boolean;
        hide?: Parameters<typeof hide>[0] | boolean;
        inline?: Parameters<typeof inline>[0] | boolean;
        onShow?: () => void;
        onHide?: () => void;
        onUpdate?: () => void;
        onDestroy?: () => void;
        /**
         * The scrollable element that should be listened to when updating the position of the floating menu.
         * If not provided, the window will be used.
         * @type {HTMLElement | Window}
         */
        scrollTarget?: HTMLElement | Window;
    };
}
type FloatingMenuViewProps = FloatingMenuPluginProps & {
    /**
     * The editor view.
     */
    view: EditorView;
};
declare class FloatingMenuView {
    editor: Editor;
    element: HTMLElement;
    view: EditorView;
    preventHide: boolean;
    pluginKey: PluginKey | string;
    /**
     * The delay in milliseconds before the menu should be updated.
     * @default 250
     */
    updateDelay: number;
    /**
     * The delay in milliseconds before the menu position should be updated on window resize.
     * @default 60
     */
    resizeDelay: number;
    appendTo: HTMLElement | (() => HTMLElement) | undefined;
    private updateDebounceTimer;
    private resizeDebounceTimer;
    private isVisible;
    private scrollTarget;
    private getTextContent;
    shouldShow: Exclude<FloatingMenuPluginProps['shouldShow'], null>;
    private floatingUIOptions;
    get middlewares(): {
        options?: any;
        name: string;
        fn: (state: _floating_ui_dom.MiddlewareState) => _floating_ui_dom.MiddlewareReturn | Promise<_floating_ui_dom.MiddlewareReturn>;
    }[];
    constructor({ editor, element, view, pluginKey, updateDelay, resizeDelay, options, appendTo, shouldShow, }: FloatingMenuViewProps);
    getShouldShow(oldState?: EditorState): boolean | undefined;
    updateHandler: (view: EditorView, selectionChanged: boolean, docChanged: boolean, oldState?: EditorState) => void;
    mousedownHandler: () => void;
    focusHandler: () => void;
    blurHandler: ({ event }: {
        event: FocusEvent;
    }) => void;
    /**
     * Handles the transaction event to update the position of the floating menu.
     * This allows external code to trigger a position update via:
     * `editor.view.dispatch(editor.state.tr.setMeta(pluginKey, 'updatePosition'))`
     * The `pluginKey` defaults to `floatingMenu`
     */
    transactionHandler: ({ transaction: tr }: {
        transaction: Transaction;
    }) => void;
    updateOptions(newProps: Partial<Omit<FloatingMenuPluginProps, 'editor' | 'element' | 'pluginKey'>>): void;
    /**
     * Handles the window resize event to update the position of the floating menu.
     * It uses a debounce mechanism to prevent excessive updates.
     * The delay is defined by the `resizeDelay` property.
     */
    resizeHandler: () => void;
    updatePosition(): void;
    update(view: EditorView, oldState?: EditorState): void;
    show(): void;
    hide(): void;
    destroy(): void;
}
declare const FloatingMenuPlugin: (options: FloatingMenuPluginProps) => Plugin<any>;

type FloatingMenuOptions = Omit<FloatingMenuPluginProps, 'editor' | 'element'> & {
    /**
     * The DOM element that contains your menu.
     * @type {HTMLElement}
     * @default null
     */
    element: HTMLElement | null;
};
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        floatingMenu: {
            /**
             * Update the position of the floating menu.
             * @example editor.commands.updateFloatingMenuPosition()
             */
            updateFloatingMenuPosition: () => ReturnType;
        };
    }
}
/**
 * This extension allows you to create a floating menu.
 * @see https://tiptap.dev/api/extensions/floating-menu
 */
declare const FloatingMenu: Extension<FloatingMenuOptions, any>;

export { FloatingMenu, type FloatingMenuOptions, FloatingMenuPlugin, type FloatingMenuPluginProps, FloatingMenuView, type FloatingMenuViewProps, FloatingMenu as default };
