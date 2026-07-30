import { EditorState, Plugin, Transaction, Selection, NodeSelection, TextSelection, PluginKey } from '@tiptap/pm/state';
import { MarkType as MarkType$1, MarkSpec, Mark as Mark$1, DOMOutputSpec, NodeType as NodeType$1, NodeSpec, Node as Node$1, Slice, ParseOptions, Fragment as Fragment$1, Schema, ContentMatch, ResolvedPos, ParseRule } from '@tiptap/pm/model';
import { NodeViewConstructor, NodeView as NodeView$1, MarkViewConstructor, MarkView as MarkView$1, EditorProps, EditorView, Decoration, DecorationAttrs, ViewMutationRecord, DecorationSource } from '@tiptap/pm/view';
import { MapResult, Transform, Mappable } from '@tiptap/pm/transform';

type StringKeyOf<T> = Extract<keyof T, string>;
type CallbackType<T extends Record<string, any>, EventName extends StringKeyOf<T>> = T[EventName] extends any[] ? T[EventName] : [T[EventName]];
type CallbackFunction<T extends Record<string, any>, EventName extends StringKeyOf<T>> = (...props: CallbackType<T, EventName>) => any;
declare class EventEmitter<T extends Record<string, any>> {
    private callbacks;
    on<EventName extends StringKeyOf<T>>(event: EventName, fn: CallbackFunction<T, EventName>): this;
    emit<EventName extends StringKeyOf<T>>(event: EventName, ...args: CallbackType<T, EventName>): this;
    off<EventName extends StringKeyOf<T>>(event: EventName, fn?: CallbackFunction<T, EventName>): this;
    once<EventName extends StringKeyOf<T>>(event: EventName, fn: CallbackFunction<T, EventName>): this;
    removeAllListeners(): void;
}

type InputRuleMatch = {
    index: number;
    text: string;
    replaceWith?: string;
    match?: RegExpMatchArray;
    data?: Record<string, any>;
};
type InputRuleFinder = RegExp | ((text: string) => InputRuleMatch | null);
declare class InputRule {
    find: InputRuleFinder;
    handler: (props: {
        state: EditorState;
        range: Range;
        match: ExtendedRegExpMatchArray;
        commands: SingleCommands;
        chain: () => ChainedCommands;
        can: () => CanCommands;
    }) => void | null;
    undoable: boolean;
    constructor(config: {
        find: InputRuleFinder;
        handler: (props: {
            state: EditorState;
            range: Range;
            match: ExtendedRegExpMatchArray;
            commands: SingleCommands;
            chain: () => ChainedCommands;
            can: () => CanCommands;
        }) => void | null;
        undoable?: boolean;
    });
}
/**
 * Create an input rules plugin. When enabled, it will cause text
 * input that matches any of the given rules to trigger the rule’s
 * action.
 */
declare function inputRulesPlugin(props: {
    editor: Editor;
    rules: InputRule[];
}): Plugin;

interface MarkConfig<Options = any, Storage = any> extends ExtendableConfig<Options, Storage, MarkConfig<Options, Storage>, MarkType$1> {
    /**
     * Mark View
     */
    addMarkView?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: MarkType$1;
        parent: ParentConfig<MarkConfig<Options, Storage>>['addMarkView'];
    }) => MarkViewRenderer) | null;
    /**
     * Keep mark after split node
     */
    keepOnSplit?: boolean | (() => boolean);
    /**
     * Whether this mark is removed by `unsetAllMarks`.
     * Set to `false` for semantic marks (comments, suggestions) that should survive "clear formatting".
     * @default true
     */
    clearable?: boolean | (() => boolean);
    /**
     * Inclusive
     */
    inclusive?: MarkSpec['inclusive'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<MarkConfig<Options, Storage>>['inclusive'];
        editor?: Editor;
    }) => MarkSpec['inclusive']);
    /**
     * Excludes
     */
    excludes?: MarkSpec['excludes'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<MarkConfig<Options, Storage>>['excludes'];
        editor?: Editor;
    }) => MarkSpec['excludes']);
    /**
     * Marks this Mark as exitable
     */
    exitable?: boolean | (() => boolean);
    /**
     * Group
     */
    group?: MarkSpec['group'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<MarkConfig<Options, Storage>>['group'];
        editor?: Editor;
    }) => MarkSpec['group']);
    /**
     * Spanning
     */
    spanning?: MarkSpec['spanning'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<MarkConfig<Options, Storage>>['spanning'];
        editor?: Editor;
    }) => MarkSpec['spanning']);
    /**
     * Code
     */
    code?: boolean | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<MarkConfig<Options, Storage>>['code'];
        editor?: Editor;
    }) => boolean);
    /**
     * Parse HTML
     */
    parseHTML?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<MarkConfig<Options, Storage>>['parseHTML'];
        editor?: Editor;
    }) => MarkSpec['parseDOM'];
    /**
     * Render HTML
     */
    renderHTML?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<MarkConfig<Options, Storage>>['renderHTML'];
        editor?: Editor;
    }, props: {
        mark: Mark$1;
        HTMLAttributes: Record<string, any>;
    }) => DOMOutputSpec) | null;
    /**
     * Attributes
     */
    addAttributes?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<MarkConfig<Options, Storage>>['addAttributes'];
        editor?: Editor;
    }) => Attributes$1 | {};
}
/**
 * The Mark class is used to create custom mark extensions.
 * @see https://tiptap.dev/api/extensions#create-a-new-extension
 */
declare class Mark<Options = any, Storage = any> extends Extendable<Options, Storage, MarkConfig<Options, Storage>> {
    type: string;
    /**
     * Create a new Mark instance
     * @param config - Mark configuration object or a function that returns a configuration object
     */
    static create<O = any, S = any>(config?: Partial<MarkConfig<O, S>> | (() => Partial<MarkConfig<O, S>>)): Mark<O, S>;
    static handleExit({ editor, mark }: {
        editor: Editor;
        mark: Mark;
    }): boolean;
    configure(options?: Partial<Options>): Mark<Options, Storage>;
    extend<ExtendedOptions = Options, ExtendedStorage = Storage, ExtendedConfig extends MarkConfig<ExtendedOptions, ExtendedStorage> = MarkConfig<ExtendedOptions, ExtendedStorage>>(extendedConfig?: (() => Partial<ExtendedConfig>) | (Partial<ExtendedConfig> & ThisType<{
        name: string;
        options: ExtendedOptions;
        storage: ExtendedStorage;
        editor: Editor;
        type: MarkType$1;
    }>)): Mark<ExtendedOptions, ExtendedStorage>;
}

interface NodeConfig<Options = any, Storage = any> extends ExtendableConfig<Options, Storage, NodeConfig<Options, Storage>, NodeType$1> {
    /**
     * Node View
     */
    addNodeView?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: NodeType$1;
        parent: ParentConfig<NodeConfig<Options, Storage>>['addNodeView'];
    }) => NodeViewRenderer | null) | null;
    /**
     * Defines if this node should be a top level node (doc)
     * @default false
     * @example true
     */
    topNode?: boolean;
    /**
     * The content expression for this node, as described in the [schema
     * guide](/docs/guide/#schema.content_expressions). When not given,
     * the node does not allow any content.
     *
     * You can read more about it on the Prosemirror documentation here
     * @see https://prosemirror.net/docs/guide/#schema.content_expressions
     * @default undefined
     * @example content: 'block+'
     * @example content: 'headline paragraph block*'
     */
    content?: NodeSpec['content'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['content'];
        editor?: Editor;
    }) => NodeSpec['content']);
    /**
     * The marks that are allowed inside of this node. May be a
     * space-separated string referring to mark names or groups, `"_"`
     * to explicitly allow all marks, or `""` to disallow marks. When
     * not given, nodes with inline content default to allowing all
     * marks, other nodes default to not allowing marks.
     *
     * @example marks: 'strong em'
     */
    marks?: NodeSpec['marks'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['marks'];
        editor?: Editor;
    }) => NodeSpec['marks']);
    /**
     * The group or space-separated groups to which this node belongs,
     * which can be referred to in the content expressions for the
     * schema.
     *
     * By default Tiptap uses the groups 'block' and 'inline' for nodes. You
     * can also use custom groups if you want to group specific nodes together
     * and handle them in your schema.
     * @example group: 'block'
     * @example group: 'inline'
     * @example group: 'customBlock' // this uses a custom group
     */
    group?: NodeSpec['group'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['group'];
        editor?: Editor;
    }) => NodeSpec['group']);
    /**
     * Should be set to true for inline nodes. (Implied for text nodes.)
     */
    inline?: NodeSpec['inline'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['inline'];
        editor?: Editor;
    }) => NodeSpec['inline']);
    /**
     * Can be set to true to indicate that, though this isn't a [leaf
     * node](https://prosemirror.net/docs/ref/#model.NodeType.isLeaf), it doesn't have directly editable
     * content and should be treated as a single unit in the view.
     *
     * @example atom: true
     */
    atom?: NodeSpec['atom'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['atom'];
        editor?: Editor;
    }) => NodeSpec['atom']);
    /**
     * Controls whether nodes of this type can be selected as a [node
     * selection](https://prosemirror.net/docs/ref/#state.NodeSelection). Defaults to true for non-text
     * nodes.
     *
     * @default true
     * @example selectable: false
     */
    selectable?: NodeSpec['selectable'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['selectable'];
        editor?: Editor;
    }) => NodeSpec['selectable']);
    /**
     * Determines whether nodes of this type can be dragged without
     * being selected. Defaults to false.
     *
     * @default: false
     * @example: draggable: true
     */
    draggable?: NodeSpec['draggable'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['draggable'];
        editor?: Editor;
    }) => NodeSpec['draggable']);
    /**
     * Can be used to indicate that this node contains code, which
     * causes some commands to behave differently.
     */
    code?: NodeSpec['code'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['code'];
        editor?: Editor;
    }) => NodeSpec['code']);
    /**
     * Controls way whitespace in this a node is parsed. The default is
     * `"normal"`, which causes the [DOM parser](https://prosemirror.net/docs/ref/#model.DOMParser) to
     * collapse whitespace in normal mode, and normalize it (replacing
     * newlines and such with spaces) otherwise. `"pre"` causes the
     * parser to preserve spaces inside the node. When this option isn't
     * given, but [`code`](https://prosemirror.net/docs/ref/#model.NodeSpec.code) is true, `whitespace`
     * will default to `"pre"`. Note that this option doesn't influence
     * the way the node is rendered—that should be handled by `toDOM`
     * and/or styling.
     */
    whitespace?: NodeSpec['whitespace'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['whitespace'];
        editor?: Editor;
    }) => NodeSpec['whitespace']);
    /**
     * Allows a **single** node to be set as linebreak equivalent (e.g. hardBreak).
     * When converting between block types that have whitespace set to "pre"
     * and don't support the linebreak node (e.g. codeBlock) and other block types
     * that do support the linebreak node (e.g. paragraphs) - this node will be used
     * as the linebreak instead of stripping the newline.
     *
     * See [linebreakReplacement](https://prosemirror.net/docs/ref/#model.NodeSpec.linebreakReplacement).
     */
    linebreakReplacement?: NodeSpec['linebreakReplacement'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['linebreakReplacement'];
        editor?: Editor;
    }) => NodeSpec['linebreakReplacement']);
    /**
     * When enabled, enables both
     * [`definingAsContext`](https://prosemirror.net/docs/ref/#model.NodeSpec.definingAsContext) and
     * [`definingForContent`](https://prosemirror.net/docs/ref/#model.NodeSpec.definingForContent).
     *
     * @default false
     * @example isolating: true
     */
    defining?: NodeSpec['defining'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['defining'];
        editor?: Editor;
    }) => NodeSpec['defining']);
    /**
     * When enabled (default is false), the sides of nodes of this type
     * count as boundaries that regular editing operations, like
     * backspacing or lifting, won't cross. An example of a node that
     * should probably have this enabled is a table cell.
     */
    isolating?: NodeSpec['isolating'] | ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['isolating'];
        editor?: Editor;
    }) => NodeSpec['isolating']);
    /**
     * Associates DOM parser information with this node, which can be
     * used by [`DOMParser.fromSchema`](https://prosemirror.net/docs/ref/#model.DOMParser^fromSchema) to
     * automatically derive a parser. The `node` field in the rules is
     * implied (the name of this node will be filled in automatically).
     * If you supply your own parser, you do not need to also specify
     * parsing rules in your schema.
     *
     * @example parseHTML: [{ tag: 'div', attrs: { 'data-id': 'my-block' } }]
     */
    parseHTML?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['parseHTML'];
        editor?: Editor;
    }) => NodeSpec['parseDOM'];
    /**
     * A description of a DOM structure. Can be either a string, which is
     * interpreted as a text node, a DOM node, which is interpreted as
     * itself, a `{dom, contentDOM}` object, or an array.
     *
     * An array describes a DOM element. The first value in the array
     * should be a string—the name of the DOM element, optionally prefixed
     * by a namespace URL and a space. If the second element is plain
     * object, it is interpreted as a set of attributes for the element.
     * Any elements after that (including the 2nd if it's not an attribute
     * object) are interpreted as children of the DOM elements, and must
     * either be valid `DOMOutputSpec` values, or the number zero.
     *
     * The number zero (pronounced “hole”) is used to indicate the place
     * where a node's child nodes should be inserted. If it occurs in an
     * output spec, it should be the only child element in its parent
     * node.
     *
     * @example toDOM: ['div[data-id="my-block"]', { class: 'my-block' }, 0]
     */
    renderHTML?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['renderHTML'];
        editor?: Editor;
    }, props: {
        node: Node$1;
        HTMLAttributes: Record<string, any>;
    }) => DOMOutputSpec) | null;
    /**
     * renders the node as text
     * @example renderText: () => 'foo
     */
    renderText?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['renderText'];
        editor?: Editor;
    }, props: {
        node: Node$1;
        pos: number;
        parent: Node$1;
        index: number;
    }) => string) | null;
    /**
     * Add attributes to the node
     * @example addAttributes: () => ({ class: 'foo' })
     */
    addAttributes?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<NodeConfig<Options, Storage>>['addAttributes'];
        editor?: Editor;
    }) => Attributes$1 | {};
}
/**
 * The Node class is used to create custom node extensions.
 * @see https://tiptap.dev/api/extensions#create-a-new-extension
 */
declare class Node<Options = any, Storage = any> extends Extendable<Options, Storage, NodeConfig<Options, Storage>> {
    type: string;
    /**
     * Create a new Node instance
     * @param config - Node configuration object or a function that returns a configuration object
     */
    static create<O = any, S = any>(config?: Partial<NodeConfig<O, S>> | (() => Partial<NodeConfig<O, S>>)): Node<O, S>;
    configure(options?: Partial<Options>): Node<Options, Storage>;
    extend<ExtendedOptions = Options, ExtendedStorage = Storage, ExtendedConfig extends NodeConfig<ExtendedOptions, ExtendedStorage> = NodeConfig<ExtendedOptions, ExtendedStorage>>(extendedConfig?: (() => Partial<ExtendedConfig>) | (Partial<ExtendedConfig> & ThisType<{
        name: string;
        options: ExtendedOptions;
        storage: ExtendedStorage;
        editor: Editor;
        type: NodeType$1;
    }>)): Node<ExtendedOptions, ExtendedStorage>;
}

type PasteRuleMatch = {
    index: number;
    text: string;
    replaceWith?: string;
    match?: RegExpMatchArray;
    data?: Record<string, any>;
};
type PasteRuleFinder = RegExp | ((text: string, event?: ClipboardEvent | null) => PasteRuleMatch[] | null | undefined);
/**
 * Paste rules are used to react to pasted content.
 * @see https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing#paste-rules
 */
declare class PasteRule {
    find: PasteRuleFinder;
    handler: (props: {
        state: EditorState;
        range: Range;
        match: ExtendedRegExpMatchArray;
        commands: SingleCommands;
        chain: () => ChainedCommands;
        can: () => CanCommands;
        pasteEvent: ClipboardEvent | null;
        dropEvent: DragEvent | null;
    }) => void | null;
    constructor(config: {
        find: PasteRuleFinder;
        handler: (props: {
            can: () => CanCommands;
            chain: () => ChainedCommands;
            commands: SingleCommands;
            dropEvent: DragEvent | null;
            match: ExtendedRegExpMatchArray;
            pasteEvent: ClipboardEvent | null;
            range: Range;
            state: EditorState;
        }) => void | null;
    });
}
/**
 * Create an paste rules plugin. When enabled, it will cause pasted
 * text that matches any of the given rules to trigger the rule’s
 * action.
 */
declare function pasteRulesPlugin(props: {
    editor: Editor;
    rules: PasteRule[];
}): Plugin[];

interface ExtendableConfig<Options = any, Storage = any, Config extends ExtensionConfig<Options, Storage> | NodeConfig<Options, Storage> | MarkConfig<Options, Storage> | ExtendableConfig<Options, Storage> = ExtendableConfig<Options, Storage, any, any>, PMType = any> {
    /**
     * The extension name - this must be unique.
     * It will be used to identify the extension.
     *
     * @example 'myExtension'
     */
    name: string;
    /**
     * The priority of your extension. The higher, the earlier it will be called
     * and will take precedence over other extensions with a lower priority.
     * @default 100
     * @example 101
     */
    priority?: number;
    /**
     * This method will add options to this extension
     * @see https://tiptap.dev/docs/editor/guide/custom-extensions#settings
     * @example
     * addOptions() {
     *  return {
     *    myOption: 'foo',
     *    myOtherOption: 10,
     * }
     */
    addOptions?: (this: {
        name: string;
        parent: ParentConfig<Config>['addOptions'];
    }) => Options;
    /**
     * The default storage this extension can save data to.
     * @see https://tiptap.dev/docs/editor/guide/custom-extensions#storage
     * @example
     * defaultStorage: {
     *   prefetchedUsers: [],
     *   loading: false,
     * }
     */
    addStorage?: (this: {
        name: string;
        options: Options;
        parent: ParentConfig<Config>['addStorage'];
    }) => Storage;
    /**
     * This function adds globalAttributes to specific nodes.
     * @see https://tiptap.dev/docs/editor/guide/custom-extensions#global-attributes
     * @example
     * addGlobalAttributes() {
     *   return [
     *     {
             // Extend the following extensions
     *       types: [
     *         'heading',
     *         'paragraph',
     *       ],
     *       // … with those attributes
     *       attributes: {
     *         textAlign: {
     *           default: 'left',
     *           renderHTML: attributes => ({
     *             style: `text-align: ${attributes.textAlign}`,
     *           }),
     *           parseHTML: element => element.style.textAlign || 'left',
     *         },
     *       },
     *     },
     *   ]
     * }
     */
    addGlobalAttributes?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        extensions: (Node | Mark)[];
        parent: ParentConfig<Config>['addGlobalAttributes'];
    }) => GlobalAttributes;
    /**
     * This function adds commands to the editor
     * @see https://tiptap.dev/docs/editor/guide/custom-extensions#commands
     * @example
     * addCommands() {
     *   return {
     *     myCommand: () => ({ chain }) => chain().setMark('type', 'foo').run(),
     *   }
     * }
     */
    addCommands?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['addCommands'];
    }) => Partial<RawCommands>;
    /**
     * This function registers keyboard shortcuts.
     * @see https://tiptap.dev/docs/editor/guide/custom-extensions#keyboard-shortcuts
     * @example
     * addKeyboardShortcuts() {
     *   return {
     *     'Mod-l': () => this.editor.commands.toggleBulletList(),
     *   }
     * },
     */
    addKeyboardShortcuts?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['addKeyboardShortcuts'];
    }) => {
        [key: string]: KeyboardShortcutCommand;
    };
    /**
     * This function adds input rules to the editor.
     * @see https://tiptap.dev/docs/editor/guide/custom-extensions#input-rules
     * @example
     * addInputRules() {
     *   return [
     *     markInputRule({
     *       find: inputRegex,
     *       type: this.type,
     *     }),
     *   ]
     * },
     */
    addInputRules?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['addInputRules'];
    }) => InputRule[];
    /**
     * This function adds paste rules to the editor.
     * @see https://tiptap.dev/docs/editor/guide/custom-extensions#paste-rules
     * @example
     * addPasteRules() {
     *   return [
     *     markPasteRule({
     *       find: pasteRegex,
     *       type: this.type,
     *     }),
     *   ]
     * },
     */
    addPasteRules?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['addPasteRules'];
    }) => PasteRule[];
    /**
     * This function adds Prosemirror plugins to the editor
     * @see https://tiptap.dev/docs/editor/guide/custom-extensions#prosemirror-plugins
     * @example
     * addProseMirrorPlugins() {
     *   return [
     *     customPlugin(),
     *   ]
     * }
     */
    addProseMirrorPlugins?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['addProseMirrorPlugins'];
    }) => Plugin[];
    /**
     * This function transforms pasted HTML content before it's parsed.
     * Extensions can use this to modify or clean up pasted HTML.
     * The transformations are chained - each extension's transform receives
     * the output from the previous extension's transform.
     * @see https://tiptap.dev/docs/editor/guide/custom-extensions#transform-pasted-html
     * @example
     * transformPastedHTML(html) {
     *   // Remove all style attributes
     *   return html.replace(/style="[^"]*"/g, '')
     * }
     */
    transformPastedHTML?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['transformPastedHTML'];
    }, html: string) => string;
    /**
     * This function adds additional extensions to the editor. This is useful for
     * building extension kits.
     * @example
     * addExtensions() {
     *   return [
     *     BulletList,
     *     OrderedList,
     *     ListItem
     *   ]
     * }
     */
    addExtensions?: (this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<Config>['addExtensions'];
    }) => Extensions;
    /**
     * The markdown token name
     *
     * This is the name of the token that this extension uses to parse and render markdown and comes from the Marked Lexer.
     *
     * @see https://github.com/markedjs/marked/blob/master/src/Tokens.ts
     *
     */
    markdownTokenName?: string;
    /**
     * The parse function used by the markdown parser to convert markdown tokens to ProseMirror nodes.
     */
    parseMarkdown?: (token: MarkdownToken, helpers: MarkdownParseHelpers) => MarkdownParseResult;
    /**
     * The serializer function used by the markdown serializer to convert ProseMirror nodes to markdown tokens.
     */
    renderMarkdown?: (node: JSONContent, helpers: MarkdownRendererHelpers, ctx: RenderContext) => string;
    /**
     * The markdown tokenizer responsible for turning a markdown string into tokens
     *
     * Custom tokenizers are only needed when you want to parse non-standard markdown token.
     */
    markdownTokenizer?: MarkdownTokenizer;
    /**
     * Optional markdown options for indentation
     */
    markdownOptions?: {
        /**
         * Defines if this markdown element should indent it's child elements
         */
        indentsContent?: boolean;
        /**
         * Lets a mark tell the Markdown serializer which inline HTML tags it can
         * safely use when plain markdown delimiters would become ambiguous.
         *
         * This is mainly useful for overlapping marks. For example, bold followed
         * by bold+italic followed by italic cannot always be written back with only
         * `*` and `**` in a way that still parses correctly. In that case, the
         * serializer can close the overlapping section with markdown and reopen the
         * remaining tail with HTML instead.
         *
         * Example:
         * - desired formatting: `**123` + `*456*` + `789 italic`
         * - serialized result: `**123*456***<em>789</em>`
         *
         * If your extension defines custom mark names, set `htmlReopen` on that
         * extension so the serializer can reuse its HTML form for overlap cases.
         */
        htmlReopen?: {
            open: string;
            close: string;
        };
    };
    /**
     * This function extends the schema of the node.
     * @example
     * extendNodeSchema() {
     *   return {
     *     group: 'inline',
     *     selectable: false,
     *   }
     * }
     */
    extendNodeSchema?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<Config>['extendNodeSchema'];
    }, extension: Node) => Record<string, any>) | null;
    /**
     * This function extends the schema of the mark.
     * @example
     * extendMarkSchema() {
     *   return {
     *     group: 'inline',
     *     selectable: false,
     *   }
     * }
     */
    extendMarkSchema?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        parent: ParentConfig<Config>['extendMarkSchema'];
    }, extension: Mark) => Record<string, any>) | null;
    /**
     * The editor is not ready yet.
     */
    onBeforeCreate?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['onBeforeCreate'];
    }, event: EditorEvents['beforeCreate']) => void) | null;
    /**
     * The editor is ready.
     */
    onCreate?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['onCreate'];
    }, event: EditorEvents['create']) => void) | null;
    /**
     * The content has changed.
     */
    onUpdate?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['onUpdate'];
    }, event: EditorEvents['update']) => void) | null;
    /**
     * The selection has changed.
     */
    onSelectionUpdate?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['onSelectionUpdate'];
    }, event: EditorEvents['selectionUpdate']) => void) | null;
    /**
     * The editor state has changed.
     */
    onTransaction?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['onTransaction'];
    }, event: EditorEvents['transaction']) => void) | null;
    /**
     * The editor is focused.
     */
    onFocus?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['onFocus'];
    }, event: EditorEvents['focus']) => void) | null;
    /**
     * The editor isn’t focused anymore.
     */
    onBlur?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['onBlur'];
    }, event: EditorEvents['blur']) => void) | null;
    /**
     * The editor is destroyed.
     */
    onDestroy?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['onDestroy'];
    }, event: EditorEvents['destroy']) => void) | null;
    /**
     * This hook allows you to intercept and modify transactions before they are dispatched.
     *
     * Example
     * ```ts
     * dispatchTransaction({ transaction, next }) {
     *   console.log('Dispatching transaction:', transaction)
     *   next(transaction)
     * }
     * ```
     *
     * @param props - The dispatch transaction props
     */
    dispatchTransaction?: ((this: {
        name: string;
        options: Options;
        storage: Storage;
        editor: Editor;
        type: PMType;
        parent: ParentConfig<Config>['dispatchTransaction'];
    }, props: DispatchTransactionProps) => void) | null;
}
declare class Extendable<Options = any, Storage = any, Config = ExtensionConfig<Options, Storage> | NodeConfig<Options, Storage> | MarkConfig<Options, Storage>> {
    type: string;
    parent: Extendable | null;
    child: Extendable | null;
    name: string;
    config: Config;
    constructor(config?: Partial<Config>);
    get options(): Options;
    get storage(): Readonly<Storage>;
    configure(options?: Partial<Options>): Extendable<Options, Storage, ExtensionConfig<Options, Storage> | NodeConfig<Options, Storage> | MarkConfig<Options, Storage>>;
    extend<ExtendedOptions = Options, ExtendedStorage = Storage, ExtendedConfig = ExtensionConfig<ExtendedOptions, ExtendedStorage> | NodeConfig<ExtendedOptions, ExtendedStorage> | MarkConfig<ExtendedOptions, ExtendedStorage>>(extendedConfig?: Partial<ExtendedConfig>): Extendable<ExtendedOptions, ExtendedStorage>;
}

interface ExtensionConfig<Options = any, Storage = any> extends ExtendableConfig<Options, Storage, ExtensionConfig<Options, Storage>, null> {
}
/**
 * The Extension class is the base class for all extensions.
 * @see https://tiptap.dev/api/extensions#create-a-new-extension
 */
declare class Extension<Options = any, Storage = any> extends Extendable<Options, Storage, ExtensionConfig<Options, Storage>> {
    type: string;
    /**
     * Create a new Extension instance
     * @param config - Extension configuration object or a function that returns a configuration object
     */
    static create<O = any, S = any>(config?: Partial<ExtensionConfig<O, S>> | (() => Partial<ExtensionConfig<O, S>>)): Extension<O, S>;
    configure(options?: Partial<Options>): Extension<Options, Storage>;
    extend<ExtendedOptions = Options, ExtendedStorage = Storage, ExtendedConfig = ExtensionConfig<ExtendedOptions, ExtendedStorage>>(extendedConfig?: (() => Partial<ExtendedConfig>) | (Partial<ExtendedConfig> & ThisType<{
        name: string;
        options: ExtendedOptions;
        storage: ExtendedStorage;
        editor: Editor;
        type: null;
    }>)): Extension<ExtendedOptions, ExtendedStorage>;
}

/**
 * A class that represents a mappable position in the editor. It can be extended
 * by other extensions to add additional position mapping capabilities.
 */
declare class MappablePosition {
    /**
     * The absolute position in the editor.
     */
    position: number;
    constructor(position: number);
    /**
     * Creates a MappablePosition from a JSON object.
     */
    static fromJSON(json: any): MappablePosition;
    /**
     * Converts the MappablePosition to a JSON object.
     */
    toJSON(): any;
}
/**
 * The result of the getUpdatedPosition function.
 */
interface GetUpdatedPositionResult {
    position: MappablePosition;
    mapResult: MapResult | null;
}
/**
 * Calculates the new position after applying a transaction.
 *
 * @returns The new mappable position and the map result.
 */
declare function getUpdatedPosition(position: MappablePosition, transaction: Transaction): GetUpdatedPositionResult;
/**
 * Creates a MappablePosition from a position number. This is the default
 * implementation for Tiptap core. It can be overridden by other Tiptap
 * extensions.
 *
 * @param position The position (as a number) where the MappablePosition will be created.
 * @returns A new MappablePosition instance at the given position.
 */
declare function createMappablePosition(position: number): MappablePosition;

type AnyConfig = ExtensionConfig | NodeConfig | MarkConfig;
type AnyExtension = Extendable;
type Extensions = AnyExtension[];
type ParentConfig<T> = Partial<{
    [P in keyof T]: Required<T>[P] extends (...args: any) => any ? (...args: Parameters<Required<T>[P]>) => ReturnType<Required<T>[P]> : T[P];
}>;
type Primitive = null | undefined | string | number | boolean | symbol | bigint;
type RemoveThis<T> = T extends (...args: any) => any ? (...args: Parameters<T>) => ReturnType<T> : T;
type MaybeReturnType<T> = T extends (...args: any) => any ? ReturnType<T> : T;
type MaybeThisParameterType<T> = Exclude<T, Primitive> extends (...args: any) => any ? ThisParameterType<Exclude<T, Primitive>> : any;
interface EditorEvents {
    mount: {
        /**
         * The editor instance
         */
        editor: Editor;
    };
    unmount: {
        /**
         * The editor instance
         */
        editor: Editor;
    };
    beforeCreate: {
        /**
         * The editor instance
         */
        editor: Editor;
    };
    create: {
        /**
         * The editor instance
         */
        editor: Editor;
    };
    contentError: {
        /**
         * The editor instance
         */
        editor: Editor;
        /**
         * The error that occurred while parsing the content
         */
        error: Error;
        /**
         * If called, will re-initialize the editor with the collaboration extension removed.
         * This will prevent syncing back deletions of content not present in the current schema.
         */
        disableCollaboration: () => void;
    };
    update: {
        /**
         * The editor instance
         */
        editor: Editor;
        /**
         * The transaction that caused the update
         */
        transaction: Transaction;
        /**
         * Appended transactions that were added to the initial transaction by plugins
         */
        appendedTransactions: Transaction[];
    };
    selectionUpdate: {
        /**
         * The editor instance
         */
        editor: Editor;
        /**
         * The transaction that caused the selection update
         */
        transaction: Transaction;
    };
    beforeTransaction: {
        /**
         * The editor instance
         */
        editor: Editor;
        /**
         * The transaction that will be applied
         */
        transaction: Transaction;
        /**
         * The next state of the editor after the transaction is applied
         */
        nextState: EditorState;
    };
    transaction: {
        /**
         * The editor instance
         */
        editor: Editor;
        /**
         * The initial transaction
         */
        transaction: Transaction;
        /**
         * Appended transactions that were added to the initial transaction by plugins
         */
        appendedTransactions: Transaction[];
    };
    focus: {
        /**
         * The editor instance
         */
        editor: Editor;
        /**
         * The focus event
         */
        event: FocusEvent;
        /**
         * The transaction that caused the focus
         */
        transaction: Transaction;
    };
    blur: {
        /**
         * The editor instance
         */
        editor: Editor;
        /**
         * The focus event
         */
        event: FocusEvent;
        /**
         * The transaction that caused the blur
         */
        transaction: Transaction;
    };
    destroy: void;
    paste: {
        /**
         * The editor instance
         */
        editor: Editor;
        /**
         * The clipboard event
         */
        event: ClipboardEvent;
        /**
         * The slice that was pasted
         */
        slice: Slice;
    };
    drop: {
        /**
         * The editor instance
         */
        editor: Editor;
        /**
         * The drag event
         */
        event: DragEvent;
        /**
         * The slice that was dropped
         */
        slice: Slice;
        /**
         * Whether the content was moved (true) or copied (false)
         */
        moved: boolean;
    };
    delete: {
        /**
         * The editor instance
         */
        editor: Editor;
        /**
         * The range of the deleted content (before the deletion)
         */
        deletedRange: Range;
        /**
         * The new range of positions of where the deleted content was in the new document (after the deletion)
         */
        newRange: Range;
        /**
         * The transaction that caused the deletion
         */
        transaction: Transaction;
        /**
         * The combined transform (including all appended transactions) that caused the deletion
         */
        combinedTransform: Transform;
        /**
         * Whether the deletion was partial (only a part of this content was deleted)
         */
        partial: boolean;
        /**
         * This is the start position of the mark in the document (before the deletion)
         */
        from: number;
        /**
         * This is the end position of the mark in the document (before the deletion)
         */
        to: number;
    } & ({
        /**
         * The content that was deleted
         */
        type: 'node';
        /**
         * The node which the deletion occurred in
         * @note This can be a parent node of the deleted content
         */
        node: Node$1;
        /**
         * The new start position of the node in the document (after the deletion)
         */
        newFrom: number;
        /**
         * The new end position of the node in the document (after the deletion)
         */
        newTo: number;
    } | {
        /**
         * The content that was deleted
         */
        type: 'mark';
        /**
         * The mark that was deleted
         */
        mark: Mark$1;
    });
}
/**
 * Props passed to the `dispatchTransaction` hook in extensions.
 */
type DispatchTransactionProps = {
    /**
     * The transaction that is about to be dispatched.
     */
    transaction: Transaction;
    /**
     * A function that should be called to pass the transaction down to the next extension
     * (or eventually to the editor).
     *
     * @param transaction The transaction to dispatch
     */
    next: (transaction: Transaction) => void;
};
type EnableRules = (AnyExtension | string)[] | boolean;
interface EditorOptions {
    /**
     * The element to bind the editor to:
     * - If an `Element` is passed, the editor will be mounted appended to that element
     * - If `null` is passed, the editor will not be mounted automatically
     * - If an object with a `mount` property is passed, the editor will be mounted to that element
     * - If a function is passed, it will be called with the editor's element, which should place the editor within the document
     */
    element: Element | {
        mount: HTMLElement;
    } | ((editor: HTMLElement) => void) | null;
    /**
     * The content of the editor (HTML, JSON, or a JSON array)
     */
    content: Content;
    /**
     * The extensions to use
     */
    extensions: Extensions;
    /**
     * Whether to inject base CSS styles
     */
    injectCSS: boolean;
    /**
     * A nonce to use for CSP while injecting styles
     */
    injectNonce: string | undefined;
    /**
     * The editor's initial focus position
     */
    autofocus: FocusPosition;
    /**
     * Whether the editor is editable
     */
    editable: boolean;
    /**
     * The default text direction for all content in the editor.
     * When set to 'ltr' or 'rtl', all nodes will have the corresponding dir attribute.
     * When set to 'auto', the dir attribute will be set based on content detection.
     * When undefined, no dir attribute will be added.
     * @default undefined
     */
    textDirection?: 'ltr' | 'rtl' | 'auto';
    /**
     * The editor's props
     */
    editorProps: EditorProps;
    /**
     * The editor's content parser options
     */
    parseOptions: ParseOptions;
    /**
     * The editor's core extension options
     */
    coreExtensionOptions?: {
        clipboardTextSerializer?: {
            blockSeparator?: string;
        };
        /**
         * Options for the `tabindex` core extension.
         */
        tabindex?: {
            /**
             * The value for the `tabindex` attribute on the editor element.
             */
            value?: string;
        };
        delete?: {
            /**
             * Whether the `delete` extension should be called asynchronously to avoid blocking the editor while processing deletions
             * @default true deletion events are called asynchronously
             */
            async?: boolean;
            /**
             * Allows filtering the transactions that are processed by the `delete` extension.
             * If the function returns `true`, the transaction will be ignored.
             */
            filterTransaction?: (transaction: Transaction) => boolean;
        };
    };
    /**
     * Whether to enable input rules behavior
     */
    enableInputRules: EnableRules;
    /**
     * Whether to enable paste rules behavior
     */
    enablePasteRules: EnableRules;
    /**
     * Determines whether core extensions are enabled.
     *
     * If set to `false`, all core extensions will be disabled.
     * To disable specific core extensions, provide an object where the keys are the extension names and the values are `false`.
     * Extensions not listed in the object will remain enabled.
     *
     * @example
     * // Disable all core extensions
     * enabledCoreExtensions: false
     *
     * @example
     * // Disable only the keymap core extension
     * enabledCoreExtensions: { keymap: false }
     *
     * @default true
     */
    enableCoreExtensions?: boolean | Partial<Record<'editable' | 'clipboardTextSerializer' | 'commands' | 'focusEvents' | 'keymap' | 'tabindex' | 'drop' | 'paste' | 'delete' | 'textDirection', false>>;
    /**
     * If `true`, the editor will check the content for errors on initialization.
     * Emitting the `contentError` event if the content is invalid.
     * Which can be used to show a warning or error message to the user.
     * @default false
     */
    enableContentCheck: boolean;
    /**
     * If `true`, the editor will emit the `contentError` event if invalid content is
     * encountered but `enableContentCheck` is `false`. This lets you preserve the
     * invalid editor content while still showing a warning or error message to
     * the user.
     *
     * @default false
     */
    emitContentError: boolean;
    /**
     * Called before the editor is constructed.
     */
    onBeforeCreate: (props: EditorEvents['beforeCreate']) => void;
    /**
     * Called after the editor is constructed.
     */
    onCreate: (props: EditorEvents['create']) => void;
    /**
     * Called when the editor is mounted.
     */
    onMount: (props: EditorEvents['mount']) => void;
    /**
     * Called when the editor is unmounted.
     */
    onUnmount: (props: EditorEvents['unmount']) => void;
    /**
     * Called when the editor encounters an error while parsing the content.
     * Only enabled if `enableContentCheck` is `true`.
     */
    onContentError: (props: EditorEvents['contentError']) => void;
    /**
     * Called when the editor's content is updated.
     */
    onUpdate: (props: EditorEvents['update']) => void;
    /**
     * Called when the editor's selection is updated.
     */
    onSelectionUpdate: (props: EditorEvents['selectionUpdate']) => void;
    /**
     * Called after a transaction is applied to the editor.
     */
    onTransaction: (props: EditorEvents['transaction']) => void;
    /**
     * Called on focus events.
     */
    onFocus: (props: EditorEvents['focus']) => void;
    /**
     * Called on blur events.
     */
    onBlur: (props: EditorEvents['blur']) => void;
    /**
     * Called when the editor is destroyed.
     */
    onDestroy: (props: EditorEvents['destroy']) => void;
    /**
     * Called when content is pasted into the editor.
     */
    onPaste: (e: ClipboardEvent, slice: Slice) => void;
    /**
     * Called when content is dropped into the editor.
     */
    onDrop: (e: DragEvent, slice: Slice, moved: boolean) => void;
    /**
     * Called when content is deleted from the editor.
     */
    onDelete: (props: EditorEvents['delete']) => void;
    /**
     * Whether to enable extension-level dispatching of transactions.
     * If `false`, extensions cannot define their own `dispatchTransaction` hook.
     *
     * @default true
     * @example
     * new Editor({
     *   enableExtensionDispatchTransaction: false,
     * })
     */
    enableExtensionDispatchTransaction?: boolean;
}
/**
 * The editor's content as HTML
 */
type HTMLContent = string;
/**
 * A Tiptap JSON node or document. Tiptap JSON is the standard format for
 * storing and manipulating Tiptap content. It is equivalent to the JSON
 * representation of a Prosemirror node.
 *
 * Tiptap JSON documents are trees of nodes. The root node is usually of type
 * `doc`. Nodes can have other nodes as children. Nodes can also have marks and
 * attributes. Text nodes (nodes with type `text`) have a `text` property and no
 * children.
 *
 * @example
 * ```ts
 * const content: JSONContent = {
 *   type: 'doc',
 *   content: [
 *     {
 *       type: 'paragraph',
 *       content: [
 *         {
 *           type: 'text',
 *           text: 'Hello ',
 *         },
 *         {
 *           type: 'text',
 *           text: 'world',
 *           marks: [{ type: 'bold' }],
 *         },
 *       ],
 *     },
 *   ],
 * }
 * ```
 */
type JSONContent = {
    /**
     * The type of the node
     */
    type?: string;
    /**
     * The attributes of the node. Attributes can have any JSON-serializable value.
     */
    attrs?: Record<string, any> | undefined;
    /**
     * The children of the node. A node can have other nodes as children.
     */
    content?: JSONContent[];
    /**
     * A list of marks of the node. Inline nodes can have marks.
     */
    marks?: {
        /**
         * The type of the mark
         */
        type: string;
        /**
         * The attributes of the mark. Attributes can have any JSON-serializable value.
         */
        attrs?: Record<string, any>;
        [key: string]: any;
    }[];
    /**
     * The text content of the node. This property is only present on text nodes
     * (i.e. nodes with `type: 'text'`).
     *
     * Text nodes cannot have children, but they can have marks.
     */
    text?: string;
    [key: string]: any;
};
/**
 * A mark type is either a JSON representation of a mark or a Prosemirror mark instance
 */
type MarkType<Type extends string | {
    name: string;
} = any, TAttributes extends undefined | Record<string, any> = any> = {
    type: Type;
    attrs: TAttributes;
};
/**
 * A node type is either a JSON representation of a node or a Prosemirror node instance
 */
type NodeType<Type extends string | {
    name: string;
} = any, TAttributes extends undefined | Record<string, any> = any, NodeMarkType extends MarkType = any, TContent extends (NodeType | TextType)[] = any> = {
    type: Type;
    attrs: TAttributes;
    content?: TContent;
    marks?: NodeMarkType[];
};
/**
 * A node type is either a JSON representation of a doc node or a Prosemirror doc node instance
 */
type DocumentType<TDocAttributes extends Record<string, any> | undefined = Record<string, any>, TContentType extends NodeType[] = NodeType[]> = Omit<NodeType<'doc', TDocAttributes, never, TContentType>, 'marks' | 'content'> & {
    content: TContentType;
};
/**
 * A node type is either a JSON representation of a text node or a Prosemirror text node instance
 */
type TextType<TMarkType extends MarkType = MarkType> = {
    type: 'text';
    text: string;
    marks: TMarkType[];
};
/**
 * Describes the output of a `renderHTML` function in prosemirror
 * @see https://prosemirror.net/docs/ref/#model.DOMOutputSpec
 */
type DOMOutputSpecArray$1 = [string] | [string, Record<string, any>] | [string, 0] | [string, Record<string, any>, 0] | [string, Record<string, any>, DOMOutputSpecArray$1 | 0] | [string, DOMOutputSpecArray$1];
type Content = HTMLContent | JSONContent | JSONContent[] | null;
type CommandProps = {
    editor: Editor;
    tr: Transaction;
    commands: SingleCommands;
    can: () => CanCommands;
    chain: () => ChainedCommands;
    state: EditorState;
    view: EditorView;
    dispatch: ((args?: any) => any) | undefined;
};
type Command = (props: CommandProps) => boolean;
type CommandSpec = (...args: any[]) => Command;
type KeyboardShortcutCommand = (props: {
    editor: Editor;
}) => boolean;
type Attribute = {
    default?: any;
    validate?: string | ((value: any) => void);
    rendered?: boolean;
    renderHTML?: ((attributes: Record<string, any>) => Record<string, any> | null) | null;
    parseHTML?: ((element: HTMLElement) => any | null) | null;
    keepOnSplit?: boolean;
    isRequired?: boolean;
};
type Attributes$1 = {
    [key: string]: Attribute;
};
type ExtensionAttribute = {
    type: string;
    name: string;
    attribute: Required<Omit<Attribute, 'validate'>> & Pick<Attribute, 'validate'>;
};
type GlobalAttributes = {
    /**
     * The node & mark types this attribute should be applied to.
     * Can be a specific array of type names, or a shorthand string:
     * - `'*'` applies to all nodes (excluding text) and all marks
     * - `'nodes'` applies to all nodes (excluding the built-in text node)
     * - `'marks'` applies to all marks
     * - `string[]` applies to specific node/mark types by name
     * @example
     * types: '*'                                    // All nodes and marks
     * types: 'nodes'                                // All nodes
     * types: 'marks'                                // All marks
     * types: ['heading', 'paragraph']               // Specific types
     */
    types: string[] | 'nodes' | 'marks' | '*';
    /**
     * The attributes to add to the node or mark types.
     */
    attributes: Record<string, Attribute | undefined>;
}[];
type PickValue<T, K extends keyof T> = T[K];
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
type Diff<T extends keyof any, U extends keyof any> = ({
    [P in T]: P;
} & {
    [P in U]: never;
} & {
    [x: string]: never;
})[T];
type Overwrite<T, U> = Pick<T, Diff<keyof T, keyof U>> & U;
type ValuesOf<T> = T[keyof T];
type KeysWithTypeOf<T, Type> = {
    [P in keyof T]: T[P] extends Type ? P : never;
}[keyof T];
type DOMNode = InstanceType<typeof window.Node>;
/**
 * prosemirror-view does not export the `type` property of `Decoration`.
 * So, this defines the `DecorationType` interface to include the `type` property.
 */
interface DecorationType {
    spec: any;
    map(mapping: Mappable, span: Decoration, offset: number, oldOffset: number): Decoration | null;
    valid(node: Node, span: Decoration): boolean;
    eq(other: DecorationType): boolean;
    destroy(dom: DOMNode): void;
    readonly attrs: DecorationAttrs;
}
/**
 * prosemirror-view does not export the `type` property of `Decoration`.
 * This adds the `type` property to the `Decoration` type.
 */
type DecorationWithType = Decoration & {
    type: DecorationType;
};
interface NodeViewProps extends NodeViewRendererProps {
    decorations: readonly DecorationWithType[];
    selected: boolean;
    updateAttributes: (attributes: Record<string, any>) => void;
    deleteNode: () => void;
}
interface NodeViewRendererOptions {
    stopEvent: ((props: {
        event: Event;
    }) => boolean) | null;
    ignoreMutation: ((props: {
        mutation: ViewMutationRecord;
    }) => boolean) | null;
    contentDOMElementTag: string;
    /**
     * When `true`, the `selected` prop also becomes `true` if a `TextSelection`
     * is fully inside the node's range (e.g. the cursor is placed within the
     * node's content), not only when there is a `NodeSelection` on the node.
     * Defaults to `false` to preserve existing behavior.
     */
    selectedOnTextSelection?: boolean;
    /**
     * When `true`, the component re-renders on every position shift so calls
     * to `getPos()` stay current in render output.
     * Without this option, `getPos()` is still always current for imperative
     * use (click handlers, commands) — it only becomes stale when directly
     * rendered in JSX or used in reactive template expressions.
     * @default false
     */
    trackNodeViewPosition?: boolean;
}
interface NodeViewRendererProps {
    /**
     * The node that is being rendered.
     */
    node: Parameters<NodeViewConstructor>[0];
    /**
     * The editor's view.
     */
    view: Parameters<NodeViewConstructor>[1];
    /**
     * A function that can be called to get the node's current position in the document.
     */
    getPos: Parameters<NodeViewConstructor>[2];
    /**
     * is an array of node or inline decorations that are active around the node.
     * They are automatically drawn in the normal way, and you will usually just want to ignore this, but they can also be used as a way to provide context information to the node view without adding it to the document itself.
     */
    decorations: Parameters<NodeViewConstructor>[3];
    /**
     * holds the decorations for the node's content. You can safely ignore this if your view has no content or a contentDOM property, since the editor will draw the decorations on the content.
     * But if you, for example, want to create a nested editor with the content, it may make sense to provide it with the inner decorations.
     */
    innerDecorations: Parameters<NodeViewConstructor>[4];
    /**
     * The editor instance.
     */
    editor: Editor;
    /**
     * The extension that is responsible for the node.
     */
    extension: Node;
    /**
     * The HTML attributes that should be added to the node's DOM element.
     */
    HTMLAttributes: Record<string, any>;
}
type NodeViewRenderer = (props: NodeViewRendererProps) => NodeView$1;
interface MarkViewProps extends MarkViewRendererProps {
}
interface MarkViewRendererProps {
    /**
     * The node that is being rendered.
     */
    mark: Parameters<MarkViewConstructor>[0];
    /**
     * The editor's view.
     */
    view: Parameters<MarkViewConstructor>[1];
    /**
     * indicates whether the mark's content is inline
     */
    inline: Parameters<MarkViewConstructor>[2];
    /**
     * The editor instance.
     */
    editor: Editor;
    /**
     * The extension that is responsible for the mark.
     */
    extension: Mark;
    /**
     * The HTML attributes that should be added to the mark's DOM element.
     */
    HTMLAttributes: Record<string, any>;
    updateAttributes: (attrs: Record<string, any>) => void;
}
type MarkViewRenderer<Props = MarkViewRendererProps> = (props: Props) => MarkView$1;
interface MarkViewRendererOptions {
    ignoreMutation: ((props: {
        mutation: ViewMutationRecord;
    }) => boolean) | null;
}
type AnyCommands = Record<string, (...args: any[]) => Command>;
type UnionCommands<T = Command> = UnionToIntersection<ValuesOf<Pick<Commands$1<T>, KeysWithTypeOf<Commands$1<T>, object>>>>;
type RawCommands = {
    [Item in keyof UnionCommands]: UnionCommands<Command>[Item];
};
type SingleCommands = {
    [Item in keyof UnionCommands]: UnionCommands<boolean>[Item];
};
type ChainedCommands = {
    [Item in keyof UnionCommands]: UnionCommands<ChainedCommands>[Item];
} & {
    run: () => boolean;
};
type CanCommands = SingleCommands & {
    chain: () => ChainedCommands;
};
type FocusPosition = 'start' | 'end' | 'all' | number | boolean | null;
type Range = {
    from: number;
    to: number;
};
type NodeRange = {
    node: Node$1;
    from: number;
    to: number;
};
type MarkRange = {
    mark: Mark$1;
    from: number;
    to: number;
};
type Predicate = (node: Node$1) => boolean;
type NodeWithPos = {
    node: Node$1;
    pos: number;
};
type TextSerializer = (props: {
    node: Node$1;
    pos: number;
    parent: Node$1;
    index: number;
    range: Range;
}) => string;
type ExtendedRegExpMatchArray = RegExpMatchArray & {
    data?: Record<string, any>;
};
type Dispatch = ((args?: any) => any) | undefined;
/** Markdown related types */
type MarkdownToken = {
    type?: string;
    raw?: string;
    text?: string;
    tokens?: MarkdownToken[];
    depth?: number;
    items?: MarkdownToken[];
    [key: string]: any;
};
type MarkdownHelpers = {
    parseInline: (tokens: MarkdownToken[]) => any[];
    /**
     * Render children. The second argument may be a legacy separator string
     * or a RenderContext (preferred).
     */
    renderChildren: (node: Node[] | Node, ctxOrSeparator?: RenderContext | string) => string;
    text: (token: MarkdownToken) => any;
};
/**
 * Helpers specifically for parsing markdown tokens into Tiptap JSON.
 * These are provided to extension parse handlers.
 */
type MarkdownParseHelpers = {
    /** Parse an array of inline tokens into text nodes with marks */
    parseInline: (tokens: MarkdownToken[]) => JSONContent[];
    /** Tokenize source text as inline markdown when supported by the markdown parser */
    tokenizeInline?: (src: string) => MarkdownToken[];
    /** Parse an array of block-level tokens */
    parseChildren: (tokens: MarkdownToken[]) => JSONContent[];
    /** Parse block-level tokens while preserving implicit empty paragraphs from blank lines */
    parseBlockChildren?: (tokens: MarkdownToken[]) => JSONContent[];
    /** Create a text node with optional marks */
    createTextNode: (text: string, marks?: Array<{
        type: string;
        attrs?: any;
    }>) => JSONContent;
    /** Create any node type with attributes and content */
    createNode: (type: string, attrs?: any, content?: JSONContent[]) => JSONContent;
    /** Apply a mark to content (used for inline marks like bold, italic) */
    applyMark: (markType: string, content: JSONContent[], attrs?: any) => {
        mark: string;
        content: JSONContent[];
        attrs?: any;
    };
};
/**
 * Full runtime helpers object provided by MarkdownManager to handlers.
 * This includes the small author-facing helpers plus internal helpers
 * that can be useful for advanced handlers.
 */
type FullMarkdownHelpers = MarkdownHelpers & {
    parseChildren: (tokens: MarkdownToken[]) => any[];
    getExtension: (name: string) => any;
    createNode: (type: string, attrs?: any, content?: any[]) => any;
    /** Current render context when calling renderers; undefined during parse. */
    currentContext?: RenderContext;
    /** Indent a multi-line string according to the provided RenderContext. */
    indent: (text: string, ctx?: RenderContext) => string;
    /** Return the indent string for a given level (e.g. '  ' or '\t'). */
    getIndentString: (level?: number) => string;
};

/**
 * Return shape for parser-level `parse` handlers.
 * - a single JSON-like node
 * - an array of JSON-like nodes
 * - or a `{ mark: string, content: JSONLike[] }` shape to apply a mark
 */
type MarkdownParseResult = JSONContent | JSONContent[] | {
    mark: string;
    content: JSONContent[];
    attrs?: any;
};
type RenderContext = {
    index: number;
    level: number;
    meta?: Record<string, any>;
    parentType?: string | null;
    previousNode?: JSONContent | null;
};
/** Extension contract for markdown parsing/serialization. */
interface MarkdownExtensionSpec {
    /** Token name used for parsing (e.g., 'codespan', 'code', 'strong') */
    tokenName?: string;
    /** Node/mark name used for rendering (typically the extension name) */
    nodeName?: string;
    parseMarkdown?: (token: MarkdownToken, helpers: MarkdownParseHelpers) => MarkdownParseResult;
    renderMarkdown?: (node: any, helpers: MarkdownRendererHelpers, ctx: RenderContext) => string;
    isIndenting?: boolean;
    htmlReopen?: {
        open: string;
        close: string;
    };
    /** Custom tokenizer for marked.js to handle non-standard markdown syntax */
    tokenizer?: MarkdownTokenizer;
}
/**
 * Configuration object passed to custom marked.js tokenizers
 */
type MarkdownLexerConfiguration = {
    /**
     * Can be used to transform source text into inline tokens - useful while tokenizing child tokens.
     * @param src
     * @returns Array of inline tokens
     */
    inlineTokens: (src: string) => MarkdownToken[];
    /**
     * Can be used to transform source text into block-level tokens - useful while tokenizing child tokens.
     * @param src
     * @returns Array of block-level tokens
     */
    blockTokens: (src: string) => MarkdownToken[];
};
/** Custom tokenizer function for marked.js extensions */
type MarkdownTokenizer = {
    /** Token name this tokenizer creates */
    name: string;
    /** Priority level for tokenizer ordering (higher = earlier) */
    level?: 'block' | 'inline';
    /** A string to look for or a function that returns the start index of the token in the source string */
    start?: string | ((src: string) => number);
    /** Function that attempts to parse custom syntax from start of text */
    tokenize: (src: string, tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) => MarkdownToken | undefined | void;
};
type MarkdownRendererHelpers = {
    /**
     * Render children nodes to a markdown string, optionally separated by a string.
     * @param nodes The node or array of nodes to render
     * @param separator An optional separator string (legacy) or RenderContext
     * @returns The rendered markdown string
     */
    renderChildren: (nodes: JSONContent | JSONContent[], separator?: string) => string;
    /** Render a single child node with its sibling index preserved */
    renderChild?: (node: JSONContent, index: number) => string;
    /**
     * Render a text token to a markdown string
     * @param prefix The prefix to add before the content
     * @param content The content to wrap
     * @returns The wrapped content
     */
    wrapInBlock: (prefix: string, content: string) => string;
    /**
     * Indent a markdown string according to the provided RenderContext
     * @param content The content to indent
     * @returns The indented content
     */
    indent: (content: string) => string;
};
type Utils = {
    /**
     * Returns the new position after applying a transaction.
     *
     * @param position The position to update. A MappablePosition instance.
     * @param transaction The transaction to apply.
     * @returns The new position after applying the transaction.
     *
     * @example
     * const position = editor.utils.createMappablePosition(10)
     * const {position, mapResult} = editor.utils.getUpdatedPosition(position, transaction)
     */
    getUpdatedPosition: (position: MappablePosition, transaction: Transaction) => GetUpdatedPositionResult;
    /**
     * Creates a MappablePosition from a position number. A mappable position can be used to track the
     * next position after applying a transaction.
     *
     * @param position The position (as a number) where the MappablePosition will be created.
     * @returns A new MappablePosition instance at the given position.
     *
     * @example
     * const position = editor.utils.createMappablePosition(10)
     */
    createMappablePosition: (position: number) => MappablePosition;
};
interface Commands$1<ReturnType = any> {
}
interface Storage {
}

/**
 * Returns a new `Transform` based on all steps of the passed transactions.
 * @param oldDoc The Prosemirror node to start from
 * @param transactions The transactions to combine
 * @returns A new `Transform` with all steps of the passed transactions
 */
declare function combineTransactionSteps(oldDoc: Node$1, transactions: Transaction[]): Transform;

/**
 * Takes a Transaction & Editor State and turns it into a chainable state object
 * @param config The transaction and state to create the chainable state from
 * @returns A chainable Editor state object
 */
declare function createChainableState(config: {
    transaction: Transaction;
    state: EditorState;
}): EditorState;

/**
 * Create a new Prosemirror document node from content.
 * @param content The JSON or HTML content to create the document from
 * @param schema The Prosemirror schema to use for the document
 * @param parseOptions Options for the parser
 * @returns The created Prosemirror document node
 */
declare function createDocument(content: Content | Node$1 | Fragment$1, schema: Schema, parseOptions?: ParseOptions, options?: {
    errorOnInvalidContent?: boolean;
}): Node$1;

type CreateNodeFromContentOptions = {
    slice?: boolean;
    parseOptions?: ParseOptions;
    errorOnInvalidContent?: boolean;
};
/**
 * Takes a JSON or HTML content and creates a Prosemirror node or fragment from it.
 * @param content The JSON or HTML content to create the node from
 * @param schema The Prosemirror schema to use for the node
 * @param options Options for the parser
 * @returns The created Prosemirror node or fragment
 */
declare function createNodeFromContent(content: Content | Node$1 | Fragment$1, schema: Schema, options?: CreateNodeFromContentOptions): Node$1 | Fragment$1;

/**
 * Gets the default block type at a given match
 * @param match The content match to get the default block type from
 * @returns The default block type or null
 */
declare function defaultBlockAt(match: ContentMatch): NodeType$1 | null;

/**
 * Find children inside a Prosemirror node that match a predicate.
 * @param node The Prosemirror node to search in
 * @param predicate The predicate to match
 * @returns An array of nodes with their positions
 */
declare function findChildren(node: Node$1, predicate: Predicate): NodeWithPos[];

/**
 * Same as `findChildren` but searches only within a `range`.
 * @param node The Prosemirror node to search in
 * @param range The range to search in
 * @param predicate The predicate to match
 * @returns An array of nodes with their positions
 */
declare function findChildrenInRange(node: Node$1, range: Range, predicate: Predicate): NodeWithPos[];

/**
 * Finds the closest parent node to a resolved position that matches a predicate.
 * @param $pos The resolved position to search from
 * @param predicate The predicate to match
 * @returns The closest parent node to the resolved position that matches the predicate
 * @example ```js
 * findParentNodeClosestToPos($from, node => node.type.name === 'paragraph')
 * ```
 */
declare function findParentNodeClosestToPos($pos: ResolvedPos, predicate: Predicate): {
    pos: number;
    start: number;
    depth: number;
    node: Node$1;
} | undefined;

/**
 * Finds the closest parent node to the current selection that matches a predicate.
 * @param predicate The predicate to match
 * @returns A command that finds the closest parent node to the current selection that matches the predicate
 * @example ```js
 * findParentNode(node => node.type.name === 'paragraph')
 * ```
 */
declare function findParentNode(predicate: Predicate): (selection: Selection) => ReturnType<typeof findParentNodeClosestToPos>;

/**
 * Create a flattened array of extensions by traversing the `addExtensions` field.
 * @param extensions An array of Tiptap extensions
 * @returns A flattened array of Tiptap extensions
 */
declare function flattenExtensions(extensions: Extensions): Extensions;

/**
 * Generate HTML from a JSONContent
 * @param doc The JSONContent to generate HTML from
 * @param extensions The extensions to use for the schema
 * @returns The generated HTML
 */
declare function generateHTML(doc: JSONContent, extensions: Extensions): string;

/**
 * Generate JSONContent from HTML
 * @param html The HTML to generate JSONContent from
 * @param extensions The extensions to use for the schema
 * @returns The generated JSONContent
 */
declare function generateJSON(html: string, extensions: Extensions): Record<string, any>;

/**
 * Generate raw text from a JSONContent
 * @param doc The JSONContent to generate text from
 * @param extensions The extensions to use for the schema
 * @param options Options for the text generation f.e. blockSeparator or textSerializers
 * @returns The generated text
 */
declare function generateText(doc: JSONContent, extensions: Extensions, options?: {
    blockSeparator?: string;
    textSerializers?: Record<string, TextSerializer>;
}): string;

/**
 * Get node or mark attributes by type or name on the current editor state
 * @param state The current editor state
 * @param typeOrName The node or mark type or name
 * @returns The attributes of the node or mark or an empty object
 */
declare function getAttributes(state: EditorState, typeOrName: string | NodeType$1 | MarkType$1): Record<string, any>;

/**
 * Get a list of all extension attributes defined in `addAttribute` and `addGlobalAttribute`.
 * @param extensions List of extensions
 */
declare function getAttributesFromExtensions(extensions: Extensions): ExtensionAttribute[];

type ChangedRange = {
    oldRange: Range;
    newRange: Range;
};
/**
 * Returns a list of changed ranges
 * based on the first and last state of all steps.
 */
declare function getChangedRanges(transform: Transform): ChangedRange[];

interface DebugJSONContent extends JSONContent {
    from: number;
    to: number;
}
declare function getDebugJSON(node: Node$1, startOffset?: number): DebugJSONContent;

/**
 * Returns a field from an extension
 * @param extension The Tiptap extension
 * @param field The field, for example `renderHTML` or `priority`
 * @param context The context object that should be passed as `this` into the function
 * @returns The field value
 */
declare function getExtensionField<T = any, E extends AnyExtension = any>(extension: E, field: keyof ExtensionConfig | keyof MarkConfig | keyof NodeConfig, context?: Omit<MaybeThisParameterType<T>, 'parent'>): RemoveThis<T>;

declare function getHTMLFromFragment(fragment: Fragment$1, schema: Schema): string;

declare function getMarkAttributes(state: EditorState, typeOrName: string | MarkType$1): Record<string, any>;

/**
 * Get the range of a mark at a resolved position.
 */
declare function getMarkRange(
/**
 * The position to get the mark range for.
 */
$pos: ResolvedPos, 
/**
 * The mark type to get the range for.
 */
type: MarkType$1, 
/**
 * The attributes to match against.
 * If not provided, only the first mark at the position will be matched.
 */
attributes?: Record<string, any>): Range | void;

declare function getMarksBetween(from: number, to: number, doc: Node$1): MarkRange[];

declare function getMarkType(nameOrType: string | MarkType$1, schema: Schema): MarkType$1;

/**
 * Finds the first node of a given type or name in the current selection.
 * @param state The editor state.
 * @param typeOrName The node type or name.
 * @param pos The position to start searching from.
 * @param maxDepth The maximum depth to search.
 * @returns The node and the depth as an array.
 */
declare const getNodeAtPosition: (state: EditorState, typeOrName: string | NodeType$1, pos: number, maxDepth?: number) => [Node$1 | null, number];

declare function getNodeAttributes(state: EditorState, typeOrName: string | NodeType$1): Record<string, any>;

declare function getNodeType(nameOrType: string | NodeType$1, schema: Schema): NodeType$1;

declare function getRenderedAttributes(nodeOrMark: Node$1 | Mark$1, extensionAttributes: ExtensionAttribute[]): Record<string, any>;

declare function getSchema(extensions: Extensions, editor?: Editor): Schema;

/**
 * Creates a new Prosemirror schema based on the given extensions.
 * @param extensions An array of Tiptap extensions
 * @param editor The editor instance
 * @returns A Prosemirror schema
 */
declare function getSchemaByResolvedExtensions(extensions: Extensions, editor?: Editor): Schema;

/**
 * Tries to get a node or mark type by its name.
 * @param name The name of the node or mark type
 * @param schema The Prosemiror schema to search in
 * @returns The node or mark type, or null if it doesn't exist
 */
declare function getSchemaTypeByName(name: string, schema: Schema): NodeType$1 | MarkType$1 | null;

/**
 * Get the type of a schema item by its name.
 * @param name The name of the schema item
 * @param schema The Prosemiror schema to search in
 * @returns The type of the schema item (`node` or `mark`), or null if it doesn't exist
 */
declare function getSchemaTypeNameByName(name: string, schema: Schema): 'node' | 'mark' | null;

/**
 * Return attributes of an extension that should be splitted by keepOnSplit flag
 * @param extensionAttributes Array of extension attributes
 * @param typeName The type of the extension
 * @param attributes The attributes of the extension
 * @returns The splitted attributes
 */
declare function getSplittedAttributes(extensionAttributes: ExtensionAttribute[], typeName: string, attributes: Record<string, any>): Record<string, any>;

/**
 * Gets the text of a Prosemirror node
 * @param node The Prosemirror node
 * @param options Options for the text serializer & block separator
 * @returns The text of the node
 * @example ```js
 * const text = getText(node, { blockSeparator: '\n' })
 * ```
 */
declare function getText(node: Node$1, options?: {
    blockSeparator?: string;
    textSerializers?: Record<string, TextSerializer>;
}): string;

/**
 * Gets the text between two positions in a Prosemirror node
 * and serializes it using the given text serializers and block separator (see getText)
 * @param startNode The Prosemirror node to start from
 * @param range The range of the text to get
 * @param options Options for the text serializer & block separator
 * @returns The text between the two positions
 */
declare function getTextBetween(startNode: Node$1, range: Range, options?: {
    blockSeparator?: string;
    textSerializers?: Record<string, TextSerializer>;
}): string;

/**
 * Returns the text content of a resolved prosemirror position
 * @param $from The resolved position to get the text content from
 * @param maxMatch The maximum number of characters to match
 * @returns The text content
 */
declare const getTextContentFromNodes: ($from: ResolvedPos, maxMatch?: number) => string;

/**
 * Find text serializers `toText` in a Prosemirror schema
 * @param schema The Prosemirror schema to search in
 * @returns A record of text serializers by node name
 */
declare function getTextSerializersFromSchema(schema: Schema): Record<string, TextSerializer>;

/**
 * This function merges extension attributes into parserule attributes (`attrs` or `getAttrs`).
 * Cancels when `getAttrs` returned `false`.
 * @param parseRule ProseMirror ParseRule
 * @param extensionAttributes List of attributes to inject
 */
declare function injectExtensionAttributesToParseRule(parseRule: ParseRule, extensionAttributes: ExtensionAttribute[]): ParseRule;

declare function isActive(state: EditorState, name: string | null, attributes?: Record<string, any>): boolean;

declare const isAtEndOfNode: (state: EditorState, nodeType?: string) => boolean;

declare const isAtStartOfNode: (state: EditorState) => boolean;

declare function isExtensionRulesEnabled(extension: AnyExtension, enabled: EnableRules): boolean;

declare function isList(name: string, extensions: Extensions): boolean;

declare function isMarkActive(state: EditorState, typeOrName: MarkType$1 | string | null, attributes?: Record<string, any>): boolean;

declare function isNodeActive(state: EditorState, typeOrName: NodeType$1 | string | null, attributes?: Record<string, any>): boolean;

/**
 * Returns true if the given prosemirror node is empty.
 */
declare function isNodeEmpty(node: Node$1, { checkChildren, ignoreWhitespace, }?: {
    /**
     * When true (default), it will also check if all children are empty.
     */
    checkChildren?: boolean;
    /**
     * When true, it will ignore whitespace when checking for emptiness.
     */
    ignoreWhitespace?: boolean;
}): boolean;

declare function isNodeSelection(value: unknown): value is NodeSelection;

/**
 * Determines whether a node view should be considered selected for the given
 * editor selection.
 *
 * A node is considered selected when the current selection fully covers it
 * (e.g. a `NodeSelection`). When `selectedOnTextSelection` is enabled, the
 * node is additionally considered selected if a `TextSelection` is fully
 * contained within the node's range.
 *
 * @param selection The current editor selection.
 * @param pos The start position of the node in the document.
 * @param nodeSize The size of the node.
 * @param selectedOnTextSelection When `true`, also treat selections inside the node as selected.
 * @returns `true` if the node view should render as selected.
 */
declare function isNodeViewSelected({ selection, pos, nodeSize, selectedOnTextSelection, }: {
    selection: Selection;
    pos: number;
    nodeSize: number;
    selectedOnTextSelection?: boolean;
}): boolean;

declare function isTextSelection(value: unknown): value is TextSelection;

declare function posToDOMRect(view: EditorView, from: number, to: number): DOMRect;

/**
 * Returns a flattened and sorted extension list while
 * also checking for duplicated extensions and warns the user.
 * @param extensions An array of Tiptap extensions
 * @returns An flattened and sorted array of Tiptap extensions
 */
declare function resolveExtensions(extensions: Extensions): Extensions;

declare function resolveFocusPosition(doc: Node$1, position?: FocusPosition): Selection | null;

type RewriteUnknownContentOptions = {
    /**
     * If true, unknown nodes will be treated as paragraphs
     * @default true
     */
    fallbackToParagraph?: boolean;
};
/**
 * Rewrite unknown nodes and marks within JSON content
 * Allowing for user within the editor
 */
declare function rewriteUnknownContent(
/**
 * The JSON content to clean of unknown nodes and marks
 */
json: JSONContent, 
/**
 * The schema to use for validation
 */
schema: Schema, 
/**
 * Options for the cleaning process
 */
options?: RewriteUnknownContentOptions): {
    /**
     * The cleaned JSON content
     */
    json: JSONContent | null;
    /**
     * The array of nodes and marks that were rewritten
     */
    rewrittenContent: {
        /**
         * The original JSON content that was rewritten
         */
        original: JSONContent;
        /**
         * The name of the node or mark that was unsupported
         */
        unsupported: string;
    }[];
};

declare function selectionToInsertionEnd(tr: Transaction, startLen: number, bias: number): void;

/**
 * Sort extensions by priority.
 * @param extensions An array of Tiptap extensions
 * @returns A sorted array of Tiptap extensions by priority
 */
declare function sortExtensions(extensions: Extensions): Extensions;

declare function splitExtensions(extensions: Extensions): {
    baseExtensions: Extension<any, any>[];
    nodeExtensions: Node<any, any>[];
    markExtensions: Mark<any, any>[];
};

declare class ExtensionManager {
    editor: Editor;
    schema: Schema;
    /**
     * A flattened and sorted array of all extensions
     */
    extensions: Extensions;
    /**
     * A non-flattened array of base extensions (no sub-extensions)
     */
    baseExtensions: Extensions;
    splittableMarks: string[];
    nonClearableMarks: string[];
    constructor(extensions: Extensions, editor: Editor);
    static resolve: typeof resolveExtensions;
    static sort: typeof sortExtensions;
    static flatten: typeof flattenExtensions;
    /**
     * Get all commands from the extensions.
     * @returns An object with all commands where the key is the command name and the value is the command function
     */
    get commands(): RawCommands;
    /**
     * Get all registered Prosemirror plugins from the extensions.
     * @returns An array of Prosemirror plugins
     */
    get plugins(): Plugin[];
    /**
     * Get all attributes from the extensions.
     * @returns An array of attributes
     */
    get attributes(): ExtensionAttribute[];
    /**
     * Get all node views from the extensions.
     * @returns An object with all node views where the key is the node name and the value is the node view function
     */
    get nodeViews(): Record<string, NodeViewConstructor>;
    /**
     * Get the composed dispatchTransaction function from all extensions.
     * @param baseDispatch The base dispatch function (e.g. from the editor or user props)
     * @returns A composed dispatch function
     */
    dispatchTransaction(baseDispatch: (tr: Transaction) => void): (tr: Transaction) => void;
    /**
     * Get the composed transformPastedHTML function from all extensions.
     * @param baseTransform The base transform function (e.g. from the editor props)
     * @returns A composed transform function that chains all extension transforms
     */
    transformPastedHTML(baseTransform?: (html: string, view?: any) => string): (html: string, view?: EditorView) => string;
    get markViews(): Record<string, MarkViewConstructor>;
    /**
     * Destroy the extension manager and clean up all extension references
     * to prevent memory leaks through parent/child extension chains.
     *
     * Walks each extension's full parent chain and nulls every forward
     * `parent.child → current` link where the parent still points to the
     * current node. This breaks the retention path from module-scope
     * singleton roots through deep extend() chains.
     *
     * Only ancestor `.child` links matching the current chain are cleared.
     * The `.parent` pointer on ancestors is never touched — extensions
     * may be shared across live editors, so their own backward references
     * and non-matching forward links must remain intact.
     */
    destroy(): void;
    /**
     * Go through all extensions, create extension storages & setup marks
     * & bind editor event listener.
     */
    private setupExtensions;
}

declare class NodePos {
    private resolvedPos;
    private isBlock;
    private editor;
    private get name();
    constructor(pos: ResolvedPos, editor: Editor, isBlock?: boolean, node?: Node$1 | null);
    private currentNode;
    get node(): Node$1;
    get element(): HTMLElement;
    actualDepth: number | null;
    get depth(): number;
    get pos(): number;
    get content(): Fragment$1;
    set content(content: Content);
    get attributes(): {
        [key: string]: any;
    };
    get textContent(): string;
    get size(): number;
    get from(): number;
    get range(): Range;
    get to(): number;
    get parent(): NodePos | null;
    get before(): NodePos | null;
    get after(): NodePos | null;
    get children(): NodePos[];
    get firstChild(): NodePos | null;
    get lastChild(): NodePos | null;
    closest(selector: string, attributes?: {
        [key: string]: any;
    }): NodePos | null;
    querySelector(selector: string, attributes?: {
        [key: string]: any;
    }): NodePos | null;
    querySelectorAll(selector: string, attributes?: {
        [key: string]: any;
    }, firstItemOnly?: boolean): NodePos[];
    setAttribute(attributes: {
        [key: string]: any;
    }): void;
}

type ClipboardTextSerializerOptions = {
    blockSeparator?: string;
};
declare const ClipboardTextSerializer: Extension<ClipboardTextSerializerOptions, any>;

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        blur: {
            /**
             * Removes focus from the editor.
             * @example editor.commands.blur()
             */
            blur: () => ReturnType;
        };
    }
}
declare const blur: RawCommands['blur'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        clearContent: {
            /**
             * Clear the whole document.
             * @example editor.commands.clearContent()
             */
            clearContent: (
            /**
             * Whether to emit an update event.
             * @default true
             */
            emitUpdate?: boolean) => ReturnType;
        };
    }
}
declare const clearContent: RawCommands['clearContent'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        clearNodes: {
            /**
             * Normalize nodes to a simple paragraph.
             * @example editor.commands.clearNodes()
             */
            clearNodes: () => ReturnType;
        };
    }
}
declare const clearNodes: RawCommands['clearNodes'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        command: {
            /**
             * Define a command inline.
             * @param fn The command function.
             * @example
             * editor.commands.command(({ tr, state }) => {
             *   ...
             *   return true
             * })
             */
            command: (fn: (props: Parameters<Command>[0]) => boolean) => ReturnType;
        };
    }
}
declare const command: RawCommands['command'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        createParagraphNear: {
            /**
             * Create a paragraph nearby.
             * @example editor.commands.createParagraphNear()
             */
            createParagraphNear: () => ReturnType;
        };
    }
}
declare const createParagraphNear: RawCommands['createParagraphNear'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        cut: {
            /**
             * Cuts content from a range and inserts it at a given position.
             * @param range The range to cut.
             * @param range.from The start position of the range.
             * @param range.to The end position of the range.
             * @param targetPos The position to insert the content at.
             * @example editor.commands.cut({ from: 1, to: 3 }, 5)
             */
            cut: ({ from, to }: {
                from: number;
                to: number;
            }, targetPos: number) => ReturnType;
        };
    }
}
declare const cut: RawCommands['cut'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        deleteCurrentNode: {
            /**
             * Delete the node that currently has the selection anchor.
             * @example editor.commands.deleteCurrentNode()
             */
            deleteCurrentNode: () => ReturnType;
        };
    }
}
declare const deleteCurrentNode: RawCommands['deleteCurrentNode'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        deleteNode: {
            /**
             * Delete a node with a given type or name.
             * @param typeOrName The type or name of the node.
             * @example editor.commands.deleteNode('paragraph')
             */
            deleteNode: (typeOrName: string | NodeType$1) => ReturnType;
        };
    }
}
declare const deleteNode: RawCommands['deleteNode'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        deleteRange: {
            /**
             * Delete a given range.
             * @param range The range to delete.
             * @example editor.commands.deleteRange({ from: 1, to: 3 })
             */
            deleteRange: (range: Range) => ReturnType;
        };
    }
}
declare const deleteRange: RawCommands['deleteRange'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        deleteSelection: {
            /**
             * Delete the selection, if there is one.
             * @example editor.commands.deleteSelection()
             */
            deleteSelection: () => ReturnType;
        };
    }
}
declare const deleteSelection: RawCommands['deleteSelection'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        enter: {
            /**
             * Trigger enter.
             * @example editor.commands.enter()
             */
            enter: () => ReturnType;
        };
    }
}
declare const enter: RawCommands['enter'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        exitCode: {
            /**
             * Exit from a code block.
             * @example editor.commands.exitCode()
             */
            exitCode: () => ReturnType;
        };
    }
}
declare const exitCode: RawCommands['exitCode'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        extendMarkRange: {
            /**
             * Extends the text selection to the current mark by type or name.
             * @param typeOrName The type or name of the mark.
             * @param attributes The attributes to match against.
             * If not provided, only the first mark at the position will be matched.
             * @example editor.commands.extendMarkRange('bold')
             * @example editor.commands.extendMarkRange('mention', { userId: "1" })
             */
            extendMarkRange: (
            /**
             * The type or name of the mark.
             */
            typeOrName: string | MarkType$1, 
            /**
             * The attributes of the mark.
             */
            attributes?: Record<string, any>) => ReturnType;
        };
    }
}
declare const extendMarkRange: RawCommands['extendMarkRange'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        first: {
            /**
             * Runs one command after the other and stops at the first which returns true.
             * @param commands The commands to run.
             * @example editor.commands.first([command1, command2])
             */
            first: (commands: Command[] | ((props: CommandProps) => Command[])) => ReturnType;
        };
    }
}
declare const first: RawCommands['first'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        focus: {
            /**
             * Focus the editor at the given position.
             * @param position The position to focus at.
             * @param options.scrollIntoView Scroll the focused position into view after focusing
             * @example editor.commands.focus()
             * @example editor.commands.focus(32, { scrollIntoView: false })
             */
            focus: (
            /**
             * The position to focus at.
             */
            position?: FocusPosition, 
            /**
             * Optional options
             * @default { scrollIntoView: true }
             */
            options?: {
                scrollIntoView?: boolean;
            }) => ReturnType;
        };
    }
}
declare const focus: RawCommands['focus'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        forEach: {
            /**
             * Loop through an array of items.
             */
            forEach: <T>(items: T[], fn: (item: T, props: CommandProps & {
                index: number;
            }) => boolean) => ReturnType;
        };
    }
}
declare const forEach: RawCommands['forEach'];

interface InsertContentOptions {
    /**
     * Options for parsing the content.
     */
    parseOptions?: ParseOptions;
    /**
     * Whether to update the selection after inserting the content.
     */
    updateSelection?: boolean;
    applyInputRules?: boolean;
    applyPasteRules?: boolean;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        insertContent: {
            /**
             * Insert a node or string of HTML at the current position.
             * @example editor.commands.insertContent('<h1>Example</h1>')
             * @example editor.commands.insertContent('<h1>Example</h1>', { updateSelection: false })
             */
            insertContent: (
            /**
             * The ProseMirror content to insert.
             */
            value: Content | Node$1 | Fragment$1, 
            /**
             * Optional options
             */
            options?: InsertContentOptions) => ReturnType;
        };
    }
}
declare const insertContent: RawCommands['insertContent'];

interface InsertContentAtOptions {
    /**
     * Options for parsing the content.
     */
    parseOptions?: ParseOptions;
    /**
     * Whether to update the selection after inserting the content.
     */
    updateSelection?: boolean;
    /**
     * Whether to apply input rules after inserting the content.
     */
    applyInputRules?: boolean;
    /**
     * Whether to apply paste rules after inserting the content.
     */
    applyPasteRules?: boolean;
    /**
     * Whether to throw an error if the content is invalid.
     */
    errorOnInvalidContent?: boolean;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        insertContentAt: {
            /**
             * Insert a node or string of HTML at a specific position.
             * @example editor.commands.insertContentAt(0, '<h1>Example</h1>')
             */
            insertContentAt: (
            /**
             * The position to insert the content at.
             */
            position: number | Range, 
            /**
             * The ProseMirror content to insert.
             */
            value: Content | Node$1 | Fragment$1, 
            /**
             * Optional options
             */
            options?: InsertContentAtOptions) => ReturnType;
        };
    }
}
declare const insertContentAt: RawCommands['insertContentAt'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        joinUp: {
            /**
             * Join the selected block or, if there is a text selection, the closest ancestor block of the selection that can be joined, with the sibling above it.
             * @example editor.commands.joinUp()
             */
            joinUp: () => ReturnType;
        };
        joinDown: {
            /**
             * Join the selected block, or the closest ancestor of the selection that can be joined, with the sibling after it.
             * @example editor.commands.joinDown()
             */
            joinDown: () => ReturnType;
        };
        joinBackward: {
            /**
             * If the selection is empty and at the start of a textblock, try to reduce the distance between that block and the one before it—if there's a block directly before it that can be joined, join them.
             * If not, try to move the selected block closer to the next one in the document structure by lifting it out of its
             * parent or moving it into a parent of the previous block. Will use the view for accurate (bidi-aware) start-of-textblock detection if given.
             * @example editor.commands.joinBackward()
             */
            joinBackward: () => ReturnType;
        };
        joinForward: {
            /**
             * If the selection is empty and the cursor is at the end of a textblock, try to reduce or remove the boundary between that block and the one after it,
             * either by joining them or by moving the other block closer to this one in the tree structure.
             * Will use the view for accurate start-of-textblock detection if given.
             * @example editor.commands.joinForward()
             */
            joinForward: () => ReturnType;
        };
    }
}
declare const joinUp: RawCommands['joinUp'];
declare const joinDown: RawCommands['joinDown'];
declare const joinBackward: RawCommands['joinBackward'];
declare const joinForward: RawCommands['joinForward'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        joinItemBackward: {
            /**
             * Join two items backward.
             * @example editor.commands.joinItemBackward()
             */
            joinItemBackward: () => ReturnType;
        };
    }
}
declare const joinItemBackward: RawCommands['joinItemBackward'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        joinItemForward: {
            /**
             * Join two items Forwards.
             * @example editor.commands.joinItemForward()
             */
            joinItemForward: () => ReturnType;
        };
    }
}
declare const joinItemForward: RawCommands['joinItemForward'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        joinTextblockBackward: {
            /**
             * A more limited form of joinBackward that only tries to join the current textblock to the one before it, if the cursor is at the start of a textblock.
             */
            joinTextblockBackward: () => ReturnType;
        };
    }
}
declare const joinTextblockBackward: RawCommands['joinTextblockBackward'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        joinTextblockForward: {
            /**
             * A more limited form of joinForward that only tries to join the current textblock to the one after it, if the cursor is at the end of a textblock.
             */
            joinTextblockForward: () => ReturnType;
        };
    }
}
declare const joinTextblockForward: RawCommands['joinTextblockForward'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        keyboardShortcut: {
            /**
             * Trigger a keyboard shortcut.
             * @param name The name of the keyboard shortcut.
             * @example editor.commands.keyboardShortcut('Mod-b')
             */
            keyboardShortcut: (name: string) => ReturnType;
        };
    }
}
declare const keyboardShortcut: RawCommands['keyboardShortcut'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        lift: {
            /**
             * Removes an existing wrap if possible lifting the node out of it
             * @param typeOrName The type or name of the node.
             * @param attributes The attributes of the node.
             * @example editor.commands.lift('paragraph')
             * @example editor.commands.lift('heading', { level: 1 })
             */
            lift: (typeOrName: string | NodeType$1, attributes?: Record<string, any>) => ReturnType;
        };
    }
}
declare const lift: RawCommands['lift'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        liftEmptyBlock: {
            /**
             * If the cursor is in an empty textblock that can be lifted, lift the block.
             * @example editor.commands.liftEmptyBlock()
             */
            liftEmptyBlock: () => ReturnType;
        };
    }
}
declare const liftEmptyBlock: RawCommands['liftEmptyBlock'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        liftListItem: {
            /**
             * Create a command to lift the list item around the selection up into a wrapping list.
             * @param typeOrName The type or name of the node.
             * @example editor.commands.liftListItem('listItem')
             */
            liftListItem: (typeOrName: string | NodeType$1) => ReturnType;
        };
    }
}
declare const liftListItem: RawCommands['liftListItem'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        newlineInCode: {
            /**
             * Add a newline character in code.
             * @example editor.commands.newlineInCode()
             */
            newlineInCode: () => ReturnType;
        };
    }
}
declare const newlineInCode: RawCommands['newlineInCode'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        resetAttributes: {
            /**
             * Resets some node attributes to the default value.
             * @param typeOrName The type or name of the node.
             * @param attributes The attributes of the node to reset.
             * @example editor.commands.resetAttributes('heading', 'level')
             */
            resetAttributes: (typeOrName: string | NodeType$1 | MarkType$1, attributes: string | string[]) => ReturnType;
        };
    }
}
declare const resetAttributes: RawCommands['resetAttributes'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        scrollIntoView: {
            /**
             * Scroll the selection into view.
             * @example editor.commands.scrollIntoView()
             */
            scrollIntoView: () => ReturnType;
        };
    }
}
declare const scrollIntoView: RawCommands['scrollIntoView'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        selectAll: {
            /**
             * Select the whole document.
             * @example editor.commands.selectAll()
             */
            selectAll: () => ReturnType;
        };
    }
}
declare const selectAll: RawCommands['selectAll'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        selectNodeBackward: {
            /**
             * Select a node backward.
             * @example editor.commands.selectNodeBackward()
             */
            selectNodeBackward: () => ReturnType;
        };
    }
}
declare const selectNodeBackward: RawCommands['selectNodeBackward'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        selectNodeForward: {
            /**
             * Select a node forward.
             * @example editor.commands.selectNodeForward()
             */
            selectNodeForward: () => ReturnType;
        };
    }
}
declare const selectNodeForward: RawCommands['selectNodeForward'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        selectParentNode: {
            /**
             * Select the parent node.
             * @example editor.commands.selectParentNode()
             */
            selectParentNode: () => ReturnType;
        };
    }
}
declare const selectParentNode: RawCommands['selectParentNode'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        selectTextblockEnd: {
            /**
             * Moves the cursor to the end of current text block.
             * @example editor.commands.selectTextblockEnd()
             */
            selectTextblockEnd: () => ReturnType;
        };
    }
}
declare const selectTextblockEnd: RawCommands['selectTextblockEnd'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        selectTextblockStart: {
            /**
             * Moves the cursor to the start of current text block.
             * @example editor.commands.selectTextblockStart()
             */
            selectTextblockStart: () => ReturnType;
        };
    }
}
declare const selectTextblockStart: RawCommands['selectTextblockStart'];

interface SetContentOptions {
    /**
     * Options for parsing the content.
     * @default {}
     */
    parseOptions?: ParseOptions;
    /**
     * Whether to throw an error if the content is invalid.
     */
    errorOnInvalidContent?: boolean;
    /**
     * Whether to emit an update event.
     * @default true
     */
    emitUpdate?: boolean;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        setContent: {
            /**
             * Replace the whole document with new content.
             * @param content The new content.
             * @param emitUpdate Whether to emit an update event.
             * @param parseOptions Options for parsing the content.
             * @example editor.commands.setContent('<p>Example text</p>')
             */
            setContent: (
            /**
             * The new content.
             */
            content: Content | Fragment$1 | Node$1, 
            /**
             * Options for `setContent`.
             */
            options?: SetContentOptions) => ReturnType;
        };
    }
}
declare const setContent: RawCommands['setContent'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        setMark: {
            /**
             * Add a mark with new attributes.
             * @param typeOrName The mark type or name.
             * @example editor.commands.setMark('bold', { level: 1 })
             */
            setMark: (typeOrName: string | MarkType$1, attributes?: Record<string, any>) => ReturnType;
        };
    }
}
declare const setMark: RawCommands['setMark'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        setMeta: {
            /**
             * Store a metadata property in the current transaction.
             * @param key The key of the metadata property.
             * @param value The value to store.
             * @example editor.commands.setMeta('foo', 'bar')
             */
            setMeta: (key: string | Plugin | PluginKey, value: any) => ReturnType;
        };
    }
}
declare const setMeta: RawCommands['setMeta'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        setNode: {
            /**
             * Replace a given range with a node.
             * @param typeOrName The type or name of the node
             * @param attributes The attributes of the node
             * @example editor.commands.setNode('paragraph')
             */
            setNode: (typeOrName: string | NodeType$1, attributes?: Record<string, any>) => ReturnType;
        };
    }
}
declare const setNode: RawCommands['setNode'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        setNodeSelection: {
            /**
             * Creates a NodeSelection.
             * @param position - Position of the node.
             * @example editor.commands.setNodeSelection(10)
             */
            setNodeSelection: (position: number) => ReturnType;
        };
    }
}
declare const setNodeSelection: RawCommands['setNodeSelection'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        setTextDirection: {
            /**
             * Set the text direction for nodes.
             * If no position is provided, it will use the current selection.
             * @param direction The text direction to set ('ltr', 'rtl', or 'auto')
             * @param position Optional position or range to apply the direction to
             * @example editor.commands.setTextDirection('rtl')
             * @example editor.commands.setTextDirection('ltr', { from: 0, to: 10 })
             */
            setTextDirection: (direction: 'ltr' | 'rtl' | 'auto', position?: number | Range) => ReturnType;
        };
    }
}
declare const setTextDirection: RawCommands['setTextDirection'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        setTextSelection: {
            /**
             * Creates a TextSelection.
             * @param position The position of the selection.
             * @example editor.commands.setTextSelection(10)
             */
            setTextSelection: (position: number | Range) => ReturnType;
        };
    }
}
declare const setTextSelection: RawCommands['setTextSelection'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        sinkListItem: {
            /**
             * Sink the list item down into an inner list.
             * @param typeOrName The type or name of the node.
             * @example editor.commands.sinkListItem('listItem')
             */
            sinkListItem: (typeOrName: string | NodeType$1) => ReturnType;
        };
    }
}
declare const sinkListItem: RawCommands['sinkListItem'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        splitBlock: {
            /**
             * Forks a new node from an existing node.
             * @param options.keepMarks Keep marks from the previous node.
             * @example editor.commands.splitBlock()
             * @example editor.commands.splitBlock({ keepMarks: true })
             */
            splitBlock: (options?: {
                keepMarks?: boolean;
            }) => ReturnType;
        };
    }
}
declare const splitBlock: RawCommands['splitBlock'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        splitListItem: {
            /**
             * Splits one list item into two list items.
             * @param typeOrName The type or name of the node.
             * @param overrideAttrs The attributes to ensure on the new node.
             * @example editor.commands.splitListItem('listItem')
             */
            splitListItem: (typeOrName: string | NodeType$1, overrideAttrs?: Record<string, any>) => ReturnType;
        };
    }
}
declare const splitListItem: RawCommands['splitListItem'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        toggleList: {
            /**
             * Toggle between different list types.
             * @param listTypeOrName The type or name of the list.
             * @param itemTypeOrName The type or name of the list item.
             * @param keepMarks Keep marks when toggling.
             * @param attributes Attributes for the new list.
             * @example editor.commands.toggleList('bulletList', 'listItem')
             */
            toggleList: (listTypeOrName: string | NodeType$1, itemTypeOrName: string | NodeType$1, keepMarks?: boolean, attributes?: Record<string, any>) => ReturnType;
        };
    }
}
declare const toggleList: RawCommands['toggleList'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        toggleMark: {
            /**
             * Toggle a mark on and off.
             * @param typeOrName The mark type or name.
             * @param attributes The attributes of the mark.
             * @param options.extendEmptyMarkRange Removes the mark even across the current selection. Defaults to `false`.
             * @example editor.commands.toggleMark('bold')
             */
            toggleMark: (
            /**
             * The mark type or name.
             */
            typeOrName: string | MarkType$1, 
            /**
             * The attributes of the mark.
             */
            attributes?: Record<string, any>, options?: {
                /**
                 * Removes the mark even across the current selection. Defaults to `false`.
                 */
                extendEmptyMarkRange?: boolean;
            }) => ReturnType;
        };
    }
}
declare const toggleMark: RawCommands['toggleMark'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        toggleNode: {
            /**
             * Toggle a node with another node.
             * @param typeOrName The type or name of the node.
             * @param toggleTypeOrName The type or name of the node to toggle.
             * @param attributes The attributes of the node.
             * @example editor.commands.toggleNode('heading', 'paragraph')
             */
            toggleNode: (typeOrName: string | NodeType$1, toggleTypeOrName: string | NodeType$1, attributes?: Record<string, any>) => ReturnType;
        };
    }
}
declare const toggleNode: RawCommands['toggleNode'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        toggleWrap: {
            /**
             * Wraps nodes in another node, or removes an existing wrap.
             * @param typeOrName The type or name of the node.
             * @param attributes The attributes of the node.
             * @example editor.commands.toggleWrap('blockquote')
             */
            toggleWrap: (typeOrName: string | NodeType$1, attributes?: Record<string, any>) => ReturnType;
        };
    }
}
declare const toggleWrap: RawCommands['toggleWrap'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        undoInputRule: {
            /**
             * Undo an input rule.
             * @example editor.commands.undoInputRule()
             */
            undoInputRule: () => ReturnType;
        };
    }
}
declare const undoInputRule: RawCommands['undoInputRule'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        unsetAllMarks: {
            /**
             * Remove all clearable marks in the current selection.
             * Marks with `clearable: false` are preserved
             * @param options.ignoreClearable If true, removes all marks regardless of `clearable` setting. Defaults to `false`.
             * @example editor.commands.unsetAllMarks()
             * @example editor.commands.unsetAllMarks({ ignoreClearable: true })
             */
            unsetAllMarks: (options?: {
                ignoreClearable?: boolean;
            }) => ReturnType;
        };
    }
}
declare const unsetAllMarks: RawCommands['unsetAllMarks'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        unsetMark: {
            /**
             * Remove all marks in the current selection.
             * @param typeOrName The mark type or name.
             * @param options.extendEmptyMarkRange Removes the mark even across the current selection. Defaults to `false`.
             * @example editor.commands.unsetMark('bold')
             */
            unsetMark: (
            /**
             * The mark type or name.
             */
            typeOrName: string | MarkType$1, options?: {
                /**
                 * Removes the mark even across the current selection. Defaults to `false`.
                 */
                extendEmptyMarkRange?: boolean;
            }) => ReturnType;
        };
    }
}
declare const unsetMark: RawCommands['unsetMark'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        unsetTextDirection: {
            /**
             * Remove the text direction attribute from nodes.
             * If no position is provided, it will use the current selection.
             * @param position Optional position or range to remove the direction from
             * @example editor.commands.unsetTextDirection()
             * @example editor.commands.unsetTextDirection({ from: 0, to: 10 })
             */
            unsetTextDirection: (position?: number | Range) => ReturnType;
        };
    }
}
declare const unsetTextDirection: RawCommands['unsetTextDirection'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        updateAttributes: {
            /**
             * Update attributes of a node or mark.
             * @param typeOrName The type or name of the node or mark.
             * @param attributes The attributes of the node or mark.
             * @example editor.commands.updateAttributes('mention', { userId: "2" })
             */
            updateAttributes: (
            /**
             * The type or name of the node or mark.
             */
            typeOrName: string | NodeType$1 | MarkType$1, 
            /**
             * The attributes of the node or mark.
             */
            attributes: Record<string, any>) => ReturnType;
        };
    }
}
declare const updateAttributes: RawCommands['updateAttributes'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        wrapIn: {
            /**
             * Wraps nodes in another node.
             * @param typeOrName The type or name of the node.
             * @param attributes The attributes of the node.
             * @example editor.commands.wrapIn('blockquote')
             */
            wrapIn: (typeOrName: string | NodeType$1, attributes?: Record<string, any>) => ReturnType;
        };
    }
}
declare const wrapIn: RawCommands['wrapIn'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        wrapInList: {
            /**
             * Wrap a node in a list.
             * @param typeOrName The type or name of the node.
             * @param attributes The attributes of the node.
             * @example editor.commands.wrapInList('bulletList')
             */
            wrapInList: (typeOrName: string | NodeType$1, attributes?: Record<string, any>) => ReturnType;
        };
    }
}
declare const wrapInList: RawCommands['wrapInList'];

type index$2_InsertContentAtOptions = InsertContentAtOptions;
type index$2_InsertContentOptions = InsertContentOptions;
type index$2_SetContentOptions = SetContentOptions;
declare const index$2_blur: typeof blur;
declare const index$2_clearContent: typeof clearContent;
declare const index$2_clearNodes: typeof clearNodes;
declare const index$2_command: typeof command;
declare const index$2_createParagraphNear: typeof createParagraphNear;
declare const index$2_cut: typeof cut;
declare const index$2_deleteCurrentNode: typeof deleteCurrentNode;
declare const index$2_deleteNode: typeof deleteNode;
declare const index$2_deleteRange: typeof deleteRange;
declare const index$2_deleteSelection: typeof deleteSelection;
declare const index$2_enter: typeof enter;
declare const index$2_exitCode: typeof exitCode;
declare const index$2_extendMarkRange: typeof extendMarkRange;
declare const index$2_first: typeof first;
declare const index$2_focus: typeof focus;
declare const index$2_forEach: typeof forEach;
declare const index$2_insertContent: typeof insertContent;
declare const index$2_insertContentAt: typeof insertContentAt;
declare const index$2_joinBackward: typeof joinBackward;
declare const index$2_joinDown: typeof joinDown;
declare const index$2_joinForward: typeof joinForward;
declare const index$2_joinItemBackward: typeof joinItemBackward;
declare const index$2_joinItemForward: typeof joinItemForward;
declare const index$2_joinTextblockBackward: typeof joinTextblockBackward;
declare const index$2_joinTextblockForward: typeof joinTextblockForward;
declare const index$2_joinUp: typeof joinUp;
declare const index$2_keyboardShortcut: typeof keyboardShortcut;
declare const index$2_lift: typeof lift;
declare const index$2_liftEmptyBlock: typeof liftEmptyBlock;
declare const index$2_liftListItem: typeof liftListItem;
declare const index$2_newlineInCode: typeof newlineInCode;
declare const index$2_resetAttributes: typeof resetAttributes;
declare const index$2_scrollIntoView: typeof scrollIntoView;
declare const index$2_selectAll: typeof selectAll;
declare const index$2_selectNodeBackward: typeof selectNodeBackward;
declare const index$2_selectNodeForward: typeof selectNodeForward;
declare const index$2_selectParentNode: typeof selectParentNode;
declare const index$2_selectTextblockEnd: typeof selectTextblockEnd;
declare const index$2_selectTextblockStart: typeof selectTextblockStart;
declare const index$2_setContent: typeof setContent;
declare const index$2_setMark: typeof setMark;
declare const index$2_setMeta: typeof setMeta;
declare const index$2_setNode: typeof setNode;
declare const index$2_setNodeSelection: typeof setNodeSelection;
declare const index$2_setTextDirection: typeof setTextDirection;
declare const index$2_setTextSelection: typeof setTextSelection;
declare const index$2_sinkListItem: typeof sinkListItem;
declare const index$2_splitBlock: typeof splitBlock;
declare const index$2_splitListItem: typeof splitListItem;
declare const index$2_toggleList: typeof toggleList;
declare const index$2_toggleMark: typeof toggleMark;
declare const index$2_toggleNode: typeof toggleNode;
declare const index$2_toggleWrap: typeof toggleWrap;
declare const index$2_undoInputRule: typeof undoInputRule;
declare const index$2_unsetAllMarks: typeof unsetAllMarks;
declare const index$2_unsetMark: typeof unsetMark;
declare const index$2_unsetTextDirection: typeof unsetTextDirection;
declare const index$2_updateAttributes: typeof updateAttributes;
declare const index$2_wrapIn: typeof wrapIn;
declare const index$2_wrapInList: typeof wrapInList;
declare namespace index$2 {
  export { type index$2_InsertContentAtOptions as InsertContentAtOptions, type index$2_InsertContentOptions as InsertContentOptions, type index$2_SetContentOptions as SetContentOptions, index$2_blur as blur, index$2_clearContent as clearContent, index$2_clearNodes as clearNodes, index$2_command as command, index$2_createParagraphNear as createParagraphNear, index$2_cut as cut, index$2_deleteCurrentNode as deleteCurrentNode, index$2_deleteNode as deleteNode, index$2_deleteRange as deleteRange, index$2_deleteSelection as deleteSelection, index$2_enter as enter, index$2_exitCode as exitCode, index$2_extendMarkRange as extendMarkRange, index$2_first as first, index$2_focus as focus, index$2_forEach as forEach, index$2_insertContent as insertContent, index$2_insertContentAt as insertContentAt, index$2_joinBackward as joinBackward, index$2_joinDown as joinDown, index$2_joinForward as joinForward, index$2_joinItemBackward as joinItemBackward, index$2_joinItemForward as joinItemForward, index$2_joinTextblockBackward as joinTextblockBackward, index$2_joinTextblockForward as joinTextblockForward, index$2_joinUp as joinUp, index$2_keyboardShortcut as keyboardShortcut, index$2_lift as lift, index$2_liftEmptyBlock as liftEmptyBlock, index$2_liftListItem as liftListItem, index$2_newlineInCode as newlineInCode, index$2_resetAttributes as resetAttributes, index$2_scrollIntoView as scrollIntoView, index$2_selectAll as selectAll, index$2_selectNodeBackward as selectNodeBackward, index$2_selectNodeForward as selectNodeForward, index$2_selectParentNode as selectParentNode, index$2_selectTextblockEnd as selectTextblockEnd, index$2_selectTextblockStart as selectTextblockStart, index$2_setContent as setContent, index$2_setMark as setMark, index$2_setMeta as setMeta, index$2_setNode as setNode, index$2_setNodeSelection as setNodeSelection, index$2_setTextDirection as setTextDirection, index$2_setTextSelection as setTextSelection, index$2_sinkListItem as sinkListItem, index$2_splitBlock as splitBlock, index$2_splitListItem as splitListItem, index$2_toggleList as toggleList, index$2_toggleMark as toggleMark, index$2_toggleNode as toggleNode, index$2_toggleWrap as toggleWrap, index$2_undoInputRule as undoInputRule, index$2_unsetAllMarks as unsetAllMarks, index$2_unsetMark as unsetMark, index$2_unsetTextDirection as unsetTextDirection, index$2_updateAttributes as updateAttributes, index$2_wrapIn as wrapIn, index$2_wrapInList as wrapInList };
}

declare const Commands: Extension<any, any>;

/**
 * This extension allows you to be notified when the user deletes content you are interested in.
 */
declare const Delete: Extension<any, any>;

declare const Drop: Extension<any, any>;

declare const Editable: Extension<any, any>;

declare const focusEventsPluginKey: PluginKey<any>;
declare const FocusEvents: Extension<any, any>;

declare const Keymap: Extension<any, any>;

declare const Paste: Extension<any, any>;

/**
 * Options for the Tabindex extension.
 */
type TabindexOptions = {
    /**
     * The value for the `tabindex` attribute on the editor element.
     * When undefined, editable editors default to `0` and non-editable editors get no tabindex.
     */
    value?: string;
};
/**
 * The Tabindex extension adds a configurable tabindex attribute to the editor.
 *
 * By default, the editor gets tabindex="0" when editable. This can be customized
 * via coreExtensionOptions to support specific focus ordering requirements in forms
 * or to enable focusing on non-editable editors.
 *
 * @example
 * ```ts
 * new Editor({
 *   coreExtensionOptions: {
 *     tabindex: {
 *       value: '-1',
 *     },
 *   },
 * })
 * ```
 */
declare const Tabindex: Extension<TabindexOptions, any>;

interface TextDirectionOptions {
    direction: 'ltr' | 'rtl' | 'auto' | undefined;
}
/**
 * The TextDirection extension adds support for setting text direction (LTR/RTL/auto)
 * on all nodes in the editor.
 *
 * This extension adds a global `dir` attribute to all node types, which can be used
 * to control bidirectional text rendering. The direction can be set globally via
 * editor options or per-node using commands.
 */
declare const TextDirection: Extension<TextDirectionOptions, any>;

declare const index$1_ClipboardTextSerializer: typeof ClipboardTextSerializer;
declare const index$1_Commands: typeof Commands;
declare const index$1_Delete: typeof Delete;
declare const index$1_Drop: typeof Drop;
declare const index$1_Editable: typeof Editable;
declare const index$1_FocusEvents: typeof FocusEvents;
declare const index$1_Keymap: typeof Keymap;
declare const index$1_Paste: typeof Paste;
declare const index$1_Tabindex: typeof Tabindex;
declare const index$1_TextDirection: typeof TextDirection;
declare const index$1_focusEventsPluginKey: typeof focusEventsPluginKey;
declare namespace index$1 {
  export { index$1_ClipboardTextSerializer as ClipboardTextSerializer, index$1_Commands as Commands, index$1_Delete as Delete, index$1_Drop as Drop, index$1_Editable as Editable, index$1_FocusEvents as FocusEvents, index$1_Keymap as Keymap, index$1_Paste as Paste, index$1_Tabindex as Tabindex, index$1_TextDirection as TextDirection, index$1_focusEventsPluginKey as focusEventsPluginKey };
}

interface TiptapEditorHTMLElement extends HTMLElement {
    editor?: Editor;
}
declare class Editor extends EventEmitter<EditorEvents> {
    private commandManager;
    extensionManager: ExtensionManager;
    private css;
    private className;
    schema: Schema;
    private editorView;
    isFocused: boolean;
    private destroyed;
    private editorState;
    /**
     * The editor is considered initialized after the `create` event has been emitted.
     */
    isInitialized: boolean;
    extensionStorage: Storage;
    /**
     * A unique ID for this editor instance.
     */
    instanceId: string;
    options: EditorOptions;
    constructor(options?: Partial<EditorOptions>);
    /**
     * Attach the editor to the DOM, creating a new editor view.
     */
    mount(el: NonNullable<EditorOptions['element']> & {}): void;
    /**
     * Remove the editor from the DOM, but still allow remounting at a different point in time
     */
    unmount(): void;
    /**
     * Returns the editor storage.
     */
    get storage(): Storage;
    /**
     * An object of all registered commands.
     */
    get commands(): SingleCommands;
    /**
     * Create a command chain to call multiple commands at once.
     */
    chain(): ChainedCommands;
    /**
     * Check if a command or a command chain can be executed. Without executing it.
     */
    can(): CanCommands;
    /**
     * Inject CSS styles.
     */
    private injectCSS;
    /**
     * Update editor options.
     *
     * @param options A list of options
     */
    setOptions(options?: Partial<EditorOptions>): void;
    /**
     * Update editable state of the editor.
     */
    setEditable(editable: boolean, emitUpdate?: boolean): void;
    /**
     * Returns whether the editor is editable.
     */
    get isEditable(): boolean;
    /**
     * Returns the editor view.
     */
    get view(): EditorView;
    /**
     * Returns the editor state.
     */
    get state(): EditorState;
    /**
     * Register a ProseMirror plugin.
     *
     * @param plugin A ProseMirror plugin
     * @param handlePlugins Control how to merge the plugin into the existing plugins.
     * @returns The new editor state
     */
    registerPlugin(plugin: Plugin, handlePlugins?: (newPlugin: Plugin, plugins: Plugin[]) => Plugin[]): EditorState;
    /**
     * Unregister a ProseMirror plugin.
     *
     * @param nameOrPluginKeyToRemove The plugins name
     * @returns The new editor state or undefined if the editor is destroyed
     */
    unregisterPlugin(nameOrPluginKeyToRemove: string | PluginKey | (string | PluginKey)[]): EditorState | undefined;
    /**
     * Creates an extension manager.
     */
    private createExtensionManager;
    /**
     * Creates an command manager.
     */
    private createCommandManager;
    /**
     * Creates a ProseMirror schema.
     */
    private createSchema;
    /**
     * Creates the initial document.
     */
    private createDoc;
    /**
     * Creates a ProseMirror view.
     */
    private createView;
    /**
     * Creates all node and mark views.
     */
    createNodeViews(): void;
    /**
     * Prepend class name to element.
     */
    prependClass(): void;
    isCapturingTransaction: boolean;
    private capturedTransaction;
    captureTransaction(fn: () => void): Transaction | null;
    /**
     * The callback over which to send transactions (state updates) produced by the view.
     *
     * @param transaction An editor state transaction
     */
    private dispatchTransaction;
    /**
     * Get attributes of the currently selected node or mark.
     */
    getAttributes(nameOrType: string | NodeType$1 | MarkType$1): Record<string, any>;
    /**
     * Returns if the currently selected node or mark is active.
     *
     * @param name Name of the node or mark
     * @param attributes Attributes of the node or mark
     */
    isActive(name: string, attributes?: {}): boolean;
    isActive(attributes: {}): boolean;
    /**
     * Get the document as JSON.
     */
    getJSON(): DocumentType<Record<string, any> | undefined, NodeType<string, undefined | Record<string, any>, any, (NodeType | TextType)[]>[]>;
    /**
     * Get the document as HTML.
     */
    getHTML(): string;
    /**
     * Get the document as text.
     */
    getText(options?: {
        blockSeparator?: string;
        textSerializers?: Record<string, TextSerializer>;
    }): string;
    /**
     * Check if there is no content.
     */
    get isEmpty(): boolean;
    /**
     * Destroy the editor.
     */
    destroy(): void;
    /**
     * Check if the editor is already destroyed.
     */
    get isDestroyed(): boolean;
    $node(selector: string, attributes?: {
        [key: string]: any;
    }): NodePos | null;
    $nodes(selector: string, attributes?: {
        [key: string]: any;
    }): NodePos[] | null;
    $pos(pos: number): NodePos;
    get $doc(): NodePos;
    /**
     * Returns a set of utilities for working with positions and ranges.
     */
    utils: Utils;
}

declare class CommandManager {
    editor: Editor;
    rawCommands: AnyCommands;
    customState?: EditorState;
    constructor(props: {
        editor: Editor;
        state?: EditorState;
    });
    get hasCustomState(): boolean;
    get state(): EditorState;
    get commands(): SingleCommands;
    get chain(): () => ChainedCommands;
    get can(): () => CanCommands;
    createChain(startTr?: Transaction, shouldDispatch?: boolean): ChainedCommands;
    createCan(startTr?: Transaction): CanCommands;
    buildProps(tr: Transaction, shouldDispatch?: boolean): CommandProps;
}

/**
 * Build an input rule that adds a mark when the
 * matched text is typed into it.
 * @see https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing#input-rules
 */
declare function markInputRule(config: {
    find: InputRuleFinder;
    type: MarkType$1;
    undoable?: boolean;
    getAttributes?: Record<string, any> | ((match: ExtendedRegExpMatchArray) => Record<string, any>) | false | null;
}): InputRule;

/**
 * Build an input rule that adds a node when the
 * matched text is typed into it.
 * @see https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing#input-rules
 */
declare function nodeInputRule(config: {
    /**
     * The regex to match.
     */
    find: InputRuleFinder;
    /**
     * The node type to add.
     */
    type: NodeType$1;
    /**
     * Whether the input rule should be undoable
     * when the user presses backspace.
     */
    undoable?: boolean;
    /**
     * A function that returns the attributes for the node
     * can also be an object of attributes
     */
    getAttributes?: Record<string, any> | ((match: ExtendedRegExpMatchArray) => Record<string, any>) | false | null;
}): InputRule;

/**
 * Build an input rule that changes the type of a textblock when the
 * matched text is typed into it. When using a regular expresion you’ll
 * probably want the regexp to start with `^`, so that the pattern can
 * only occur at the start of a textblock.
 * @see https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing#input-rules
 */
declare function textblockTypeInputRule(config: {
    find: InputRuleFinder;
    type: NodeType$1;
    undoable?: boolean;
    getAttributes?: Record<string, any> | ((match: ExtendedRegExpMatchArray) => Record<string, any>) | false | null;
}): InputRule;

/**
 * Build an input rule that replaces text when the
 * matched text is typed into it.
 * @see https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing#input-rules
 */
declare function textInputRule(config: {
    find: InputRuleFinder;
    replace: string;
    undoable?: boolean;
}): InputRule;

/**
 * Build an input rule for automatically wrapping a textblock when a
 * given string is typed. When using a regular expresion you’ll
 * probably want the regexp to start with `^`, so that the pattern can
 * only occur at the start of a textblock.
 *
 * `type` is the type of node to wrap in.
 *
 * By default, if there’s a node with the same type above the newly
 * wrapped node, the rule will try to join those
 * two nodes. You can pass a join predicate, which takes a regular
 * expression match and the node before the wrapped node, and can
 * return a boolean to indicate whether a join should happen.
 * @see https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing#input-rules
 */
declare function wrappingInputRule(config: {
    find: InputRuleFinder;
    type: NodeType$1;
    keepMarks?: boolean;
    keepAttributes?: boolean;
    editor?: Editor;
    undoable?: boolean;
    getAttributes?: Record<string, any> | ((match: ExtendedRegExpMatchArray) => Record<string, any>) | false | null;
    joinPredicate?: (match: ExtendedRegExpMatchArray, node: Node$1) => boolean;
}): InputRule;

type Attributes = Record<string, any>;
type DOMOutputSpecElement = 0 | Attributes | DOMOutputSpecArray;
/**
 * Better describes the output of a `renderHTML` function in prosemirror
 * @see https://prosemirror.net/docs/ref/#model.DOMOutputSpec
 */
type DOMOutputSpecArray = [string] | [string, Attributes] | [string, 0] | [string, Attributes, 0] | [string, Attributes, DOMOutputSpecArray | 0] | [string, DOMOutputSpecArray];
type JSXRenderer = (tag: 'slot' | string | ((props?: Attributes) => DOMOutputSpecArray | DOMOutputSpecElement), props?: Attributes, ...children: JSXRenderer[]) => DOMOutputSpecArray | DOMOutputSpecElement;
declare function Fragment(props: {
    children: JSXRenderer[];
}): JSXRenderer[];
declare const h: JSXRenderer;

/**
 * Directions where resize handles can be placed
 *
 * @example
 * - `'top'` - Top edge handle
 * - `'bottom-right'` - Bottom-right corner handle
 */
type ResizableNodeViewDirection = 'top' | 'right' | 'bottom' | 'left' | 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
/**
 * Dimensions for the resizable node in pixels
 */
type ResizableNodeDimensions = {
    /** Width in pixels */
    width: number;
    /** Height in pixels */
    height: number;
};
/**
 * Configuration options for creating a ResizableNodeView
 *
 * @example
 * ```ts
 * new ResizableNodeView({
 *   element: imgElement,
 *   node,
 *   getPos,
 *   onResize: (width, height) => {
 *     imgElement.style.width = `${width}px`
 *     imgElement.style.height = `${height}px`
 *   },
 *   onCommit: (width, height) => {
 *     editor.commands.updateAttributes('image', { width, height })
 *   },
 *   onUpdate: (node) => true,
 *   options: {
 *     directions: ['bottom-right', 'bottom-left'],
 *     min: { width: 100, height: 100 },
 *     preserveAspectRatio: true
 *   }
 * })
 * ```
 */
type ResizableNodeViewOptions = {
    /**
     * The DOM element to make resizable (e.g., an img, video, or iframe element)
     */
    element: HTMLElement;
    /**
     * The DOM element that will hold the editable content element
     */
    contentElement?: HTMLElement;
    /**
     * The ProseMirror node instance
     */
    node: Node$1;
    /**
     * The Tiptap editor instance
     */
    editor: Editor;
    /**
     * Function that returns the current position of the node in the document
     */
    getPos: () => number | undefined;
    /**
     * Callback fired continuously during resize with current dimensions.
     * Use this to update the element's visual size in real-time.
     *
     * @param width - Current width in pixels
     * @param height - Current height in pixels
     *
     * @example
     * ```ts
     * onResize: (width, height) => {
     *   element.style.width = `${width}px`
     *   element.style.height = `${height}px`
     * }
     * ```
     */
    onResize?: (width: number, height: number) => void;
    /**
     * Callback fired once when resize completes with final dimensions.
     * Use this to persist the new size to the node's attributes.
     *
     * @param width - Final width in pixels
     * @param height - Final height in pixels
     *
     * @example
     * ```ts
     * onCommit: (width, height) => {
     *   const pos = getPos()
     *   if (pos !== undefined) {
     *     editor.commands.updateAttributes('image', { width, height })
     *   }
     * }
     * ```
     */
    onCommit: (width: number, height: number) => void;
    /**
     * Callback for handling node updates.
     * Return `true` to accept the update, `false` to reject it.
     *
     * @example
     * ```ts
     * onUpdate: (node, decorations, innerDecorations) => {
     *   if (node.type !== this.node.type) return false
     *   return true
     * }
     * ```
     */
    onUpdate: NodeView$1['update'];
    /**
     * Optional configuration for resize behavior and styling
     */
    options?: {
        /**
         * Which resize handles to display.
         * @default ['bottom-left', 'bottom-right', 'top-left', 'top-right']
         *
         * @example
         * ```ts
         * // Only show corner handles
         * directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right']
         *
         * // Only show right edge handle
         * directions: ['right']
         * ```
         */
        directions?: ResizableNodeViewDirection[];
        /**
         * Minimum dimensions in pixels
         * @default { width: 8, height: 8 }
         *
         * @example
         * ```ts
         * min: { width: 100, height: 50 }
         * ```
         */
        min?: Partial<ResizableNodeDimensions>;
        /**
         * Maximum dimensions in pixels
         * @default undefined (no maximum)
         *
         * @example
         * ```ts
         * max: { width: 1000, height: 800 }
         * ```
         */
        max?: Partial<ResizableNodeDimensions>;
        /**
         * Always preserve aspect ratio when resizing.
         * When `false`, aspect ratio is preserved only when Shift key is pressed.
         * @default false
         *
         * @example
         * ```ts
         * preserveAspectRatio: true // Always lock aspect ratio
         * ```
         */
        preserveAspectRatio?: boolean;
        /**
         * Custom CSS class names for styling
         *
         * @example
         * ```ts
         * className: {
         *   container: 'resize-container',
         *   wrapper: 'resize-wrapper',
         *   handle: 'resize-handle',
         *   resizing: 'is-resizing'
         * }
         * ```
         */
        className?: {
            /** Class for the outer container element */
            container?: string;
            /** Class for the wrapper element that contains the resizable element */
            wrapper?: string;
            /** Class applied to all resize handles */
            handle?: string;
            /** Class added to container while actively resizing */
            resizing?: string;
        };
        /**
         * Optional callback for creating custom resize handle elements.
         *
         * This function allows developers to define their own handle element
         * (e.g., custom icons, classes, or styles) for a given resize direction.
         * It is called internally for each handle direction.
         *
         * @param direction - The direction of the handle being created (e.g., 'top', 'bottom-right').
         * @returns The custom handle HTMLElement.
         *
         * @example
         * ```ts
         * createCustomHandle: (direction) => {
         *   const handle = document.createElement('div')
         *   handle.dataset.resizeHandle = direction
         *   handle.style.position = 'absolute'
         *   handle.className = 'tiptap-custom-handle'
         *
         *   const isTop = direction.includes('top')
         *   const isBottom = direction.includes('bottom')
         *   const isLeft = direction.includes('left')
         *   const isRight = direction.includes('right')
         *
         *   if (isTop) handle.style.top = '0'
         *   if (isBottom) handle.style.bottom = '0'
         *   if (isLeft) handle.style.left = '0'
         *   if (isRight) handle.style.right = '0'
         *
         *   // Edge handles span the full width or height
         *   if (direction === 'top' || direction === 'bottom') {
         *     handle.style.left = '0'
         *     handle.style.right = '0'
         *   }
         *
         *   if (direction === 'left' || direction === 'right') {
         *     handle.style.top = '0'
         *     handle.style.bottom = '0'
         *   }
         *
         *   return handle
         * }
         * ```
         */
        createCustomHandle?: (direction: ResizableNodeViewDirection) => HTMLElement;
    };
};
/**
 * A NodeView implementation that adds resize handles to any DOM element.
 *
 * This class creates a resizable node view for Tiptap/ProseMirror editors.
 * It wraps your element with resize handles and manages the resize interaction,
 * including aspect ratio preservation, min/max constraints, and keyboard modifiers.
 *
 * @example
 * ```ts
 * // Basic usage in a Tiptap extension
 * addNodeView() {
 *   return ({ node, getPos }) => {
 *     const img = document.createElement('img')
 *     img.src = node.attrs.src
 *
 *     return new ResizableNodeView({
 *       element: img,
 *       node,
 *       getPos,
 *       onResize: (width, height) => {
 *         img.style.width = `${width}px`
 *         img.style.height = `${height}px`
 *       },
 *       onCommit: (width, height) => {
 *         this.editor.commands.updateAttributes('image', { width, height })
 *       },
 *       onUpdate: () => true,
 *       options: {
 *         min: { width: 100, height: 100 },
 *         preserveAspectRatio: true
 *       }
 *     })
 *   }
 * }
 * ```
 */
declare class ResizableNodeView {
    /** The ProseMirror node instance */
    node: Node$1;
    /** The Tiptap editor instance */
    editor: Editor;
    /** The DOM element being made resizable */
    element: HTMLElement;
    /** The editable DOM element inside the DOM */
    contentElement?: HTMLElement;
    /** The outer container element (returned as NodeView.dom) */
    container: HTMLElement;
    /** The wrapper element that contains the element and handles */
    wrapper: HTMLElement;
    /** Function to get the current node position */
    getPos: () => number | undefined;
    /** Callback fired during resize */
    onResize?: (width: number, height: number) => void;
    /** Callback fired when resize completes */
    onCommit: (width: number, height: number) => void;
    /** Callback for node updates */
    onUpdate?: NodeView$1['update'];
    /** Active resize handle directions */
    directions: ResizableNodeViewDirection[];
    /** Minimum allowed dimensions */
    minSize: ResizableNodeDimensions;
    /** Maximum allowed dimensions (optional) */
    maxSize?: Partial<ResizableNodeDimensions>;
    /** Whether to always preserve aspect ratio */
    preserveAspectRatio: boolean;
    /** CSS class names for elements */
    classNames: {
        container: string;
        wrapper: string;
        handle: string;
        resizing: string;
    };
    /** Optional callback for creating custom resize handles */
    createCustomHandle?: (direction: ResizableNodeViewDirection) => HTMLElement;
    /** Initial width of the element (for aspect ratio calculation) */
    private initialWidth;
    /** Initial height of the element (for aspect ratio calculation) */
    private initialHeight;
    /** Calculated aspect ratio (width / height) */
    private aspectRatio;
    /** Whether a resize operation is currently active */
    private isResizing;
    /** The handle currently being dragged */
    private activeHandle;
    /** Starting mouse X position when resize began */
    private startX;
    /** Starting mouse Y position when resize began */
    private startY;
    /** Element width when resize began */
    private startWidth;
    /** Element height when resize began */
    private startHeight;
    /** Whether Shift key is currently pressed (for temporary aspect ratio lock) */
    private isShiftKeyPressed;
    /** Last known editable state of the editor */
    private lastEditableState;
    /** Map of handle elements by direction */
    private handleMap;
    /**
     * Creates a new ResizableNodeView instance.
     *
     * The constructor sets up the resize handles, applies initial sizing from
     * node attributes, and configures all resize behavior options.
     *
     * @param options - Configuration options for the resizable node view
     */
    constructor(options: ResizableNodeViewOptions);
    /**
     * Returns the top-level DOM node that should be placed in the editor.
     *
     * This is required by the ProseMirror NodeView interface. The container
     * includes the wrapper, handles, and the actual content element.
     *
     * @returns The container element to be inserted into the editor
     */
    get dom(): HTMLElement;
    get contentDOM(): HTMLElement | null;
    private handleEditorUpdate;
    /**
     * Called when the node's content or attributes change.
     *
     * Updates the internal node reference. If a custom `onUpdate` callback
     * was provided, it will be called to handle additional update logic.
     *
     * @param node - The new/updated node
     * @param decorations - Node decorations
     * @param innerDecorations - Inner decorations
     * @returns `false` if the node type has changed (requires full rebuild), otherwise the result of `onUpdate` or `true`
     */
    update(node: Node$1, decorations: readonly Decoration[], innerDecorations: DecorationSource): boolean;
    /**
     * Cleanup method called when the node view is being removed.
     *
     * Removes all event listeners to prevent memory leaks. This is required
     * by the ProseMirror NodeView interface. If a resize is active when
     * destroy is called, it will be properly cancelled.
     */
    destroy(): void;
    /**
     * Creates the outer container element.
     *
     * The container is the top-level element returned by the NodeView and
     * wraps the entire resizable node. It's set up with flexbox to handle
     * alignment and includes data attributes for styling and identification.
     *
     * @returns The container element
     */
    createContainer(): HTMLDivElement;
    /**
     * Creates the wrapper element that contains the content and handles.
     *
     * The wrapper uses relative positioning so that resize handles can be
     * positioned absolutely within it. This is the direct parent of the
     * content element being made resizable.
     *
     * @returns The wrapper element
     */
    createWrapper(): HTMLDivElement;
    /**
     * Creates a resize handle element for a specific direction.
     *
     * Each handle is absolutely positioned and includes a data attribute
     * identifying its direction for styling purposes.
     *
     * @param direction - The resize direction for this handle
     * @returns The handle element
     */
    private createHandle;
    /**
     * Positions a handle element according to its direction.
     *
     * Corner handles (e.g., 'top-left') are positioned at the intersection
     * of two edges. Edge handles (e.g., 'top') span the full width or height.
     *
     * @param handle - The handle element to position
     * @param direction - The direction determining the position
     */
    private positionHandle;
    /**
     * Creates and attaches all resize handles to the wrapper.
     *
     * Iterates through the configured directions, creates a handle for each,
     * positions it, attaches the mousedown listener, and appends it to the DOM.
     */
    private attachHandles;
    /**
     * Removes all resize handles from the wrapper.
     *
     * Cleans up the handle map and removes each handle element from the DOM.
     */
    private removeHandles;
    /**
     * Applies initial sizing from node attributes to the element.
     *
     * If width/height attributes exist on the node, they're applied to the element.
     * Otherwise, the element's natural/current dimensions are measured. The aspect
     * ratio is calculated for later use in aspect-ratio-preserving resizes.
     */
    private applyInitialSize;
    /**
     * Initiates a resize operation when a handle is clicked.
     *
     * Captures the starting mouse position and element dimensions, sets up
     * the resize state, adds the resizing class and state attribute, and
     * attaches document-level listeners for mouse movement and keyboard input.
     *
     * @param event - The mouse down event
     * @param direction - The direction of the handle being dragged
     */
    private handleResizeStart;
    /**
     * Handles mouse movement during an active resize.
     *
     * Calculates the delta from the starting position, computes new dimensions
     * based on the active handle direction, applies constraints and aspect ratio,
     * then updates the element's style and calls the onResize callback.
     *
     * @param event - The mouse move event
     */
    private handleMouseMove;
    private handleTouchMove;
    private handleResize;
    /**
     * Completes the resize operation when the mouse button is released.
     *
     * Captures final dimensions, calls the onCommit callback to persist changes,
     * removes the resizing state and class, and cleans up document-level listeners.
     */
    private handleMouseUp;
    /**
     * Tracks Shift key state to enable temporary aspect ratio locking.
     *
     * When Shift is pressed during resize, aspect ratio is preserved even if
     * preserveAspectRatio is false.
     *
     * @param event - The keyboard event
     */
    private handleKeyDown;
    /**
     * Tracks Shift key release to disable temporary aspect ratio locking.
     *
     * @param event - The keyboard event
     */
    private handleKeyUp;
    /**
     * Calculates new dimensions based on mouse delta and resize direction.
     *
     * Takes the starting dimensions and applies the mouse movement delta
     * according to the handle direction. For corner handles, both dimensions
     * are affected. For edge handles, only one dimension changes. If aspect
     * ratio should be preserved, delegates to applyAspectRatio.
     *
     * @param direction - The active resize handle direction
     * @param deltaX - Horizontal mouse movement since resize start
     * @param deltaY - Vertical mouse movement since resize start
     * @returns The calculated width and height
     */
    private calculateNewDimensions;
    /**
     * Applies min/max constraints to dimensions.
     *
     * When aspect ratio is NOT preserved, constraints are applied independently
     * to width and height. When aspect ratio IS preserved, constraints are
     * applied while maintaining the aspect ratio—if one dimension hits a limit,
     * the other is recalculated proportionally.
     *
     * This ensures that aspect ratio is never broken when constrained.
     *
     * @param width - The unconstrained width
     * @param height - The unconstrained height
     * @param preserveAspectRatio - Whether to maintain aspect ratio while constraining
     * @returns The constrained dimensions
     */
    private applyConstraints;
    /**
     * Adjusts dimensions to maintain the original aspect ratio.
     *
     * For horizontal handles (left/right), uses width as the primary dimension
     * and calculates height from it. For vertical handles (top/bottom), uses
     * height as primary and calculates width. For corner handles, uses width
     * as the primary dimension.
     *
     * @param width - The new width
     * @param height - The new height
     * @param direction - The active resize direction
     * @returns Dimensions adjusted to preserve aspect ratio
     */
    private applyAspectRatio;
}
/**
 * Alias for ResizableNodeView to maintain consistent naming.
 * @deprecated Use ResizableNodeView instead - will be removed in future versions.
 */
declare const ResizableNodeview: typeof ResizableNodeView;

declare function updateMarkViewAttributes(checkMark: Mark$1, editor: Editor, attrs?: Record<string, any>): void;
declare class MarkView<Component, Options extends MarkViewRendererOptions = MarkViewRendererOptions> {
    component: Component;
    editor: Editor;
    options: Options;
    mark: MarkViewProps['mark'];
    HTMLAttributes: MarkViewProps['HTMLAttributes'];
    constructor(component: Component, props: MarkViewProps, options?: Partial<Options>);
    get dom(): HTMLElement;
    get contentDOM(): HTMLElement | null;
    /**
     * Update the attributes of the mark in the document.
     * @param attrs The attributes to update.
     */
    updateAttributes(attrs: Record<string, any>, checkMark?: Mark$1): void;
    ignoreMutation(mutation: ViewMutationRecord): boolean;
}

/**
 * Node views are used to customize the rendered DOM structure of a node.
 * @see https://tiptap.dev/guide/node-views
 */
declare class NodeView<Component, NodeEditor extends Editor = Editor, Options extends NodeViewRendererOptions = NodeViewRendererOptions> implements NodeView$1 {
    component: Component;
    editor: NodeEditor;
    options: Options;
    extension: NodeViewRendererProps['extension'];
    node: NodeViewRendererProps['node'];
    decorations: NodeViewRendererProps['decorations'];
    innerDecorations: NodeViewRendererProps['innerDecorations'];
    view: NodeViewRendererProps['view'];
    getPos: NodeViewRendererProps['getPos'];
    HTMLAttributes: NodeViewRendererProps['HTMLAttributes'];
    isDragging: boolean;
    constructor(component: Component, props: NodeViewRendererProps, options?: Partial<Options>);
    mount(): void;
    get dom(): HTMLElement;
    get contentDOM(): HTMLElement | null;
    onDragStart(event: DragEvent): void;
    stopEvent(event: Event): boolean;
    /**
     * Called when a DOM [mutation](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver) or a selection change happens within the view.
     * @return `false` if the editor should re-read the selection or re-parse the range around the mutation
     * @return `true` if it can safely be ignored.
     */
    ignoreMutation(mutation: ViewMutationRecord): boolean;
    /**
     * Update the attributes of the prosemirror node.
     */
    updateAttributes(attributes: Record<string, any>): void;
    /**
     * Delete the node.
     */
    deleteNode(): void;
}

/**
 * Build an paste rule that adds a mark when the
 * matched text is pasted into it.
 * @see https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing#paste-rules
 */
declare function markPasteRule(config: {
    find: PasteRuleFinder;
    type: MarkType$1;
    getAttributes?: Record<string, any> | ((match: ExtendedRegExpMatchArray, event: ClipboardEvent) => Record<string, any>) | false | null;
}): PasteRule;

/**
 * Build an paste rule that adds a node when the
 * matched text is pasted into it.
 * @see https://tiptap.dev/docs/editor/api/paste-rules
 */
declare function nodePasteRule(config: {
    find: PasteRuleFinder;
    type: NodeType$1;
    getAttributes?: Record<string, any> | ((match: ExtendedRegExpMatchArray, event: ClipboardEvent) => Record<string, any>) | false | null;
    getContent?: JSONContent[] | ((attrs: Record<string, any>) => JSONContent[]) | false | null;
}): PasteRule;

/**
 * Build an paste rule that replaces text when the
 * matched text is pasted into it.
 * @see https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing#paste-rules
 */
declare function textPasteRule(config: {
    find: PasteRuleFinder;
    replace: string;
}): PasteRule;

interface TrackerResult {
    position: number;
    deleted: boolean;
}
declare class Tracker {
    transaction: Transaction;
    currentStep: number;
    constructor(transaction: Transaction);
    map(position: number): TrackerResult;
}

/**
 * Compare two attribute objects for equality.
 * Handles null/undefined and asserts key presence in both objects so that
 * `{ foo: undefined }` and `{ bar: undefined }` are not treated as equal.
 */
declare function attrsEqual(a: Record<string, any> | null | undefined, b: Record<string, any> | null | undefined): boolean;

/**
 * Optionally calls `value` as a function.
 * Otherwise it is returned directly.
 * @param value Function or any value.
 * @param context Optional context to bind to function.
 * @param props Optional props to pass to function.
 */
declare function callOrReturn<T>(value: T, context?: any, ...props: any[]): MaybeReturnType<T>;

declare function canInsertNode(state: EditorState, nodeType: NodeType$1): boolean;

declare function createStyleTag(style: string, nonce?: string, suffix?: string): HTMLStyleElement;

/**
 * Remove a property or an array of properties from an object
 * @param obj Object
 * @param key Key to remove
 */
declare function deleteProps(obj: Record<string, any>, propOrProps: string | string[]): Record<string, any>;

declare function elementFromString(value: string): HTMLElement;

declare function escapeForRegEx(string: string): string;

/**
 * Find duplicates in an array.
 */
declare function findDuplicates<T>(items: T[]): T[];

declare function fromString(value: any): any;

/**
 * Read a CSS property value directly from an element's raw inline `style`
 * attribute, bypassing the CSSOM (e.g. `element.style.fontFamily`) which
 * canonicalizes values and can change formatting. The original format is
 * preserved (quotes, hex vs rgb, etc.).
 *
 * When a property is declared more than once, the last declaration wins —
 * this matches CSS cascade order and is useful when nested spans are merged
 * and the child's value should take priority.
 *
 * Property name comparison is case-insensitive.
 *
 * @param element - The element whose `style` attribute should be read.
 * @param propertyName - The CSS property name (e.g. `font-family`).
 * @returns The raw value string, or `null` if the property is not present.
 *
 * @example
 * ```ts
 * parseHTML: element => getStyleProperty(element, 'font-family')
 * ```
 */
declare function getStyleProperty(element: HTMLElement, propertyName: string): string | null;

/**
 * Decode common HTML entities in text content so they display as literal
 * characters inside the editor.  The decode order matters: `&amp;` must be
 * decoded **last** so that doubly-encoded sequences like `&amp;lt;` first
 * survive the `&lt;` pass and then correctly become `&lt;` (not `<`).
 */
declare function decodeHtmlEntities(text: string): string;
/**
 * Encode HTML special characters so they roundtrip safely through markdown.
 * `&` is encoded **first** to avoid double-encoding the ampersand in other
 * entities (e.g. `<` → `&lt;`, not `&amp;lt;`).
 *
 * Note: `"` is intentionally NOT encoded here because double quotes are
 * ordinary characters in markdown and do not need escaping.  The decode
 * function still handles `&quot;` because the markdown tokenizer may emit it.
 */
declare function encodeHtmlEntities(text: string): string;

declare function isAndroid(): boolean;

declare function isEmptyObject(value?: {}): boolean;

/**
 * Detects if the current browser is Firefox.
 * @returns `true` if the browser is Firefox, `false` otherwise.
 * @example
 * if (isFirefox()) {
 *   // Firefox-specific handling
 * }
 */
declare function isFirefox(): boolean;

declare function isFunction(value: any): value is Function;

declare function isiOS(): boolean;

declare function isMacOS(): boolean;

declare function isNumber(value: any): value is number;

declare function isPlainObject(value: any): value is Record<string, any>;

declare function isRegExp(value: any): value is RegExp;

/**
 * Detects if the current browser is Safari (but not iOS Safari or Chrome).
 * @returns `true` if the browser is Safari, `false` otherwise.
 * @example
 * if (isSafari()) {
 *   // Safari-specific handling
 * }
 */
declare function isSafari(): boolean;

declare function isString(value: any): value is string;

/**
 * @fileoverview Utility functions for parsing and serializing markdown attributes.
 *
 * These utilities handle the common patterns for parsing attribute strings
 * in various markdown syntaxes like Pandoc attributes.
 */
/**
 * Parses a Pandoc-style attribute string into an object.
 *
 * Supports the following patterns:
 * - Classes: `.className` → `{ class: 'className' }`
 * - IDs: `#myId` → `{ id: 'myId' }`
 * - Key-value pairs: `key="value"` → `{ key: 'value' }`
 * - Boolean attributes: `disabled` → `{ disabled: true }`
 *
 * @param attrString - The attribute string to parse
 * @returns Parsed attributes object
 *
 * @example
 * ```ts
 * parseAttributes('.btn #submit disabled type="button"')
 * // → { class: 'btn', id: 'submit', disabled: true, type: 'button' }
 * ```
 */
declare function parseAttributes(attrString: string): Record<string, any>;
/**
 * Serializes an attributes object back to a Pandoc-style attribute string.
 *
 * @param attributes - The attributes object to serialize
 * @returns Serialized attribute string
 *
 * @example
 * ```ts
 * serializeAttributes({ class: 'btn primary', id: 'submit', disabled: true, type: 'button' })
 * // → '.btn.primary #submit disabled type="button"'
 * ```
 */
declare function serializeAttributes(attributes: Record<string, any>): string;

interface AtomBlockMarkdownSpecOptions {
    /** The Tiptap node name this spec is for */
    nodeName: string;
    /** The markdown syntax name (defaults to nodeName if not provided) */
    name?: string;
    /** Function to parse attributes from token attribute string */
    parseAttributes?: (attrString: string) => Record<string, any>;
    /** Function to serialize attributes back to string for rendering */
    serializeAttributes?: (attrs: Record<string, any>) => string;
    /** Default attributes to apply when parsing */
    defaultAttributes?: Record<string, any>;
    /** Required attributes that must be present for successful parsing */
    requiredAttributes?: string[];
    /** Attributes that are allowed to be rendered back to markdown (whitelist) */
    allowedAttributes?: string[];
}
/**
 * Creates a complete markdown spec for atomic block nodes using Pandoc syntax.
 *
 * The generated spec handles:
 * - Parsing self-closing blocks with `:::blockName {attributes}`
 * - Extracting and parsing attributes
 * - Validating required attributes
 * - Rendering blocks back to markdown
 *
 * @param options - Configuration for the atomic block markdown spec
 * @returns Complete markdown specification object
 *
 * @example
 * ```ts
 * const youtubeSpec = createAtomBlockMarkdownSpec({
 *   nodeName: 'youtube',
 *   requiredAttributes: ['src'],
 *   defaultAttributes: { start: 0 },
 *   allowedAttributes: ['src', 'start', 'width', 'height'] // Only these get rendered to markdown
 * })
 *
 * // Usage in extension:
 * export const Youtube = Node.create({
 *   // ... other config
 *   markdown: youtubeSpec
 * })
 * ```
 */
declare function createAtomBlockMarkdownSpec(options: AtomBlockMarkdownSpecOptions): {
    parseMarkdown: (token: MarkdownToken, h: MarkdownParseHelpers) => MarkdownParseResult;
    markdownTokenizer: MarkdownTokenizer;
    renderMarkdown: (node: JSONContent) => string;
};

interface BlockMarkdownSpecOptions {
    /** The Tiptap node name this spec is for */
    nodeName: string;
    /** The markdown syntax name (defaults to nodeName if not provided) */
    name?: string;
    /** Function to extract content from the node for serialization */
    getContent?: (token: MarkdownToken) => string;
    /** Function to parse attributes from the attribute string */
    parseAttributes?: (attrString: string) => Record<string, any>;
    /** Function to serialize attributes to string */
    serializeAttributes?: (attrs: Record<string, any>) => string;
    /** Default attributes to apply when parsing */
    defaultAttributes?: Record<string, any>;
    /** Content type: 'block' allows paragraphs/lists/etc, 'inline' only allows bold/italic/links/etc */
    content?: 'block' | 'inline';
    /** Allowlist of attributes to include in markdown (if not provided, all attributes are included) */
    allowedAttributes?: string[];
}
/**
 * Creates a complete markdown spec for block-level nodes using Pandoc syntax.
 *
 * The generated spec handles:
 * - Parsing blocks with `:::blockName {attributes}` syntax
 * - Extracting and parsing attributes
 * - Rendering blocks back to markdown with proper formatting
 * - Nested content support
 *
 * @param options - Configuration for the block markdown spec
 * @returns Complete markdown specification object
 *
 * @example
 * ```ts
 * const calloutSpec = createBlockMarkdownSpec({
 *   nodeName: 'callout',
 *   defaultAttributes: { type: 'info' },
 *   allowedAttributes: ['type', 'title'] // Only these get rendered to markdown
 * })
 *
 * // Usage in extension:
 * export const Callout = Node.create({
 *   // ... other config
 *   markdown: calloutSpec
 * })
 * ```
 */
declare function createBlockMarkdownSpec(options: BlockMarkdownSpecOptions): {
    parseMarkdown: (token: MarkdownToken, h: MarkdownParseHelpers) => MarkdownParseResult;
    markdownTokenizer: MarkdownTokenizer;
    renderMarkdown: (node: JSONContent, h: MarkdownRendererHelpers) => string;
};

/**
 * Configuration for an allowed attribute in markdown serialization.
 * Can be a simple string (attribute name) or an object with additional options.
 */
type AllowedAttribute = string | {
    /** The attribute name */
    name: string;
    /**
     * If provided, the attribute will be skipped during serialization when its value
     * equals this default value. This keeps markdown output clean by omitting
     * attributes that have their default values.
     */
    skipIfDefault?: any;
};
interface InlineMarkdownSpecOptions {
    /** The Tiptap node name this spec is for */
    nodeName: string;
    /** The shortcode name (defaults to nodeName if not provided) */
    name?: string;
    /** Function to extract content from the node for serialization */
    getContent?: (node: any) => string;
    /** Function to parse attributes from the attribute string */
    parseAttributes?: (attrString: string) => Record<string, any>;
    /** Function to serialize attributes to string */
    serializeAttributes?: (attrs: Record<string, any>) => string;
    /** Default attributes to apply when parsing */
    defaultAttributes?: Record<string, any>;
    /** Whether this is a self-closing shortcode (no content, like [emoji name=party]) */
    selfClosing?: boolean;
    /**
     * Allowlist of attributes to include in markdown serialization.
     * If not provided, all attributes are included.
     *
     * Each item can be either:
     * - A string: the attribute name (always included if present)
     * - An object: `{ name: string, skipIfDefault?: any }` for conditional inclusion
     *
     * @example
     * // Simple string attributes (backward compatible)
     * allowedAttributes: ['id', 'label']
     *
     * // Mixed with conditional attributes
     * allowedAttributes: [
     *   'id',
     *   'label',
     *   { name: 'mentionSuggestionChar', skipIfDefault: '@' }
     * ]
     */
    allowedAttributes?: AllowedAttribute[];
}
/**
 * Creates a complete markdown spec for inline nodes using attribute syntax.
 *
 * The generated spec handles:
 * - Parsing shortcode syntax with `[nodeName attributes]content[/nodeName]` format
 * - Self-closing shortcodes like `[emoji name=party_popper]`
 * - Extracting and parsing attributes from the opening tag
 * - Rendering inline elements back to shortcode markdown
 * - Supporting both content-based and self-closing inline elements
 *
 * @param options - Configuration for the inline markdown spec
 * @returns Complete markdown specification object
 *
 * @example
 * ```ts
 * // Self-closing mention: [mention id="madonna" label="Madonna"]
 * const mentionSpec = createInlineMarkdownSpec({
 *   nodeName: 'mention',
 *   selfClosing: true,
 *   defaultAttributes: { type: 'user' },
 *   allowedAttributes: ['id', 'label'] // Only these get rendered to markdown
 * })
 *
 * // Self-closing emoji: [emoji name="party_popper"]
 * const emojiSpec = createInlineMarkdownSpec({
 *   nodeName: 'emoji',
 *   selfClosing: true,
 *   allowedAttributes: ['name']
 * })
 *
 * // With content: [highlight color="yellow"]text[/highlight]
 * const highlightSpec = createInlineMarkdownSpec({
 *   nodeName: 'highlight',
 *   selfClosing: false,
 *   allowedAttributes: ['color', 'style']
 * })
 *
 * // Usage in extension:
 * export const Mention = Node.create({
 *   name: 'mention', // Must match nodeName
 *   // ... other config
 *   markdown: mentionSpec
 * })
 * ```
 */
declare function createInlineMarkdownSpec(options: InlineMarkdownSpecOptions): {
    parseMarkdown: (token: MarkdownToken, h: MarkdownParseHelpers) => MarkdownParseResult;
    markdownTokenizer: MarkdownTokenizer;
    renderMarkdown: (node: JSONContent) => string;
};

/**
 * @fileoverview Utility for parsing indented markdown blocks with hierarchical nesting.
 *
 * This utility handles the complex logic of parsing markdown blocks that can contain
 * nested content based on indentation levels, maintaining proper hierarchical structure
 * for lists, task lists, and other indented block types.
 */
interface ParsedBlock {
    type: string;
    raw: string;
    mainContent: string;
    indentLevel: number;
    nestedContent?: string;
    nestedTokens?: any[];
    [key: string]: any;
}
interface BlockParserConfig {
    /** Regex pattern to match block items */
    itemPattern: RegExp;
    /** Function to extract data from regex match */
    extractItemData: (match: RegExpMatchArray) => {
        mainContent: string;
        indentLevel: number;
        [key: string]: any;
    };
    /** Function to create the final token */
    createToken: (data: any, nestedTokens?: any[]) => ParsedBlock;
    /** Base indentation to remove from nested content (default: 2 spaces) */
    baseIndentSize?: number;
    /**
     * Custom parser for nested content. If provided, this will be called instead
     * of the default lexer.blockTokens() for parsing nested content.
     * This allows recursive parsing of the same block type.
     */
    customNestedParser?: (dedentedContent: string) => any[] | undefined;
}
/**
 * Parses markdown text into hierarchical indented blocks with proper nesting.
 *
 * This utility handles:
 * - Line-by-line parsing with pattern matching
 * - Hierarchical nesting based on indentation levels
 * - Nested content collection and parsing
 * - Empty line handling
 * - Content dedenting for nested blocks
 *
 * The key difference from flat parsing is that this maintains the hierarchical
 * structure where nested items become `nestedTokens` of their parent items,
 * rather than being flattened into a single array.
 *
 * @param src - The markdown source text to parse
 * @param config - Configuration object defining how to parse and create tokens
 * @param lexer - Markdown lexer for parsing nested content
 * @returns Parsed result with hierarchical items, or undefined if no matches
 *
 * @example
 * ```ts
 * const result = parseIndentedBlocks(src, {
 *   itemPattern: /^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/,
 *   extractItemData: (match) => ({
 *     indentLevel: match[1].length,
 *     mainContent: match[4],
 *     checked: match[3].toLowerCase() === 'x'
 *   }),
 *   createToken: (data, nestedTokens) => ({
 *     type: 'taskItem',
 *     checked: data.checked,
 *     text: data.mainContent,
 *     nestedTokens
 *   })
 * }, lexer)
 * ```
 */
declare function parseIndentedBlocks(src: string, config: BlockParserConfig, lexer: {
    inlineTokens: (src: string) => any[];
    blockTokens: (src: string) => any[];
}): {
    items: ParsedBlock[];
    raw: string;
} | undefined;

/**
 * @fileoverview Utility functions for rendering nested content in markdown.
 *
 * This module provides reusable utilities for extensions that need to render
 * content with a prefix on the main line and properly indented nested content.
 */
/**
 * Utility function for rendering content with a main line prefix and nested indented content.
 *
 * This function handles the common pattern of rendering content with:
 * 1. A main line with a prefix (like "- " for lists, "> " for blockquotes, etc.)
 * 2. Nested content that gets indented properly
 *
 * @param node - The ProseMirror node representing the content
 * @param h - The markdown renderer helper
 * @param prefixOrGenerator - Either a string prefix or a function that generates the prefix from context
 * @param ctx - Optional context object (used when prefixOrGenerator is a function)
 * @returns The rendered markdown string
 *
 * @example
 * ```ts
 * // For a bullet list item with static prefix
 * return renderNestedMarkdownContent(node, h, '- ')
 *
 * // For a task item with static prefix
 * const prefix = `- [${node.attrs?.checked ? 'x' : ' '}] `
 * return renderNestedMarkdownContent(node, h, prefix)
 *
 * // For a blockquote with static prefix
 * return renderNestedMarkdownContent(node, h, '> ')
 *
 * // For content with dynamic prefix based on context
 * return renderNestedMarkdownContent(node, h, ctx => {
 *   if (ctx.parentType === 'orderedList') {
 *     return `${ctx.index + 1}. `
 *   }
 *   return '- '
 * }, ctx)
 *
 * // Custom extension example
 * const CustomContainer = Node.create({
 *   name: 'customContainer',
 *   // ... other config
 *   markdown: {
 *     render: (node, h) => {
 *       const type = node.attrs?.type || 'info'
 *       return renderNestedMarkdownContent(node, h, `[${type}] `)
 *     }
 *   }
 * })
 * ```
 */
declare function renderNestedMarkdownContent(node: JSONContent, h: {
    renderChildren: (nodes: JSONContent[]) => string;
    renderChild?: (node: JSONContent, index: number) => string;
    indent: (text: string) => string;
}, prefixOrGenerator: string | ((ctx: any) => string), ctx?: any): string;

/**
 * @fileoverview Markdown utilities for creating standardized markdown specs.
 *
 * This module provides utilities for creating complete markdown specifications
 * for different types of nodes using unified syntax patterns.
 */

type index_AllowedAttribute = AllowedAttribute;
type index_AtomBlockMarkdownSpecOptions = AtomBlockMarkdownSpecOptions;
type index_BlockMarkdownSpecOptions = BlockMarkdownSpecOptions;
type index_BlockParserConfig = BlockParserConfig;
type index_InlineMarkdownSpecOptions = InlineMarkdownSpecOptions;
type index_ParsedBlock = ParsedBlock;
declare const index_createAtomBlockMarkdownSpec: typeof createAtomBlockMarkdownSpec;
declare const index_createBlockMarkdownSpec: typeof createBlockMarkdownSpec;
declare const index_createInlineMarkdownSpec: typeof createInlineMarkdownSpec;
declare const index_parseAttributes: typeof parseAttributes;
declare const index_parseIndentedBlocks: typeof parseIndentedBlocks;
declare const index_renderNestedMarkdownContent: typeof renderNestedMarkdownContent;
declare const index_serializeAttributes: typeof serializeAttributes;
declare namespace index {
  export { type index_AllowedAttribute as AllowedAttribute, type index_AtomBlockMarkdownSpecOptions as AtomBlockMarkdownSpecOptions, type index_BlockMarkdownSpecOptions as BlockMarkdownSpecOptions, type index_BlockParserConfig as BlockParserConfig, type index_InlineMarkdownSpecOptions as InlineMarkdownSpecOptions, type index_ParsedBlock as ParsedBlock, index_createAtomBlockMarkdownSpec as createAtomBlockMarkdownSpec, index_createBlockMarkdownSpec as createBlockMarkdownSpec, index_createInlineMarkdownSpec as createInlineMarkdownSpec, index_parseAttributes as parseAttributes, index_parseIndentedBlocks as parseIndentedBlocks, index_renderNestedMarkdownContent as renderNestedMarkdownContent, index_serializeAttributes as serializeAttributes };
}

/**
 * Shape accepted by marksEqual, works with both JSONContent marks
 * (`{ type: 'bold' }`) and ProseMirror Mark objects (`{ type: MarkType }`).
 */
type MarkLike = {
    type: string | {
        name: string;
    };
    attrs?: Record<string, any> | null;
};
/**
 * Compare two arrays of mark objects for equality (order-insensitive).
 * Marks are matched by type name and attributes (via attrsEqual),
 * so key ordering in attrs does not matter, nor does mark array order.
 */
declare function marksEqual(a: readonly MarkLike[], b: readonly MarkLike[]): boolean;

declare function mergeAttributes(...objects: Record<string, any>[]): Record<string, any>;

declare function mergeDeep(target: Record<string, any>, source: Record<string, any>): Record<string, any>;

declare function minMax(value?: number, min?: number, max?: number): number;

/**
 * Check if object1 includes object2
 * @param object1 Object
 * @param object2 Object
 */
declare function objectIncludes(object1: Record<string, any>, object2: Record<string, any>, options?: {
    strict: boolean;
}): boolean;

/**
 * Removes duplicated values within an array.
 * Supports numbers, strings and objects.
 */
declare function removeDuplicates<T>(array: T[], by?: {
    (value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string;
    (value: any, replacer?: (number | string)[] | null, space?: string | number): string;
}): T[];

export { type AllowedAttribute, type AnyCommands, type AnyConfig, type AnyExtension, type AtomBlockMarkdownSpecOptions, type Attribute, type Attributes$1 as Attributes, type BlockMarkdownSpecOptions, type BlockParserConfig, type CanCommands, type ChainedCommands, type ChangedRange, type Command, CommandManager, type CommandProps, type CommandSpec, type Commands$1 as Commands, type Content, type CreateNodeFromContentOptions, type DOMNode, type DOMOutputSpecArray$1 as DOMOutputSpecArray, type DecorationType, type DecorationWithType, type Diff, type Dispatch, type DispatchTransactionProps, type DocumentType, Editor, type EditorEvents, type EditorOptions, type EnableRules, Extendable, type ExtendableConfig, type ExtendedRegExpMatchArray, Extension, type ExtensionAttribute, type ExtensionConfig, type Extensions, type FocusPosition, Fragment, type FullMarkdownHelpers, type GetUpdatedPositionResult, type GlobalAttributes, type HTMLContent, type InlineMarkdownSpecOptions, InputRule, type InputRuleFinder, type InputRuleMatch, type InsertContentAtOptions, type InsertContentOptions, type JSONContent, type KeyboardShortcutCommand, type KeysWithTypeOf, MappablePosition, Mark, type MarkConfig, type MarkLike, type MarkRange, type MarkType, MarkView, type MarkViewProps, type MarkViewRenderer, type MarkViewRendererOptions, type MarkViewRendererProps, type MarkdownExtensionSpec, type MarkdownHelpers, type MarkdownLexerConfiguration, type MarkdownParseHelpers, type MarkdownParseResult, type MarkdownRendererHelpers, type MarkdownToken, type MarkdownTokenizer, type MaybeReturnType, type MaybeThisParameterType, Node, type NodeConfig, NodePos, type NodeRange, type NodeType, NodeView, type NodeViewProps, type NodeViewRenderer, type NodeViewRendererOptions, type NodeViewRendererProps, type NodeWithPos, type Overwrite, type ParentConfig, type ParsedBlock, PasteRule, type PasteRuleFinder, type PasteRuleMatch, type PickValue, type Predicate, type Primitive, type Range, type RawCommands, type RemoveThis, type RenderContext, type ResizableNodeDimensions, ResizableNodeView, type ResizableNodeViewDirection, type ResizableNodeViewOptions, ResizableNodeview, type SetContentOptions, type SingleCommands, type Storage, type TextSerializer, type TextType, type TiptapEditorHTMLElement, Tracker, type TrackerResult, type UnionCommands, type UnionToIntersection, type Utils, type ValuesOf, attrsEqual, blur, callOrReturn, canInsertNode, clearContent, clearNodes, combineTransactionSteps, command, index$2 as commands, createAtomBlockMarkdownSpec, createBlockMarkdownSpec, createChainableState, createDocument, h as createElement, createInlineMarkdownSpec, createMappablePosition, createNodeFromContent, createParagraphNear, createStyleTag, cut, decodeHtmlEntities, defaultBlockAt, deleteCurrentNode, deleteNode, deleteProps, deleteRange, deleteSelection, elementFromString, encodeHtmlEntities, enter, escapeForRegEx, exitCode, extendMarkRange, index$1 as extensions, findChildren, findChildrenInRange, findDuplicates, findParentNode, findParentNodeClosestToPos, first, flattenExtensions, focus, forEach, fromString, generateHTML, generateJSON, generateText, getAttributes, getAttributesFromExtensions, getChangedRanges, getDebugJSON, getExtensionField, getHTMLFromFragment, getMarkAttributes, getMarkRange, getMarkType, getMarksBetween, getNodeAtPosition, getNodeAttributes, getNodeType, getRenderedAttributes, getSchema, getSchemaByResolvedExtensions, getSchemaTypeByName, getSchemaTypeNameByName, getSplittedAttributes, getStyleProperty, getText, getTextBetween, getTextContentFromNodes, getTextSerializersFromSchema, getUpdatedPosition, h, injectExtensionAttributesToParseRule, inputRulesPlugin, insertContent, insertContentAt, isActive, isAndroid, isAtEndOfNode, isAtStartOfNode, isEmptyObject, isExtensionRulesEnabled, isFirefox, isFunction, isList, isMacOS, isMarkActive, isNodeActive, isNodeEmpty, isNodeSelection, isNodeViewSelected, isNumber, isPlainObject, isRegExp, isSafari, isString, isTextSelection, isiOS, joinBackward, joinDown, joinForward, joinItemBackward, joinItemForward, joinTextblockBackward, joinTextblockForward, joinUp, keyboardShortcut, lift, liftEmptyBlock, liftListItem, markInputRule, markPasteRule, index as markdown, marksEqual, mergeAttributes, mergeDeep, minMax, newlineInCode, nodeInputRule, nodePasteRule, objectIncludes, parseAttributes, parseIndentedBlocks, pasteRulesPlugin, posToDOMRect, removeDuplicates, renderNestedMarkdownContent, resetAttributes, resolveExtensions, resolveFocusPosition, rewriteUnknownContent, scrollIntoView, selectAll, selectNodeBackward, selectNodeForward, selectParentNode, selectTextblockEnd, selectTextblockStart, selectionToInsertionEnd, serializeAttributes, setContent, setMark, setMeta, setNode, setNodeSelection, setTextDirection, setTextSelection, sinkListItem, sortExtensions, splitBlock, splitExtensions, splitListItem, textInputRule, textPasteRule, textblockTypeInputRule, toggleList, toggleMark, toggleNode, toggleWrap, undoInputRule, unsetAllMarks, unsetMark, unsetTextDirection, updateAttributes, updateMarkViewAttributes, wrapIn, wrapInList, wrappingInputRule };
