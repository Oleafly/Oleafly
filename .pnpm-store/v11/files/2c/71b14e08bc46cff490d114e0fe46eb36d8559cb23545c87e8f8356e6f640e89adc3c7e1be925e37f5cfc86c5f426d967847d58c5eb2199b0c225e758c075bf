[![Build Status](https://travis-ci.org/kwonoj/hunspell-asm.svg?branch=master)](https://travis-ci.org/kwonoj/hunspell-asm)
[![Build status](https://ci.appveyor.com/api/projects/status/7s0r599r9h6r682g?svg=true)](https://ci.appveyor.com/project/kwonoj/hunspell-asm)
[![codecov](https://codecov.io/gh/kwonoj/hunspell-asm/branch/master/graph/badge.svg)](https://codecov.io/gh/kwonoj/hunspell-asm)
[![npm](https://img.shields.io/npm/v/hunspell-asm.svg)](https://www.npmjs.com/package/hunspell-asm)
[![node](https://img.shields.io/badge/node-=>10.0-blue.svg?style=flat)](https://www.npmjs.com/package/hunspell-asm)

# Hunspell-asm

`Hunspell-asm` is isomorphic javascript binding to [hunspell](https://github.com/hunspell/hunspell) spellchecker based on WebAssembly hunspell binary. This module aims to provide thin, lightweight interface to hunspell without requiring native modules.

# Install

```sh
npm install hunspell-asm
```

# Usage

## Loading module asynchronously

`Hunspell-asm` relies on wasm binary of hunspell, which need to be initialized first.

```js
import { loadModule } from 'hunspell-asm';

const hunspellFactory = await loadModule();
```

`loadModule` loads wasm binary, initialize it, and returns factory function to create instance of hunspell.

```js
loadModule({ timeout?: number }): Promise<HunspellFactory>
```

It allows to specify timeout to wait until wasm binary compliation & load.

## Mounting files

Wasm binary uses different memory spaces allocated for its own and cannot access plain javascript object / or files directly. `HunspellFactory` provides few interfaces to interop file contents into hunspell.

- `mountBuffer(contents: ArrayBufferView, fileName?: string): string` : Mount contents of file.
- `unmount(mountedFilePath: string)` : Unmount path if it's exists in memory. If it's bufferFile created by `mountBuffer`, unmount will remove those file object in wasm memory as well.

All of `virtual` paths for mounted filesystem uses unix separator regardless of platform.

## Creating spellchecker

Once you mounted dic / aff files you can create hunspell spellchecker instance via `HunspellFactory::create`. Each path for files are mounted path and should not be actual path or server endpoint.

```js
create(affPath: string, dictPath: string): Hunspell
```

`Hunspell` exposes minimal interfaces to spellchecker.

- `spell(word: string): boolean` : Check spelling for word. False for misspelled, True otherwise.
- `suggest(word: string): Array<string>` : Get suggestion list for misspelled word. Empty if word is not misspelled or no suggestions.
- `dispose(): void` : Destroy current instance of hunspell. It is important to note created instance of hunspell will not be destroyed automatically.

There are simple [examples](https://github.com/kwonoj/hunspell-asm/tree/e0e421fda667fb0d4888a4e0b21877e95540c29c/examples) for each environments using different apis. In each example directory do `npm install && npm start`.

## Adding words to dictionary in runtime

Hunspell exposes few interfaces allow to add words, or dictionaries in existing dictionary in runtime. This is **runtime** behavior, so it doesn't persist over once instance is disposed.

- `addWord(word: string): void` : add single word to current dictionary.
- `removeWord(word: string): void` : remove single word from current dictionary.
- `addWordWithAffix(word: string, affix: string): void`: add word with example word having affix flag to be applied. Second param `affix` is example word, should exists in current dictionary with its own affix flag. Newly added word will have same affix rule as example word.
- `addDictionary(dictPath): boolean` : Load addtional dictionary into existing hunspell instance. This cannot load additional affi
x. If function returns false, it means internal slot hunspell manages are full and can't add additional dictionaries.

## Things to note

- Ensure all inputs (aff, dic, word for spell / suggest) are UTF-8 encoded correctly. While hunspell itself supports other encodings, all surrounding interfaces passing buffers are plain javascript doesn't detect / converts encodings automatically.

# Building / Testing

Few npm scripts are supported for build / test code.

- `build`: Transpiles code to ES5 commonjs to `dist`.
- `test`: Run `hunspell` / `hunspell-asm` test both. Does not require `build` before execute test.
- `test:hunspell`: Run integration test for actual hunspell wasm binary, using [hunspell's test case](https://github.com/hunspell/hunspell/tree/97d7d559f621176685695fbd51e5d8d3f9e005e3/tests) as-is.
- `test:hunspell-asm`: Run unit test against `hunspell-asm` interface
- `lint`: Run lint over all codebases
- `lint:staged`: Run lint only for staged changes. This'll be executed automatically with precommit hook.
- `commit`: Commit wizard to write commit message

# License

- Hunspell: [original license](https://github.com/hunspell/hunspell/blob/master/license.hunspell)
- Hunspell-asm: [MIT](https://github.com/kwonoj/hunspell-asm/blob/master/LICENSE)
