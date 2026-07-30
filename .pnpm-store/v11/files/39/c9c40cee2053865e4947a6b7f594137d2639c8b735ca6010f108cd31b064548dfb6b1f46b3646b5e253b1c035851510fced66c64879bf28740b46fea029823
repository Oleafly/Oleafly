import * as react_jsx_runtime from 'react/jsx-runtime';
import { EditorOptions, Editor, MarkView, MarkViewProps, MarkViewRendererOptions, MarkViewRenderer, NodeViewProps, NodeViewRendererOptions, NodeView, NodeViewRendererProps, NodeViewRenderer } from '@tiptap/core';
export * from '@tiptap/core';
import * as React from 'react';
import React__default, { DependencyList, ReactNode, HTMLAttributes, ComponentClass, FunctionComponent, ForwardRefExoticComponent, PropsWithoutRef, RefAttributes, ReactPortal, HTMLProps, ForwardedRef, ComponentProps, ComponentType as ComponentType$1 } from 'react';
import { Node } from '@tiptap/pm/model';
import { Decoration, DecorationSource } from '@tiptap/pm/view';

/**
 * The options for the `useEditor` hook.
 */
type UseEditorOptions = Partial<EditorOptions> & {
    /**
     * Whether to render the editor on the first render.
     * If client-side rendering, set this to `true`.
     * If server-side rendering, set this to `false`.
     * @default true
     */
    immediatelyRender?: boolean;
    /**
     * Whether to re-render the editor on each transaction.
     * This is legacy behavior that will be removed in future versions.
     * @default false
     */
    shouldRerenderOnTransaction?: boolean;
};
/**
 * This hook allows you to create an editor instance.
 * @param options The editor options
 * @param deps The dependencies to watch for changes
 * @returns The editor instance
 * @example const editor = useEditor({ extensions: [...] })
 */
declare function useEditor(options: UseEditorOptions & {
    immediatelyRender: false;
}, deps?: DependencyList): Editor | null;
/**
 * This hook allows you to create an editor instance.
 * @param options The editor options
 * @param deps The dependencies to watch for changes
 * @returns The editor instance
 * @example const editor = useEditor({ extensions: [...] })
 */
declare function useEditor(options: UseEditorOptions, deps?: DependencyList): Editor;

type EditorContextValue = {
    editor: Editor | null;
};
declare const EditorContext: React__default.Context<EditorContextValue>;
declare const EditorConsumer: React__default.Consumer<EditorContextValue>;
/**
 * A hook to get the current editor instance.
 */
declare const useCurrentEditor: () => EditorContextValue;
type EditorProviderProps = {
    children?: ReactNode;
    slotBefore?: ReactNode;
    slotAfter?: ReactNode;
    editorContainerProps?: HTMLAttributes<HTMLDivElement>;
} & UseEditorOptions;
/**
 * This is the provider component for the editor.
 * It allows the editor to be accessible across the entire component tree
 * with `useCurrentEditor`.
 */
declare function EditorProvider({ children, slotAfter, slotBefore, editorContainerProps, ...editorOptions }: EditorProviderProps): react_jsx_runtime.JSX.Element | null;

interface ReactRendererOptions {
    /**
     * The editor instance.
     * @type {Editor}
     */
    editor: Editor;
    /**
     * The props for the component.
     * @type {Record<string, any>}
     * @default {}
     */
    props?: Record<string, any>;
    /**
     * The tag name of the element.
     * @type {string}
     * @default 'div'
     */
    as?: string;
    /**
     * The class name of the element.
     * @type {string}
     * @default ''
     * @example 'foo bar'
     */
    className?: string;
}
type ComponentType<R, P> = ComponentClass<P> | FunctionComponent<P> | ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<R>>;
/**
 * The ReactRenderer class. It's responsible for rendering React components inside the editor.
 * @example
 * new ReactRenderer(MyComponent, {
 *   editor,
 *   props: {
 *     foo: 'bar',
 *   },
 *   as: 'span',
 * })
 */
declare class ReactRenderer<R = unknown, P extends Record<string, any> = object> {
    id: string;
    editor: EditorWithContentComponent;
    component: any;
    element: HTMLElement;
    props: P;
    reactElement: ReactNode;
    ref: R | null;
    /**
     * Flag to track if the renderer has been destroyed, preventing queued or asynchronous renders from executing after teardown.
     */
    destroyed: boolean;
    /**
     * Immediately creates element and renders the provided React component.
     */
    constructor(component: ComponentType<R, P>, { editor, props, as, className }: ReactRendererOptions);
    /**
     * Render the React component.
     */
    render(): void;
    /**
     * Re-renders the React component with new props.
     * Skips the render if none of the supplied props actually changed,
     * to avoid unnecessary portal re-creation.
     */
    updateProps(props?: Record<string, any>): void;
    /**
     * Destroy the React component.
     */
    destroy(): void;
    /**
     * Update the attributes of the element that holds the React component.
     */
    updateAttributes(attributes: Record<string, string>): void;
}

type EditorWithContentComponent = Editor & {
    contentComponent?: ContentComponent | null;
    isEditorContentInitialized?: boolean;
};
type ContentComponent = {
    setRenderer(id: string, renderer: ReactRenderer): void;
    removeRenderer(id: string): void;
    subscribe: (callback: () => void) => () => void;
    getSnapshot: () => Record<string, ReactPortal>;
    getServerSnapshot: () => Record<string, ReactPortal>;
};

interface EditorContentProps extends HTMLProps<HTMLDivElement> {
    editor: Editor | null;
    innerRef?: ForwardedRef<HTMLDivElement | null>;
}
declare function createContentComponent(): ContentComponent;
declare class PureEditorContent extends React__default.Component<EditorContentProps, {
    hasContentComponentInitialized: boolean;
}> {
    editorContentRef: React__default.RefObject<any>;
    constructor(props: EditorContentProps);
    componentDidMount(): void;
    componentDidUpdate(): void;
    init(): void;
    componentWillUnmount(): void;
    render(): react_jsx_runtime.JSX.Element;
}
declare const EditorContent: React__default.NamedExoticComponent<Omit<EditorContentProps, "ref"> & React__default.RefAttributes<HTMLDivElement>>;

type NodeViewContentProps<T extends keyof React__default.JSX.IntrinsicElements = 'div'> = {
    as?: NoInfer<T>;
} & ComponentProps<T>;
declare function NodeViewContent<T extends keyof React__default.JSX.IntrinsicElements = 'div'>({ as: Tag, ...props }: NodeViewContentProps<T>): react_jsx_runtime.JSX.Element;

interface NodeViewWrapperProps {
    [key: string]: any;
    as?: React__default.ElementType;
}
declare const NodeViewWrapper: React__default.FC<NodeViewWrapperProps>;

interface MarkViewContextProps {
    markViewContentRef: (element: HTMLElement | null) => void;
}
declare const ReactMarkViewContext: React__default.Context<MarkViewContextProps>;
type MarkViewContentProps<T extends keyof React__default.JSX.IntrinsicElements = 'span'> = {
    as?: T;
} & Omit<React__default.ComponentProps<T>, 'as'>;
declare const MarkViewContent: <T extends keyof React__default.JSX.IntrinsicElements = "span">(props: MarkViewContentProps<T>) => react_jsx_runtime.JSX.Element;
interface ReactMarkViewRendererOptions extends MarkViewRendererOptions {
    /**
     * The tag name of the element wrapping the React component.
     */
    as?: string;
    className?: string;
    attrs?: {
        [key: string]: string;
    };
}
declare class ReactMarkView extends MarkView<React__default.ComponentType<MarkViewProps>, ReactMarkViewRendererOptions> {
    renderer: ReactRenderer;
    contentDOMElement: HTMLElement;
    constructor(component: React__default.ComponentType<MarkViewProps>, props: MarkViewProps, options?: Partial<ReactMarkViewRendererOptions>);
    get dom(): HTMLElement;
    get contentDOM(): HTMLElement;
}
declare function ReactMarkViewRenderer(component: React__default.ComponentType<MarkViewProps>, options?: Partial<ReactMarkViewRendererOptions>): MarkViewRenderer;

type ReactNodeViewProps<T = HTMLElement> = NodeViewProps & {
    ref: React__default.RefObject<T | null>;
};

interface ReactNodeViewRendererOptions extends NodeViewRendererOptions {
    /**
     * This function is called when the node view is updated.
     * It allows you to compare the old node with the new node and decide if the component should update.
     */
    update: ((props: {
        oldNode: Node;
        oldDecorations: readonly Decoration[];
        oldInnerDecorations: DecorationSource;
        newNode: Node;
        newDecorations: readonly Decoration[];
        innerDecorations: DecorationSource;
        updateProps: () => void;
    }) => boolean) | null;
    /**
     * The tag name of the element wrapping the React component.
     */
    as?: string;
    /**
     * The class name of the element wrapping the React component.
     */
    className?: string;
    /**
     * Attributes that should be applied to the element wrapping the React component.
     * If this is a function, it will be called each time the node view is updated.
     * If this is an object, it will be applied once when the node view is mounted.
     */
    attrs?: Record<string, string> | ((props: {
        node: Node;
        HTMLAttributes: Record<string, any>;
    }) => Record<string, string>);
}
declare class ReactNodeView<T = HTMLElement, Component extends ComponentType$1<ReactNodeViewProps<T>> = ComponentType$1<ReactNodeViewProps<T>>, NodeEditor extends Editor = Editor, Options extends ReactNodeViewRendererOptions = ReactNodeViewRendererOptions> extends NodeView<Component, NodeEditor, Options> {
    /**
     * The renderer instance.
     */
    renderer: ReactRenderer<unknown, ReactNodeViewProps<T>>;
    /**
     * The element that holds the rich-text content of the node.
     */
    contentDOMElement: HTMLElement | null;
    /**
     * The requestAnimationFrame ID used for selection updates.
     */
    selectionRafId: number | null;
    /**
     * The last known position of this node view, used to detect position-only
     * changes that don't produce a new node object reference.
     */
    private currentPos;
    /**
     * Fires on editor updates when trackNodeViewPosition is enabled.
     * Detects position shifts where update() is NOT called (e.g. typing above).
     */
    private handlePositionUpdate;
    constructor(component: Component, props: NodeViewRendererProps, options?: Partial<Options>);
    private cachedExtensionWithSyncedStorage;
    /**
     * Returns a proxy of the extension that redirects storage access to the editor's mutable storage.
     * This preserves the original prototype chain (instanceof checks, methods like configure/extend work).
     * Cached to avoid proxy creation on every update.
     */
    get extensionWithSyncedStorage(): NodeViewRendererProps['extension'];
    /**
     * Setup the React component.
     * Called on initialization.
     */
    mount(): void;
    /**
     * Return the DOM element.
     * This is the element that will be used to display the node view.
     */
    get dom(): HTMLElement;
    /**
     * Return the content DOM element.
     * This is the element that will be used to display the rich-text content of the node.
     */
    get contentDOM(): HTMLElement | null;
    /**
     * On editor selection update, check if the node is selected.
     * If it is, call `selectNode`, otherwise call `deselectNode`.
     */
    handleSelectionUpdate(): void;
    /**
     * On update, update the React component.
     * To prevent unnecessary updates, the `update` option can be used.
     */
    update(node: Node, decorations: readonly Decoration[], innerDecorations: DecorationSource): boolean;
    /**
     * Select the node.
     * Add the `selected` prop and the `ProseMirror-selectednode` class.
     */
    selectNode(): void;
    /**
     * Deselect the node.
     * Remove the `selected` prop and the `ProseMirror-selectednode` class.
     */
    deselectNode(): void;
    /**
     * Destroy the React component instance.
     */
    destroy(): void;
    /**
     * Update the attributes of the top-level element that holds the React component.
     * Applying the attributes defined in the `attrs` option.
     */
    updateElementAttributes(): void;
}
/**
 * Create a React node view renderer.
 */
declare function ReactNodeViewRenderer<T = HTMLElement>(component: ComponentType$1<ReactNodeViewProps<T>>, options?: Partial<ReactNodeViewRendererOptions>): NodeViewRenderer;

/**
 * The shape of the React context used by the `<Tiptap />` components.
 *
 * The editor instance is always available when using the default `useEditor`
 * configuration. For SSR scenarios where `immediatelyRender: false` is used,
 * consider using the legacy `EditorProvider` pattern instead.
 */
type TiptapContextType = {
    /** The Tiptap editor instance. */
    editor: Editor;
};
/**
 * React context that stores the current editor instance.
 *
 * Use `useTiptap()` to read from this context in child components.
 */
declare const TiptapContext: React.Context<TiptapContextType>;
/**
 * Hook to read the Tiptap context and access the editor instance.
 *
 * This is a small convenience wrapper around `useContext(TiptapContext)`.
 * The editor is always available when used within a `<Tiptap>` provider.
 *
 * @returns The current `TiptapContextType` value from the provider.
 *
 * @example
 * ```tsx
 * import { useTiptap } from '@tiptap/react'
 *
 * function Toolbar() {
 *   const { editor } = useTiptap()
 *
 *   return (
 *     <button onClick={() => editor.chain().focus().toggleBold().run()}>
 *       Bold
 *     </button>
 *   )
 * }
 * ```
 */
declare const useTiptap: () => TiptapContextType;
/**
 * Select a slice of the editor state using the context-provided editor.
 *
 * This is a thin wrapper around `useEditorState` that reads the `editor`
 * instance from `useTiptap()` so callers don't have to pass it manually.
 *
 * @typeParam TSelectorResult - The type returned by the selector.
 * @param selector - Function that receives the editor state snapshot and
 *                   returns the piece of state you want to subscribe to.
 * @param equalityFn - Optional function to compare previous/next selected
 *                     values and avoid unnecessary updates.
 * @returns The selected slice of the editor state.
 *
 * @example
 * ```tsx
 * function WordCount() {
 *   const wordCount = useTiptapState(state => {
 *     const text = state.editor.state.doc.textContent
 *     return text.split(/\s+/).filter(Boolean).length
 *   })
 *
 *   return <span>{wordCount} words</span>
 * }
 * ```
 */
declare function useTiptapState<TSelectorResult>(selector: (context: EditorStateSnapshot<Editor>) => TSelectorResult, equalityFn?: (a: TSelectorResult, b: TSelectorResult | null) => boolean): TSelectorResult;
type TiptapWrapperEditorInstanceProps = {
    /**
     * The editor instance to provide to child components.
     * Use `useEditor()` to create this instance.
     */
    editor: Editor;
} | {
    /**
     * @deprecated Use `editor` instead. Will be removed in the next major version.
     */
    instance: Editor;
};
/**
 * Props for the `Tiptap` root/provider component.
 */
type TiptapWrapperProps = TiptapWrapperEditorInstanceProps & {
    children: ReactNode;
};
/**
 * Top-level provider component that makes the editor instance available via
 * React context to all child components.
 *
 * This component also provides backwards compatibility with the legacy
 * `EditorContext`, so components using `useCurrentEditor()` will work
 * inside a `<Tiptap>` provider.
 *
 * @param props - Component props.
 * @returns A context provider element wrapping `children`.
 *
 * @example
 * ```tsx
 * import { Tiptap, useEditor } from '@tiptap/react'
 *
 * function App() {
 *   const editor = useEditor({ extensions: [...] })
 *
 *   return (
 *     <Tiptap editor={editor}>
 *       <Toolbar />
 *       <Tiptap.Content />
 *     </Tiptap>
 *   )
 * }
 * ```
 */
declare function TiptapWrapper({ children, ...props }: TiptapWrapperProps): react_jsx_runtime.JSX.Element;
declare namespace TiptapWrapper {
    var displayName: string;
}
/**
 * Convenience component that renders `EditorContent` using the context-provided
 * editor instance. Use this instead of manually passing the `editor` prop.
 *
 * @param props - All `EditorContent` props except `editor` and `ref`.
 * @returns An `EditorContent` element bound to the context editor.
 *
 * @example
 * ```tsx
 * // inside a Tiptap provider
 * <Tiptap.Content className="editor" />
 * ```
 */
declare function TiptapContent({ ...rest }: Omit<EditorContentProps, 'editor' | 'ref'>): react_jsx_runtime.JSX.Element;
declare namespace TiptapContent {
    var displayName: string;
}
/**
 * Root `Tiptap` component. Use it as the provider for all child components.
 *
 * The exported object includes the `Content` subcomponent for rendering the
 * editor content area.
 *
 * This component provides both the new `TiptapContext` (accessed via `useTiptap()`)
 * and the legacy `EditorContext` (accessed via `useCurrentEditor()`) for
 * backwards compatibility.
 *
 * For bubble menus and floating menus, import them separately from
 * `@tiptap/react/menus` to keep floating-ui as an optional dependency.
 *
 * @example
 * ```tsx
 * import { Tiptap, useEditor } from '@tiptap/react'
 * import { BubbleMenu } from '@tiptap/react/menus'
 *
 * function App() {
 *   const editor = useEditor({ extensions: [...] })
 *
 *   return (
 *     <Tiptap editor={editor}>
 *       <Tiptap.Content />
 *       <BubbleMenu>
 *         <button onClick={() => editor.chain().focus().toggleBold().run()}>Bold</button>
 *       </BubbleMenu>
 *     </Tiptap>
 *   )
 * }
 * ```
 */
declare const Tiptap: typeof TiptapWrapper & {
    /**
     * The Tiptap Content component that renders the EditorContent with the editor instance from the context.
     * @see TiptapContent
     */
    Content: typeof TiptapContent;
};

type EditorStateSnapshot<TEditor extends Editor | null = Editor | null> = {
    editor: TEditor;
    transactionNumber: number;
};
type UseEditorStateOptions<TSelectorResult, TEditor extends Editor | null = Editor | null> = {
    /**
     * The editor instance.
     */
    editor: TEditor;
    /**
     * A selector function to determine the value to compare for re-rendering.
     */
    selector: (context: EditorStateSnapshot<TEditor>) => TSelectorResult;
    /**
     * A custom equality function to determine if the editor should re-render.
     * @default `deepEqual` from `fast-deep-equal`
     */
    equalityFn?: (a: TSelectorResult, b: TSelectorResult | null) => boolean;
};
/**
 * This hook allows you to watch for changes on the editor instance.
 * It will allow you to select a part of the editor state and re-render the component when it changes.
 * @example
 * ```tsx
 * const editor = useEditor({...options})
 * const { currentSelection } = useEditorState({
 *  editor,
 *  selector: snapshot => ({ currentSelection: snapshot.editor.state.selection }),
 * })
 */
declare function useEditorState<TSelectorResult>(options: UseEditorStateOptions<TSelectorResult, Editor>): TSelectorResult;
/**
 * This hook allows you to watch for changes on the editor instance.
 * It will allow you to select a part of the editor state and re-render the component when it changes.
 * @example
 * ```tsx
 * const editor = useEditor({...options})
 * const { currentSelection } = useEditorState({
 *  editor,
 *  selector: snapshot => ({ currentSelection: snapshot.editor.state.selection }),
 * })
 */
declare function useEditorState<TSelectorResult>(options: UseEditorStateOptions<TSelectorResult, Editor | null>): TSelectorResult | null;

interface ReactNodeViewContextProps {
    onDragStart?: (event: DragEvent) => void;
    nodeViewContentRef?: (element: HTMLElement | null) => void;
    /**
     * This allows you to add children into the NodeViewContent component.
     * This is useful when statically rendering the content of a node view.
     */
    nodeViewContentChildren?: ReactNode;
}
declare const ReactNodeViewContext: React.Context<ReactNodeViewContextProps>;
declare const ReactNodeViewContentProvider: ({ children, content, }: {
    children: ReactNode;
    content: ReactNode;
}) => React.FunctionComponentElement<React.ProviderProps<ReactNodeViewContextProps>>;
declare const useReactNodeView: () => ReactNodeViewContextProps;

export { EditorConsumer, EditorContent, type EditorContentProps, EditorContext, type EditorContextValue, EditorProvider, type EditorProviderProps, type EditorStateSnapshot, MarkViewContent, type MarkViewContentProps, type MarkViewContextProps, NodeViewContent, type NodeViewContentProps, NodeViewWrapper, type NodeViewWrapperProps, PureEditorContent, ReactMarkView, ReactMarkViewContext, ReactMarkViewRenderer, type ReactMarkViewRendererOptions, ReactNodeView, ReactNodeViewContentProvider, ReactNodeViewContext, type ReactNodeViewContextProps, type ReactNodeViewProps, ReactNodeViewRenderer, type ReactNodeViewRendererOptions, ReactRenderer, type ReactRendererOptions, Tiptap, TiptapContent, TiptapContext, type TiptapContextType, TiptapWrapper, type TiptapWrapperEditorInstanceProps, type TiptapWrapperProps, type UseEditorOptions, type UseEditorStateOptions, createContentComponent, useCurrentEditor, useEditor, useEditorState, useReactNodeView, useTiptap, useTiptapState };
