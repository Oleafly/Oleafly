[![Build Status](https://travis-ci.org/kwonoj/emscripten-wasm-loader.svg?branch=master)](https://travis-ci.org/kwonoj/emscripten-wasm-loader)
[![Build status](https://ci.appveyor.com/api/projects/status/la7qsyfmoekernj7/branch/master?svg=true)](https://ci.appveyor.com/project/kwonoj/emscripten-wasm-loader/branch/master)
[![codecov](https://codecov.io/gh/kwonoj/emscripten-wasm-loader/branch/master/graph/badge.svg)](https://codecov.io/gh/kwonoj/emscripten-wasm-loader)
[![npm](https://img.shields.io/npm/v/emscripten-wasm-loader.svg)](https://www.npmjs.com/package/emscripten-wasm-loader)

# Emscripten-wasm-loader

Wraps up common initialization logic with predefined preprocessor object. This module intended to support specific scoped usecase for wasm binary built with `MODULARIZED` and `SINGLE_FILE`.

# Usage

```js
import { getModuleLoader } from 'emscripten-wasm-loader';

const loader = getModuleLoader(factoryLoader, require('wasm/wasmlibaray'), { additional: ''});
```

`getModuleLoader` is higher order function returns actual module loader.

```js
getModuleLoader<T, R extends AsmRuntimeType>(
  factoryLoader: (runtime: R) => T,
  runtimeModule: runtimeModuleType,
  module?: Record<string, any>
) => moduleLoaderType<T>;

/**
 * Asynchronously load and initialize asm module.
 *
 * @returns {T} Factory function manages lifecycle of hunspell and virtual files.
 */
type moduleLoaderType<T> = () => Promise<T>;
```

`factoryLoader` is callback function to be called to create actual instance of module using initialized wasm binary runtime for customized init steps for each consumer. `runtimeModule` is function loaded via `require` to emscripten preamble js for wasm binaries. It expects wasm binary should be built with `MODULARIZE=1` with `SINGLE_FILE=1` option. Lastly `module` is object to be inherited when execute `runtimeModule`. Emscripten's modularized preamble construct scoped wasm runtime module named `Module`, allows to have predefined object if needed. Internally `getModuleLoader` augments given object and set default interfaces like `initializeRuntime`.
