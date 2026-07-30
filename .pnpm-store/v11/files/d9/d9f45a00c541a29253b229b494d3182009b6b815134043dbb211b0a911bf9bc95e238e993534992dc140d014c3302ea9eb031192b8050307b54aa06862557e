import { Editor, Extension } from '@tiptap/core';
import * as _floating_ui_dom from '@floating-ui/dom';
import { VirtualElement, offset, flip, shift, arrow, size, autoPlacement, hide, inline } from '@floating-ui/dom';
import { PluginKey, EditorState, Plugin, PluginView, Transaction } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';

interface BubbleMenuPluginProps {
    /**
     * The plugin key.
     * @type {PluginKey | string}
     * @default 'bubbleMenu'
     */
    pluginKey: PluginKey | string;
    /**
     * The editor instance.
     */
    editor: Editor;
    /**
     * The DOM element that contains your menu.
     * @type {HTMLElement}
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
     * A function that determines whether the menu should be shown or not.
     * If this function returns `false`, the menu will be hidden, otherwise it will be shown.
     */
    shouldShow?: ((props: {
        editor: Editor;
        element: HTMLElement;
        view: EditorView;
        state: EditorState;
        oldState?: EditorState;
        from: number;
        to: number;
    }) => boolean) | null;
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
     * A function that returns the virtual element for the menu.
     * This is useful when the menu needs to be positioned relative to a specific DOM element.
     * @type {() => VirtualElement | null}
     * @default Position based on the selection.
     */
    getReferencedVirtualElement?: () => VirtualElement | null;
    /**
     * The options for the bubble menu. Those are passed to Floating UI and include options for the placement, offset, flip, shift, arrow, size, autoPlacement,
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
         * The scrollable element that should be listened to when updating the position of the bubble menu.
         * If not provided, the window will be used.
         * @type {HTMLElement | Window}
         */
        scrollTarget?: HTMLElement | Window;
    };
}
type BubbleMenuViewProps = BubbleMenuPluginProps & {
    view: EditorView;
};
declare class BubbleMenuView implements PluginView {
    editor: Editor;
    element: HTMLElement;
    view: EditorView;
    preventHide: boolean;
    pluginKey: PluginKey | string;
    updateDelay: number;
    resizeDelay: number;
    appendTo: HTMLElement | (() => HTMLElement) | undefined;
    getReferencedVirtualElement: (() => VirtualElement | null) | undefined;
    private updateDebounceTimer;
    private resizeDebounceTimer;
    private isVisible;
    private scrollTarget;
    private floatingUIOptions;
    shouldShow: Exclude<BubbleMenuPluginProps['shouldShow'], null>;
    get middlewares(): {
        options?: any;
        name: string;
        fn: (state: _floating_ui_dom.MiddlewareState) => _floating_ui_dom.MiddlewareReturn | Promise<_floating_ui_dom.MiddlewareReturn>;
    }[];
    private get virtualElement();
    constructor({ editor, element, view, pluginKey, updateDelay, resizeDelay, shouldShow, appendTo, getReferencedVirtualElement, options, }: BubbleMenuViewProps);
    mousedownHandler: () => void;
    dragstartHandler: () => void;
    /**
     * Handles the window resize event to update the position of the bubble menu.
     * It uses a debounce mechanism to prevent excessive updates.
     * The delay is defined by the `resizeDelay` property.
     */
    resizeHandler: () => void;
    focusHandler: () => void;
    blurHandler: ({ event }: {
        event: FocusEvent;
    }) => void;
    updatePosition(): void;
    update(view: EditorView, oldState?: EditorState): void;
    handleDebouncedUpdate: (view: EditorView, oldState?: EditorState) => void;
    getShouldShow(oldState?: EditorState): boolean;
    updateHandler: (view: EditorView, selectionChanged: boolean, docChanged: boolean, oldState?: EditorState) => void;
    show(): void;
    hide(): void;
    /**
     * Handles the transaction event to update the position of the bubble menu.
     * This allows external code to trigger a position update via:
     * `editor.view.dispatch(editor.state.tr.setMeta(pluginKey, 'updatePosition'))`
     * The `pluginKey` defaults to `bubbleMenu`
     */
    transactionHandler: ({ transaction: tr }: {
        transaction: Transaction;
    }) => void;
    updateOptions(newProps: Partial<Omit<BubbleMenuPluginProps, 'editor' | 'element' | 'pluginKey'>>): void;
    destroy(): void;
}
declare const BubbleMenuPlugin: (options: BubbleMenuPluginProps) => Plugin<any>;

type BubbleMenuOptions = Omit<BubbleMenuPluginProps, 'editor' | 'element'> & {
    /**
     * The DOM element that contains your menu.
     * @type {HTMLElement}
     * @default null
     */
    element: HTMLElement | null;
};
/**
 * This extension allows you to create a bubble menu.
 * @see https://tiptap.dev/api/extensions/bubble-menu
 */
declare const BubbleMenu: Extension<BubbleMenuOptions, any>;

export { BubbleMenu, type BubbleMenuOptions, BubbleMenuPlugin, type BubbleMenuPluginProps, BubbleMenuView, type BubbleMenuViewProps, BubbleMenu as default };
