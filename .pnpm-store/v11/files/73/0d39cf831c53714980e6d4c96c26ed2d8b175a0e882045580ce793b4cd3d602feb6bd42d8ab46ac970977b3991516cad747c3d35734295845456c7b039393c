import { Mark } from '@tiptap/core';

interface LinkProtocolOptions {
    /**
     * The protocol scheme to be registered.
     * @default '''
     * @example 'ftp'
     * @example 'git'
     */
    scheme: string;
    /**
     * If enabled, it allows optional slashes after the protocol.
     * @default false
     * @example true
     */
    optionalSlashes?: boolean;
}
declare const pasteRegex: RegExp;
/**
 * @deprecated The default behavior is now to open links when the editor is not editable.
 */
type DeprecatedOpenWhenNotEditable = 'whenNotEditable';
interface LinkOptions {
    /**
     * If enabled, the extension will automatically add links as you type.
     * @default true
     * @example false
     */
    autolink: boolean;
    /**
     * An array of custom protocols to be registered with linkifyjs.
     * @default []
     * @example ['ftp', 'git']
     */
    protocols: Array<LinkProtocolOptions | string>;
    /**
     * Default protocol to use when no protocol is specified.
     * @default 'http'
     */
    defaultProtocol: string;
    /**
     * If enabled, links will be opened on click.
     * @default true
     * @example false
     */
    openOnClick: boolean | DeprecatedOpenWhenNotEditable;
    /**
     * If enabled, the link will be selected when clicked.
     * @default false
     * @example true
     */
    enableClickSelection: boolean;
    /**
     * Adds a link to the current selection if the pasted content only contains an url.
     * @default true
     * @example false
     */
    linkOnPaste: boolean;
    /**
     * HTML attributes to add to the link element.
     * @default {}
     * @example { class: 'foo' }
     */
    HTMLAttributes: Record<string, any>;
    /**
     * @deprecated Use the `shouldAutoLink` option instead.
     * A validation function that modifies link verification for the auto linker.
     * @param url - The url to be validated.
     * @returns - True if the url is valid, false otherwise.
     */
    validate: (url: string) => boolean;
    /**
     * A validation function which is used for configuring link verification for preventing XSS attacks.
     * Only modify this if you know what you're doing.
     *
     * @returns {boolean} `true` if the URL is valid, `false` otherwise.
     *
     * @example
     * isAllowedUri: (url, { defaultValidate, protocols, defaultProtocol }) => {
     * return url.startsWith('./') || defaultValidate(url)
     * }
     */
    isAllowedUri: (
    /**
     * The URL to be validated.
     */
    url: string, ctx: {
        /**
         * The default validation function.
         */
        defaultValidate: (url: string) => boolean;
        /**
         * An array of allowed protocols for the URL (e.g., "http", "https"). As defined in the `protocols` option.
         */
        protocols: Array<LinkProtocolOptions | string>;
        /**
         * A string that represents the default protocol (e.g., 'http'). As defined in the `defaultProtocol` option.
         */
        defaultProtocol: string;
    }) => boolean;
    /**
     * Determines whether a valid link should be automatically linked in the content.
     *
     * @param {string} url - The URL that has already been validated.
     * @returns {boolean} - True if the link should be auto-linked; false if it should not be auto-linked.
     */
    shouldAutoLink: (url: string) => boolean;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        link: {
            /**
             * Set a link mark
             * @param attributes The link attributes
             * @example editor.commands.setLink({ href: 'https://tiptap.dev' })
             */
            setLink: (attributes: {
                href: string;
                target?: string | null;
                rel?: string | null;
                class?: string | null;
                title?: string | null;
            }) => ReturnType;
            /**
             * Toggle a link mark
             * @param attributes The link attributes
             * @example editor.commands.toggleLink({ href: 'https://tiptap.dev' })
             */
            toggleLink: (attributes?: {
                href: string;
                target?: string | null;
                rel?: string | null;
                class?: string | null;
                title?: string | null;
            }) => ReturnType;
            /**
             * Unset a link mark
             * @example editor.commands.unsetLink()
             */
            unsetLink: () => ReturnType;
        };
    }
}
declare function isAllowedUri(uri: string | undefined, protocols?: LinkOptions['protocols']): true | RegExpMatchArray | null;
/**
 * This extension allows you to create links.
 * @see https://www.tiptap.dev/api/marks/link
 */
declare const Link: Mark<LinkOptions, any>;

export { Link, type LinkOptions, type LinkProtocolOptions, Link as default, isAllowedUri, pasteRegex };
