"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Wrap hunspell exported interfaces via cwrap for resuable mannter.
 *
 */
/** @internal */
exports.wrapHunspellInterface = (cwrap) => ({
    //Hunhandle* Hunspell_create(const char* affpath, const char* dpath)
    create: cwrap('Hunspell_create', 'number', ['number', 'number']),
    //void Hunspell_destroy(Hunhandle* pHunspell)
    destroy: cwrap('Hunspell_destroy', null, ['number']),
    //int Hunspell_spell(Hunhandle* pHunspell, const char*)
    spell: cwrap('Hunspell_spell', 'number', ['number', 'number']),
    //int Hunspell_suggest(Hunhandle* pHunspell, char*** slst, const char* word);
    suggest: cwrap('Hunspell_suggest', 'number', ['number', 'number', 'number']),
    //void Hunspell_free_list(Hunhandle* pHunspell, char*** slst, int n);
    free_list: cwrap('Hunspell_free_list', null, ['number', 'number', 'number']),
    //0 = additional dictionary slots available, 1 = slots are now full
    //int Hunspell_add_dic(Hunhandle* pHunspell, const char* dpath);
    add_dic: cwrap('Hunspell_add_dic', 'number', ['number', 'number']),
    //int Hunspell_add(Hunhandle* pHunspell, const char* word);
    add: cwrap('Hunspell_add', 'number', ['number', 'number']),
    //int Hunspell_add_with_affix(Hunhandle* pHunspell, const char* word, const char* example);
    add_with_affix: cwrap('Hunspell_add_with_affix', 'number', ['number', 'number', 'number']),
    //int Hunspell_remove(Hunhandle* pHunspell, const char* word);
    remove: cwrap('Hunspell_remove', 'number', ['number', 'number'])
});
//# sourceMappingURL=wrapHunspellInterface.js.map