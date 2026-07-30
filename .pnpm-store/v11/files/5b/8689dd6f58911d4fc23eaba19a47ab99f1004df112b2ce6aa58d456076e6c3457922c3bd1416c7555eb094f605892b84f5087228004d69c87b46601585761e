import { mountBuffer, unmount } from 'emscripten-wasm-loader';
import * as nanoid from 'nanoid';
import { HunspellAsmModule } from './HunspellAsmModule';
import { HunspellFactory } from './HunspellFactory';
import { log } from './util/logger';
import { wrapHunspellInterface } from './wrapHunspellInterface';

/**
 * Creates a factory function for mounting files into wasm filesystem
 * and creating hunspell instance.
 *
 * @param {HunspellAsmModule} asmModule wasm / asm module loaded into memory.
 *
 * @return {HunspellFactory} factory function for mounting files and creating hunspell instance.
 */

/** @internal */
export const hunspellLoader = (asmModule: HunspellAsmModule): HunspellFactory => {
  const { cwrap, FS, _free, allocateUTF8, _malloc, getValue, UTF8ToString } = asmModule;
  const hunspellInterface = wrapHunspellInterface(cwrap);

  //creating top-level path to mount files
  const memPathId = `/${nanoid(45)}`;
  FS.mkdir(memPathId);
  log(`hunspellLoader: mount path for bufferFile created at ${memPathId}`);

  /**
   * Naive auto-dispose interface to call hunspell interface with string params.
   *
   */
  const usingParamPtr = <T = void>(...args: Array<string | ((...args: Array<number>) => T)>): T => {
    const params = [...args];
    const fn = params.pop()!;
    //https://mathiasbynens.be/notes/javascript-unicode
    const paramsPtr = params.map((param: string) => allocateUTF8(param.normalize()));
    const ret = (fn as Function)(...paramsPtr);
    paramsPtr.forEach(paramPtr => _free(paramPtr));
    return ret;
  };

  return {
    mountBuffer: mountBuffer(FS, memPathId),
    unmount: unmount(FS, memPathId),
    create: (affPath: string, dictPath: string) => {
      const affPathPtr = allocateUTF8(affPath);
      const dictPathPtr = allocateUTF8(dictPath);
      const hunspellPtr = hunspellInterface.create(affPathPtr, dictPathPtr);

      return {
        dispose: () => {
          hunspellInterface.destroy(hunspellPtr);
          _free(affPathPtr);
          _free(dictPathPtr);
        },
        spell: (word: string) => !!usingParamPtr(word, wordPtr => hunspellInterface.spell(hunspellPtr, wordPtr)),
        suggest: (word: string) => {
          const suggestionListPtr = _malloc(4);
          const suggestionCount = usingParamPtr(word, wordPtr =>
            hunspellInterface.suggest(hunspellPtr, suggestionListPtr, wordPtr)
          );
          const suggestionListValuePtr = getValue(suggestionListPtr, '*');

          const ret =
            suggestionCount > 0
              ? Array.from(Array(suggestionCount).keys()).map(idx =>
                  UTF8ToString(getValue(suggestionListValuePtr + idx * 4, '*'))
                )
              : [];

          hunspellInterface.free_list(hunspellPtr, suggestionListPtr, suggestionCount);

          _free(suggestionListPtr);
          return ret;
        },
        addDictionary: (dictPath: string) =>
          usingParamPtr(dictPath, dictPathPtr => hunspellInterface.add_dic(hunspellPtr, dictPathPtr)) === 1
            ? false
            : true,
        addWord: (word: string) => usingParamPtr(word, wordPtr => hunspellInterface.add(hunspellPtr, wordPtr)),
        addWordWithAffix: (word: string, affix: string) =>
          usingParamPtr(word, affix, (wordPtr, affixPtr) =>
            hunspellInterface.add_with_affix(hunspellPtr, wordPtr, affixPtr)
          ),
        removeWord: (word: string) => usingParamPtr(word, wordPtr => hunspellInterface.remove(hunspellPtr, wordPtr))
      };
    }
  };
};
