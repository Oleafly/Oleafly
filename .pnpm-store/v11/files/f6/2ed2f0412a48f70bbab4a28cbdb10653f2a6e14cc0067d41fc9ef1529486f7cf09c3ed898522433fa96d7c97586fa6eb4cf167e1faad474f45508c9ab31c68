import { cwrapSignature } from 'emscripten-wasm-loader';

/**
 * Wrap hunspell exported interfaces via cwrap for resuable mannter.
 *
 */
/** @internal */
export const wrapHunspellInterface = (cwrap: cwrapSignature) => ({
  //Hunhandle* Hunspell_create(const char* affpath, const char* dpath)
  create: cwrap<(affPath: number, dicPath: number) => number>('Hunspell_create', 'number', ['number', 'number']),
  //void Hunspell_destroy(Hunhandle* pHunspell)
  destroy: cwrap<(hunspellPtr: number) => void>('Hunspell_destroy', null, ['number']),
  //int Hunspell_spell(Hunhandle* pHunspell, const char*)
  spell: cwrap<(hunspellPtr: number, value: number) => number>('Hunspell_spell', 'number', ['number', 'number']),
  //int Hunspell_suggest(Hunhandle* pHunspell, char*** slst, const char* word);
  suggest: cwrap<(hunspellPtr: number, outSuggestionListPtr: number, value: number) => number>(
    'Hunspell_suggest',
    'number',
    ['number', 'number', 'number']
  ),
  //void Hunspell_free_list(Hunhandle* pHunspell, char*** slst, int n);
  free_list: cwrap<(hunspellPtr: number, suggestionListPtr: number, count: number) => void>(
    'Hunspell_free_list',
    null,
    ['number', 'number', 'number']
  ),
  //0 = additional dictionary slots available, 1 = slots are now full
  //int Hunspell_add_dic(Hunhandle* pHunspell, const char* dpath);
  add_dic: cwrap<(hunspellPtr: number, dicPath: number) => number>('Hunspell_add_dic', 'number', ['number', 'number']),
  //int Hunspell_add(Hunhandle* pHunspell, const char* word);
  add: cwrap<(hunspellPtr: number, value: number) => number>('Hunspell_add', 'number', ['number', 'number']),
  //int Hunspell_add_with_affix(Hunhandle* pHunspell, const char* word, const char* example);
  add_with_affix: cwrap<(hunspellPtr: number, value: number, affix: number) => number>(
    'Hunspell_add_with_affix',
    'number',
    ['number', 'number', 'number']
  ),
  //int Hunspell_remove(Hunhandle* pHunspell, const char* word);
  remove: cwrap<(hunspellPtr: number, value: number) => number>('Hunspell_remove', 'number', ['number', 'number'])
});
