import { Extension } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';

interface CharacterCountOptions {
    /**
     * The maximum number of characters that should be allowed. Defaults to `0`.
     * @default null
     * @example 180
     */
    limit: number | null | undefined;
    /**
     * The mode by which the size is calculated. If set to `textSize`, the textContent of the document is used.
     * If set to `nodeSize`, the nodeSize of the document is used.
     * @default 'textSize'
     * @example 'textSize'
     */
    mode: 'textSize' | 'nodeSize';
    /**
     * Sets whether the content will be automatically trimmed when programatically setting content over the limit.
     * If set to false, the user will be able to trim the text manually.
     * @default true
     * @example false
     */
    autoTrim?: boolean;
    /**
     * The text counter function to use. Defaults to a simple character count.
     * @default (text) => text.length
     * @example (text) => [...new Intl.Segmenter().segment(text)].length
     */
    textCounter: (text: string) => number;
    /**
     * The word counter function to use. Defaults to a simple word count.
     * @default (text) => text.split(' ').filter(word => word !== '').length
     * @example (text) => text.split(/\s+/).filter(word => word !== '').length
     */
    wordCounter: (text: string) => number;
}
interface CharacterCountStorage {
    /**
     * Get the number of characters for the current document.
     * @param options The options for the character count. (optional)
     * @param options.node The node to get the characters from. Defaults to the current document.
     * @param options.mode The mode by which the size is calculated. If set to `textSize`, the textContent of the document is used.
     */
    characters: (options?: {
        node?: Node;
        mode?: 'textSize' | 'nodeSize';
    }) => number;
    /**
     * Get the number of words for the current document.
     * @param options The options for the character count. (optional)
     * @param options.node The node to get the words from. Defaults to the current document.
     */
    words: (options?: {
        node?: Node;
    }) => number;
}
declare module '@tiptap/core' {
    interface Storage {
        characterCount: CharacterCountStorage;
    }
}
/**
 * This extension allows you to count the characters and words of your document.
 * @see https://tiptap.dev/api/extensions/character-count
 */
declare const CharacterCount: Extension<CharacterCountOptions, CharacterCountStorage>;

export { CharacterCount, type CharacterCountOptions, type CharacterCountStorage };
