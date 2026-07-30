import { cwrapSignature } from 'emscripten-wasm-loader';
/**
 * Wrap hunspell exported interfaces via cwrap for resuable mannter.
 *
 */
/** @internal */
export declare const wrapHunspellInterface: (cwrap: cwrapSignature) => {
    create: (affPath: number, dicPath: number) => number;
    destroy: (hunspellPtr: number) => void;
    spell: (hunspellPtr: number, value: number) => number;
    suggest: (hunspellPtr: number, outSuggestionListPtr: number, value: number) => number;
    free_list: (hunspellPtr: number, suggestionListPtr: number, count: number) => void;
    add_dic: (hunspellPtr: number, dicPath: number) => number;
    add: (hunspellPtr: number, value: number) => number;
    add_with_affix: (hunspellPtr: number, value: number, affix: number) => number;
    remove: (hunspellPtr: number, value: number) => number;
};
//# sourceMappingURL=wrapHunspellInterface.d.ts.map