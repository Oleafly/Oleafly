"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const emscripten_wasm_loader_1 = require("emscripten-wasm-loader");
const nanoid = require("nanoid");
const logger_1 = require("./util/logger");
const wrapHunspellInterface_1 = require("./wrapHunspellInterface");
/**
 * Creates a factory function for mounting files into wasm filesystem
 * and creating hunspell instance.
 *
 * @param {HunspellAsmModule} asmModule wasm / asm module loaded into memory.
 *
 * @return {HunspellFactory} factory function for mounting files and creating hunspell instance.
 */
/** @internal */
exports.hunspellLoader = (asmModule) => {
    const { cwrap, FS, _free, allocateUTF8, _malloc, getValue, UTF8ToString } = asmModule;
    const hunspellInterface = wrapHunspellInterface_1.wrapHunspellInterface(cwrap);
    //creating top-level path to mount files
    const memPathId = `/${nanoid(45)}`;
    FS.mkdir(memPathId);
    logger_1.log(`hunspellLoader: mount path for bufferFile created at ${memPathId}`);
    /**
     * Naive auto-dispose interface to call hunspell interface with string params.
     *
     */
    const usingParamPtr = (...args) => {
        const params = [...args];
        const fn = params.pop();
        //https://mathiasbynens.be/notes/javascript-unicode
        const paramsPtr = params.map((param) => allocateUTF8(param.normalize()));
        const ret = fn(...paramsPtr);
        paramsPtr.forEach(paramPtr => _free(paramPtr));
        return ret;
    };
    return {
        mountBuffer: emscripten_wasm_loader_1.mountBuffer(FS, memPathId),
        unmount: emscripten_wasm_loader_1.unmount(FS, memPathId),
        create: (affPath, dictPath) => {
            const affPathPtr = allocateUTF8(affPath);
            const dictPathPtr = allocateUTF8(dictPath);
            const hunspellPtr = hunspellInterface.create(affPathPtr, dictPathPtr);
            return {
                dispose: () => {
                    hunspellInterface.destroy(hunspellPtr);
                    _free(affPathPtr);
                    _free(dictPathPtr);
                },
                spell: (word) => !!usingParamPtr(word, wordPtr => hunspellInterface.spell(hunspellPtr, wordPtr)),
                suggest: (word) => {
                    const suggestionListPtr = _malloc(4);
                    const suggestionCount = usingParamPtr(word, wordPtr => hunspellInterface.suggest(hunspellPtr, suggestionListPtr, wordPtr));
                    const suggestionListValuePtr = getValue(suggestionListPtr, '*');
                    const ret = suggestionCount > 0
                        ? Array.from(Array(suggestionCount).keys()).map(idx => UTF8ToString(getValue(suggestionListValuePtr + idx * 4, '*')))
                        : [];
                    hunspellInterface.free_list(hunspellPtr, suggestionListPtr, suggestionCount);
                    _free(suggestionListPtr);
                    return ret;
                },
                addDictionary: (dictPath) => usingParamPtr(dictPath, dictPathPtr => hunspellInterface.add_dic(hunspellPtr, dictPathPtr)) === 1
                    ? false
                    : true,
                addWord: (word) => usingParamPtr(word, wordPtr => hunspellInterface.add(hunspellPtr, wordPtr)),
                addWordWithAffix: (word, affix) => usingParamPtr(word, affix, (wordPtr, affixPtr) => hunspellInterface.add_with_affix(hunspellPtr, wordPtr, affixPtr)),
                removeWord: (word) => usingParamPtr(word, wordPtr => hunspellInterface.remove(hunspellPtr, wordPtr))
            };
        }
    };
};
//# sourceMappingURL=hunspellLoader.js.map