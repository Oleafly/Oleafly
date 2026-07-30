var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { PLazy, Language, resolveWasmGlueFlavor } from "./BinaryModule-DTTQwokQ.js";
import { Dialect, SuggestionKind, createBinaryModuleFromUrl } from "./BinaryModule-DTTQwokQ.js";
class LocalLinter {
  constructor(init) {
    __publicField(this, "binary");
    __publicField(this, "inner");
    __publicField(this, "disposed", false);
    this.binary = init.binary;
    this.binary.setup();
    this.inner = this.createInner(init.dialect);
  }
  createInner(dialect) {
    return PLazy.from(async () => {
      await this.binary.setup();
      return this.binary.createLinter(dialect);
    });
  }
  async setup() {
    await this.lint("", { language: "plaintext" });
    const exported = await this.exportIgnoredLints();
    await this.importIgnoredLints(exported);
  }
  async lint(text, options) {
    const inner = await this.inner;
    let language = Language.Markdown;
    switch (options == null ? void 0 : options.language) {
      case "plaintext":
        language = Language.Plain;
        break;
      case "markdown":
        language = Language.Markdown;
        break;
      case "typst":
        language = Language.Typst;
    }
    const lints = inner.lint(
      text,
      language,
      (options == null ? void 0 : options.forceAllHeadings) ?? false,
      options == null ? void 0 : options.regex_mask,
      (options == null ? void 0 : options.dedup) ?? true
    );
    return lints;
  }
  async organizedLints(text, options) {
    const inner = await this.inner;
    let language = Language.Markdown;
    switch (options == null ? void 0 : options.language) {
      case "plaintext":
        language = Language.Plain;
        break;
      case "markdown":
        language = Language.Markdown;
        break;
      case "typst":
        language = Language.Typst;
        break;
    }
    const lintGroups = inner.organized_lints(
      text,
      language,
      (options == null ? void 0 : options.forceAllHeadings) ?? false,
      options == null ? void 0 : options.regex_mask,
      (options == null ? void 0 : options.dedup) ?? true
    );
    const output = {};
    for (const group of lintGroups) {
      output[group.group] = group.lints;
      group.free();
    }
    return output;
  }
  async applySuggestion(text, lint, suggestion) {
    const inner = await this.inner;
    return inner.apply_suggestion(text, lint, suggestion);
  }
  async isLikelyEnglish(text) {
    const inner = await this.inner;
    return inner.is_likely_english(text);
  }
  async isolateEnglish(text) {
    const inner = await this.inner;
    return inner.isolate_english(text);
  }
  async getLintConfig() {
    const inner = await this.inner;
    return inner.get_lint_config_as_object();
  }
  async getDefaultLintConfigAsJSON() {
    return await this.binary.getDefaultLintConfigAsJSON();
  }
  async getDefaultLintConfig() {
    return await this.binary.getDefaultLintConfig();
  }
  async getStructuredLintConfig() {
    const inner = await this.inner;
    return inner.get_structured_lint_config_as_object();
  }
  async getStructuredLintConfigJSON() {
    const inner = await this.inner;
    return inner.get_structured_lint_config_as_json();
  }
  async setLintConfig(config) {
    const inner = await this.inner;
    inner.set_lint_config_from_object(config);
  }
  async getLintConfigAsJSON() {
    const inner = await this.inner;
    return inner.get_lint_config_as_json();
  }
  async setLintConfigWithJSON(config) {
    const inner = await this.inner;
    inner.set_lint_config_from_json(config);
  }
  async toTitleCase(text) {
    return await this.binary.toTitleCase(text);
  }
  async getLintDescriptions() {
    const inner = await this.inner;
    return inner.get_lint_descriptions_as_object();
  }
  async getLintDescriptionsAsJSON() {
    const inner = await this.inner;
    return inner.get_lint_descriptions_as_json();
  }
  async getLintDescriptionsHTML() {
    const inner = await this.inner;
    return inner.get_lint_descriptions_html_as_object();
  }
  async getLintDescriptionsHTMLAsJSON() {
    const inner = await this.inner;
    return inner.get_lint_descriptions_html_as_json();
  }
  async ignoreLint(source, lint) {
    return await this.ignoreLints(source, [lint]);
  }
  async ignoreLints(source, lints) {
    const inner = await this.inner;
    inner.ignore_lints(source, lints);
  }
  async ignoreLintHash(hash) {
    const inner = await this.inner;
    inner.ignore_hashes(new BigUint64Array([hash]));
  }
  async exportIgnoredLints() {
    const inner = await this.inner;
    return inner.export_ignored_lints();
  }
  async importIgnoredLints(json) {
    const inner = await this.inner;
    inner.import_ignored_lints(json);
  }
  async contextHash(source, lint) {
    const inner = await this.inner;
    return inner.context_hash(source, lint);
  }
  async clearIgnoredLints() {
    const inner = await this.inner;
    inner.clear_ignored_lints();
  }
  async clearWords() {
    const inner = await this.inner;
    return inner.clear_words();
  }
  async importWords(words) {
    const inner = await this.inner;
    return inner.import_words(words);
  }
  async exportWords() {
    const inner = await this.inner;
    return inner.export_words();
  }
  async getDialect() {
    const inner = await this.inner;
    return inner.get_dialect();
  }
  async setDialect(dialect) {
    const inner = await this.inner;
    if (inner.get_dialect() !== dialect) {
      inner.free();
      this.inner = this.createInner(dialect);
    }
    return Promise.resolve();
  }
  async summarizeStats(start, end) {
    const inner = await this.inner;
    return inner.summarize_stats(start, end);
  }
  async generateStatsFile() {
    const inner = await this.inner;
    return inner.generate_stats_file();
  }
  async importStatsFile(statsFile) {
    const inner = await this.inner;
    return inner.import_stats_file(statsFile);
  }
  /**
   * Load a Weirpack from a Blob.
   *
   * Returns `undefined` if tests pass and rules are imported, otherwise returns
   * the Weirpack test failures.
   */
  async loadWeirpackFromBlob(blob2) {
    const bytes = new Uint8Array(await blob2.arrayBuffer());
    return this.loadWeirpackFromBytes(bytes);
  }
  /**
   * Load a Weirpack from a byte array.
   *
   * Returns `undefined` if tests pass and rules are imported, otherwise returns
   * the Weirpack test failures.
   */
  async loadWeirpackFromBytes(bytes) {
    const inner = await this.inner;
    const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const result = inner.import_weirpack(data);
    return result;
  }
  async dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const inner = await this.inner;
    inner.free();
  }
}
function assert(condition, message) {
  if (!condition) {
    throw new Error("Assertion failed");
  }
}
class Serializer {
  constructor(binary) {
    __publicField(this, "binary");
    this.binary = binary;
    this.binary.setup();
  }
  async serializeArg(arg) {
    var _a2;
    const { Lint, Span, Suggestion } = await this.binary.getBinaryModule();
    if (Array.isArray(arg)) {
      return {
        json: JSON.stringify(await Promise.all(arg.map((a) => this.serializeArg(a)))),
        type: "Array"
      };
    }
    const argType = typeof arg;
    switch (argType) {
      case "string":
      case "number":
      case "boolean":
      case "undefined":
        return { json: JSON.stringify(arg), type: argType };
      case "bigint":
        return { json: arg.toString(), type: argType };
    }
    if (arg.to_json !== void 0) {
      const json = arg.to_json();
      let type;
      const constructorName = (_a2 = arg.constructor) == null ? void 0 : _a2.name;
      if (arg instanceof Lint || constructorName === "Lint") {
        type = "Lint";
      } else if (arg instanceof Suggestion || constructorName === "Suggestion") {
        type = "Suggestion";
      } else if (arg instanceof Span || constructorName === "Span") {
        type = "Span";
      }
      if (type === void 0) {
        throw new Error("Unhandled case: type undefined");
      }
      return { json, type };
    }
    if (argType == "object") {
      return {
        json: JSON.stringify(
          await Promise.all(
            Object.entries(arg).map(([key, value]) => this.serializeArg([key, value]))
          )
        ),
        type: "object"
      };
    }
    throw new Error(`Unhandled case: ${arg}`);
  }
  async serialize(req) {
    return {
      procName: req.procName,
      args: await Promise.all(req.args.map((arg) => this.serializeArg(arg)))
    };
  }
  async deserializeArg(requestArg) {
    const { Lint, Span, Suggestion } = await this.binary.getBinaryModule();
    switch (requestArg.type) {
      case "bigint":
        return BigInt(requestArg.json);
      case "undefined":
        return void 0;
      case "boolean":
      case "number":
      case "string":
        return JSON.parse(requestArg.json);
      case "Suggestion":
        return Suggestion.from_json(requestArg.json);
      case "Lint":
        return Lint.from_json(requestArg.json);
      case "Span":
        return Span.from_json(requestArg.json);
      case "Array": {
        const parsed = JSON.parse(requestArg.json);
        assert(Array.isArray(parsed));
        return await Promise.all(parsed.map((arg) => this.deserializeArg(arg)));
      }
      case "object": {
        const parsed = JSON.parse(requestArg.json);
        return Object.fromEntries(
          await Promise.all(parsed.map((val) => this.deserializeArg(val)))
        );
      }
      default:
        throw new Error(`Unhandled case: ${requestArg.type}`);
    }
  }
  async deserialize(request) {
    return {
      procName: request.procName,
      args: await Promise.all(request.args.map((arg) => this.deserializeArg(arg)))
    };
  }
}
const jsContent = 'var __defProp = Object.defineProperty;\nvar __typeError = (msg) => {\n  throw TypeError(msg);\n};\nvar __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;\nvar __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);\nvar __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);\nvar __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));\nvar __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);\nvar __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);\nvar _executor, _promise;\nconst Dialect$1 = Object.freeze({\n  American: 0,\n  "0": "American",\n  British: 1,\n  "1": "British",\n  Australian: 2,\n  "2": "Australian",\n  Canadian: 3,\n  "3": "Canadian",\n  Indian: 4,\n  "4": "Indian"\n});\nconst Language$1 = Object.freeze({\n  Plain: 0,\n  "0": "Plain",\n  Markdown: 1,\n  "1": "Markdown",\n  Typst: 2,\n  "2": "Typst"\n});\nlet Lint$1 = class Lint {\n  static __wrap(ptr) {\n    const obj = Object.create(Lint.prototype);\n    obj.__wbg_ptr = ptr;\n    LintFinalization$1.register(obj, obj.__wbg_ptr, obj);\n    return obj;\n  }\n  static __unwrap(jsValue) {\n    if (!(jsValue instanceof Lint)) {\n      return 0;\n    }\n    return jsValue.__destroy_into_raw();\n  }\n  __destroy_into_raw() {\n    const ptr = this.__wbg_ptr;\n    this.__wbg_ptr = 0;\n    LintFinalization$1.unregister(this);\n    return ptr;\n  }\n  free() {\n    const ptr = this.__destroy_into_raw();\n    wasm$1.__wbg_lint_free(ptr, 0);\n  }\n  /**\n   * @param {string} json\n   * @returns {Lint}\n   */\n  static from_json(json) {\n    const ptr0 = passStringToWasm0$1(json, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    const ret = wasm$1.lint_from_json(ptr0, len0);\n    if (ret[2]) {\n      throw takeFromExternrefTable0$1(ret[1]);\n    }\n    return Lint.__wrap(ret[0]);\n  }\n  /**\n   * Get the content of the source material pointed to by [`Self::span`]\n   * @returns {string}\n   */\n  get_problem_text() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.lint_get_problem_text(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a string representing the general category of the lint.\n   * @returns {string}\n   */\n  lint_kind() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.lint_lint_kind(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a string representing the general category of the lint.\n   * @returns {string}\n   */\n  lint_kind_pretty() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.lint_lint_kind_pretty(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a description of the error.\n   * @returns {string}\n   */\n  message() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.lint_message(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a description of the error as HTML.\n   * @returns {string}\n   */\n  message_html() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.lint_message_html(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get the location of the problematic text.\n   * @returns {Span}\n   */\n  span() {\n    const ret = wasm$1.lint_span(this.__wbg_ptr);\n    return Span$1.__wrap(ret);\n  }\n  /**\n   * Equivalent to calling `.length` on the result of `suggestions()`.\n   * @returns {number}\n   */\n  suggestion_count() {\n    const ret = wasm$1.lint_suggestion_count(this.__wbg_ptr);\n    return ret >>> 0;\n  }\n  /**\n   * Get an array of any suggestions that may resolve the issue.\n   * @returns {Suggestion[]}\n   */\n  suggestions() {\n    const ret = wasm$1.lint_suggestions(this.__wbg_ptr);\n    var v1 = getArrayJsValueFromWasm0$1(ret[0], ret[1]).slice();\n    wasm$1.__wbindgen_free(ret[0], ret[1] * 4, 4);\n    return v1;\n  }\n  /**\n   * @returns {string}\n   */\n  to_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.lint_to_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n};\nif (Symbol.dispose) Lint$1.prototype[Symbol.dispose] = Lint$1.prototype.free;\nlet Linter$1 = class Linter {\n  static __wrap(ptr) {\n    const obj = Object.create(Linter.prototype);\n    obj.__wbg_ptr = ptr;\n    LinterFinalization$1.register(obj, obj.__wbg_ptr, obj);\n    return obj;\n  }\n  __destroy_into_raw() {\n    const ptr = this.__wbg_ptr;\n    this.__wbg_ptr = 0;\n    LinterFinalization$1.unregister(this);\n    return ptr;\n  }\n  free() {\n    const ptr = this.__destroy_into_raw();\n    wasm$1.__wbg_linter_free(ptr, 0);\n  }\n  /**\n   * Apply a suggestion from a given lint.\n   * This action will be logged to the Linter\'s statistics.\n   * @param {string} source_text\n   * @param {Lint} lint\n   * @param {Suggestion} suggestion\n   * @returns {string}\n   */\n  apply_suggestion(source_text, lint, suggestion) {\n    let deferred3_0;\n    let deferred3_1;\n    try {\n      const ptr0 = passStringToWasm0$1(source_text, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n      const len0 = WASM_VECTOR_LEN$1;\n      _assertClass$1(lint, Lint$1);\n      _assertClass$1(suggestion, Suggestion$1);\n      const ret = wasm$1.linter_apply_suggestion(this.__wbg_ptr, ptr0, len0, lint.__wbg_ptr, suggestion.__wbg_ptr);\n      var ptr2 = ret[0];\n      var len2 = ret[1];\n      if (ret[3]) {\n        ptr2 = 0;\n        len2 = 0;\n        throw takeFromExternrefTable0$1(ret[2]);\n      }\n      deferred3_0 = ptr2;\n      deferred3_1 = len2;\n      return getStringFromWasm0$1(ptr2, len2);\n    } finally {\n      wasm$1.__wbindgen_free(deferred3_0, deferred3_1, 1);\n    }\n  }\n  clear_ignored_lints() {\n    wasm$1.linter_clear_ignored_lints(this.__wbg_ptr);\n  }\n  /**\n   * Clear the user dictionary.\n   */\n  clear_words() {\n    wasm$1.linter_clear_words(this.__wbg_ptr);\n  }\n  /**\n   * Compute the context hash of a given lint.\n   * @param {string} source_text\n   * @param {Lint} lint\n   * @returns {bigint}\n   */\n  context_hash(source_text, lint) {\n    const ptr0 = passStringToWasm0$1(source_text, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    _assertClass$1(lint, Lint$1);\n    const ret = wasm$1.linter_context_hash(this.__wbg_ptr, ptr0, len0, lint.__wbg_ptr);\n    return BigInt.asUintN(64, ret);\n  }\n  /**\n   * Export the linter\'s ignored lints as a privacy-respecting JSON list of hashes.\n   * @returns {string}\n   */\n  export_ignored_lints() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.linter_export_ignored_lints(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Export words from the dictionary.\n   * Note: this will only return words previously added by [`Self::import_words`].\n   * @returns {string[]}\n   */\n  export_words() {\n    const ret = wasm$1.linter_export_words(this.__wbg_ptr);\n    var v1 = getArrayJsValueFromWasm0$1(ret[0], ret[1]).slice();\n    wasm$1.__wbindgen_free(ret[0], ret[1] * 4, 4);\n    return v1;\n  }\n  /**\n   * @returns {string}\n   */\n  generate_stats_file() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.linter_generate_stats_file(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get the dialect this struct was constructed for.\n   * @returns {Dialect}\n   */\n  get_dialect() {\n    const ret = wasm$1.linter_get_dialect(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * @returns {string}\n   */\n  get_lint_config_as_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.linter_get_lint_config_as_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * @returns {any}\n   */\n  get_lint_config_as_object() {\n    const ret = wasm$1.linter_get_lint_config_as_object(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * Get a JSON map containing the descriptions of all the linting rules, formatted as Markdown.\n   * @returns {string}\n   */\n  get_lint_descriptions_as_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.linter_get_lint_descriptions_as_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a Record containing the descriptions of all the linting rules, formatted as Markdown.\n   * @returns {any}\n   */\n  get_lint_descriptions_as_object() {\n    const ret = wasm$1.linter_get_lint_descriptions_as_object(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * Get a JSON map containing the descriptions of all the linting rules, formatted as HTML.\n   * @returns {string}\n   */\n  get_lint_descriptions_html_as_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.linter_get_lint_descriptions_html_as_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a Record containing the descriptions of all the linting rules, formatted as HTML.\n   * @returns {any}\n   */\n  get_lint_descriptions_html_as_object() {\n    const ret = wasm$1.linter_get_lint_descriptions_html_as_object(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * @returns {string}\n   */\n  get_structured_lint_config_as_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.linter_get_structured_lint_config_as_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * @returns {any}\n   */\n  get_structured_lint_config_as_object() {\n    const ret = wasm$1.linter_get_structured_lint_config_as_object(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * Add a specific context hash to the ignored lints list.\n   * @param {BigUint64Array} hashes\n   */\n  ignore_hashes(hashes) {\n    const ptr0 = passArray64ToWasm0$1(hashes, wasm$1.__wbindgen_malloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    wasm$1.linter_ignore_hashes(this.__wbg_ptr, ptr0, len0);\n  }\n  /**\n   * @param {string} source_text\n   * @param {Lint[]} lints\n   */\n  ignore_lints(source_text, lints) {\n    const ptr0 = passStringToWasm0$1(source_text, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    const ptr1 = passArrayJsValueToWasm0$1(lints, wasm$1.__wbindgen_malloc);\n    const len1 = WASM_VECTOR_LEN$1;\n    wasm$1.linter_ignore_lints(this.__wbg_ptr, ptr0, len0, ptr1, len1);\n  }\n  /**\n   * Import into the linter\'s ignored lints from a privacy-respecting JSON list of hashes.\n   * @param {string} json\n   */\n  import_ignored_lints(json) {\n    const ptr0 = passStringToWasm0$1(json, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    const ret = wasm$1.linter_import_ignored_lints(this.__wbg_ptr, ptr0, len0);\n    if (ret[1]) {\n      throw takeFromExternrefTable0$1(ret[0]);\n    }\n  }\n  /**\n   * @param {string} file\n   */\n  import_stats_file(file) {\n    const ptr0 = passStringToWasm0$1(file, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    const ret = wasm$1.linter_import_stats_file(this.__wbg_ptr, ptr0, len0);\n    if (ret[1]) {\n      throw takeFromExternrefTable0$1(ret[0]);\n    }\n  }\n  /**\n   * Load a Weirpack from raw bytes, merging its rules into the current linter.\n   * Returns test failures if any are found, and does not import in that case.\n   * @param {Uint8Array} bytes\n   * @returns {any}\n   */\n  import_weirpack(bytes) {\n    const ptr0 = passArray8ToWasm0$1(bytes, wasm$1.__wbindgen_malloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    const ret = wasm$1.linter_import_weirpack(this.__wbg_ptr, ptr0, len0);\n    if (ret[2]) {\n      throw takeFromExternrefTable0$1(ret[1]);\n    }\n    return takeFromExternrefTable0$1(ret[0]);\n  }\n  /**\n   * Import words into the dictionary.\n   * @param {string[]} additional_words\n   */\n  import_words(additional_words) {\n    const ptr0 = passArrayJsValueToWasm0$1(additional_words, wasm$1.__wbindgen_malloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    wasm$1.linter_import_words(this.__wbg_ptr, ptr0, len0);\n  }\n  /**\n   * Helper method to quickly check if a plain string is likely intended to be English\n   * @param {string} text\n   * @returns {boolean}\n   */\n  is_likely_english(text) {\n    const ptr0 = passStringToWasm0$1(text, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    const ret = wasm$1.linter_is_likely_english(this.__wbg_ptr, ptr0, len0);\n    return ret !== 0;\n  }\n  /**\n   * Helper method to remove non-English text from a plain English document.\n   * @param {string} text\n   * @returns {string}\n   */\n  isolate_english(text) {\n    let deferred2_0;\n    let deferred2_1;\n    try {\n      const ptr0 = passStringToWasm0$1(text, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n      const len0 = WASM_VECTOR_LEN$1;\n      const ret = wasm$1.linter_isolate_english(this.__wbg_ptr, ptr0, len0);\n      deferred2_0 = ret[0];\n      deferred2_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred2_0, deferred2_1, 1);\n    }\n  }\n  /**\n   * Perform the configured linting on the provided text.\n   *\n   * If the provided regex mask cannot be parsed, this method will return an empty array.\n   * @param {string} text\n   * @param {Language} language\n   * @param {boolean} all_headings\n   * @param {string | null | undefined} regex_mask\n   * @param {boolean} dedup\n   * @returns {Lint[]}\n   */\n  lint(text, language, all_headings, regex_mask, dedup) {\n    const ptr0 = passStringToWasm0$1(text, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    var ptr1 = isLikeNone$1(regex_mask) ? 0 : passStringToWasm0$1(regex_mask, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    var len1 = WASM_VECTOR_LEN$1;\n    const ret = wasm$1.linter_lint(this.__wbg_ptr, ptr0, len0, language, all_headings, ptr1, len1, dedup);\n    var v3 = getArrayJsValueFromWasm0$1(ret[0], ret[1]).slice();\n    wasm$1.__wbindgen_free(ret[0], ret[1] * 4, 4);\n    return v3;\n  }\n  /**\n   * Construct a new `Linter`.\n   * Note that this can mean constructing the curated dictionary, which is the most expensive operation\n   * in Harper.\n   * @param {Dialect} dialect\n   * @returns {Linter}\n   */\n  static new(dialect) {\n    const ret = wasm$1.linter_new(dialect);\n    return Linter.__wrap(ret);\n  }\n  /**\n   * @param {string} text\n   * @param {Language} language\n   * @param {boolean} all_headings\n   * @param {string | null | undefined} regex_mask\n   * @param {boolean} dedup\n   * @returns {OrganizedGroup[]}\n   */\n  organized_lints(text, language, all_headings, regex_mask, dedup) {\n    const ptr0 = passStringToWasm0$1(text, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    var ptr1 = isLikeNone$1(regex_mask) ? 0 : passStringToWasm0$1(regex_mask, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    var len1 = WASM_VECTOR_LEN$1;\n    const ret = wasm$1.linter_organized_lints(this.__wbg_ptr, ptr0, len0, language, all_headings, ptr1, len1, dedup);\n    var v3 = getArrayJsValueFromWasm0$1(ret[0], ret[1]).slice();\n    wasm$1.__wbindgen_free(ret[0], ret[1] * 4, 4);\n    return v3;\n  }\n  /**\n   * @param {string} json\n   */\n  set_lint_config_from_json(json) {\n    const ptr0 = passStringToWasm0$1(json, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    const ret = wasm$1.linter_set_lint_config_from_json(this.__wbg_ptr, ptr0, len0);\n    if (ret[1]) {\n      throw takeFromExternrefTable0$1(ret[0]);\n    }\n  }\n  /**\n   * @param {any} object\n   */\n  set_lint_config_from_object(object) {\n    const ret = wasm$1.linter_set_lint_config_from_object(this.__wbg_ptr, object);\n    if (ret[1]) {\n      throw takeFromExternrefTable0$1(ret[0]);\n    }\n  }\n  /**\n   * @param {bigint | null} [start_time]\n   * @param {bigint | null} [end_time]\n   * @returns {any}\n   */\n  summarize_stats(start_time, end_time) {\n    const ret = wasm$1.linter_summarize_stats(this.__wbg_ptr, !isLikeNone$1(start_time), isLikeNone$1(start_time) ? BigInt(0) : start_time, !isLikeNone$1(end_time), isLikeNone$1(end_time) ? BigInt(0) : end_time);\n    return ret;\n  }\n};\nif (Symbol.dispose) Linter$1.prototype[Symbol.dispose] = Linter$1.prototype.free;\nlet OrganizedGroup$1 = class OrganizedGroup {\n  static __wrap(ptr) {\n    const obj = Object.create(OrganizedGroup.prototype);\n    obj.__wbg_ptr = ptr;\n    OrganizedGroupFinalization$1.register(obj, obj.__wbg_ptr, obj);\n    return obj;\n  }\n  __destroy_into_raw() {\n    const ptr = this.__wbg_ptr;\n    this.__wbg_ptr = 0;\n    OrganizedGroupFinalization$1.unregister(this);\n    return ptr;\n  }\n  free() {\n    const ptr = this.__destroy_into_raw();\n    wasm$1.__wbg_organizedgroup_free(ptr, 0);\n  }\n  /**\n   * @returns {string}\n   */\n  get group() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.__wbg_get_organizedgroup_group(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * @returns {Lint[]}\n   */\n  get lints() {\n    const ret = wasm$1.__wbg_get_organizedgroup_lints(this.__wbg_ptr);\n    var v1 = getArrayJsValueFromWasm0$1(ret[0], ret[1]).slice();\n    wasm$1.__wbindgen_free(ret[0], ret[1] * 4, 4);\n    return v1;\n  }\n  /**\n   * @param {string} arg0\n   */\n  set group(arg0) {\n    const ptr0 = passStringToWasm0$1(arg0, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    wasm$1.__wbg_set_organizedgroup_group(this.__wbg_ptr, ptr0, len0);\n  }\n  /**\n   * @param {Lint[]} arg0\n   */\n  set lints(arg0) {\n    const ptr0 = passArrayJsValueToWasm0$1(arg0, wasm$1.__wbindgen_malloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    wasm$1.__wbg_set_organizedgroup_lints(this.__wbg_ptr, ptr0, len0);\n  }\n};\nif (Symbol.dispose) OrganizedGroup$1.prototype[Symbol.dispose] = OrganizedGroup$1.prototype.free;\nlet Span$1 = class Span {\n  static __wrap(ptr) {\n    const obj = Object.create(Span.prototype);\n    obj.__wbg_ptr = ptr;\n    SpanFinalization$1.register(obj, obj.__wbg_ptr, obj);\n    return obj;\n  }\n  __destroy_into_raw() {\n    const ptr = this.__wbg_ptr;\n    this.__wbg_ptr = 0;\n    SpanFinalization$1.unregister(this);\n    return ptr;\n  }\n  free() {\n    const ptr = this.__destroy_into_raw();\n    wasm$1.__wbg_span_free(ptr, 0);\n  }\n  /**\n   * @returns {number}\n   */\n  get end() {\n    const ret = wasm$1.__wbg_get_span_end(this.__wbg_ptr);\n    return ret >>> 0;\n  }\n  /**\n   * @returns {number}\n   */\n  get start() {\n    const ret = wasm$1.__wbg_get_span_start(this.__wbg_ptr);\n    return ret >>> 0;\n  }\n  /**\n   * @param {number} arg0\n   */\n  set end(arg0) {\n    wasm$1.__wbg_set_span_end(this.__wbg_ptr, arg0);\n  }\n  /**\n   * @param {number} arg0\n   */\n  set start(arg0) {\n    wasm$1.__wbg_set_span_start(this.__wbg_ptr, arg0);\n  }\n  /**\n   * @param {string} json\n   * @returns {Span}\n   */\n  static from_json(json) {\n    const ptr0 = passStringToWasm0$1(json, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    const ret = wasm$1.span_from_json(ptr0, len0);\n    if (ret[2]) {\n      throw takeFromExternrefTable0$1(ret[1]);\n    }\n    return Span.__wrap(ret[0]);\n  }\n  /**\n   * @returns {boolean}\n   */\n  is_empty() {\n    const ret = wasm$1.span_is_empty(this.__wbg_ptr);\n    return ret !== 0;\n  }\n  /**\n   * @returns {number}\n   */\n  len() {\n    const ret = wasm$1.span_len(this.__wbg_ptr);\n    return ret >>> 0;\n  }\n  /**\n   * @param {number} start\n   * @param {number} end\n   * @returns {Span}\n   */\n  static new(start, end) {\n    const ret = wasm$1.span_new(start, end);\n    return Span.__wrap(ret);\n  }\n  /**\n   * @returns {string}\n   */\n  to_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.span_to_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n};\nif (Symbol.dispose) Span$1.prototype[Symbol.dispose] = Span$1.prototype.free;\nlet Suggestion$1 = class Suggestion {\n  static __wrap(ptr) {\n    const obj = Object.create(Suggestion.prototype);\n    obj.__wbg_ptr = ptr;\n    SuggestionFinalization$1.register(obj, obj.__wbg_ptr, obj);\n    return obj;\n  }\n  __destroy_into_raw() {\n    const ptr = this.__wbg_ptr;\n    this.__wbg_ptr = 0;\n    SuggestionFinalization$1.unregister(this);\n    return ptr;\n  }\n  free() {\n    const ptr = this.__destroy_into_raw();\n    wasm$1.__wbg_suggestion_free(ptr, 0);\n  }\n  /**\n   * @param {string} json\n   * @returns {Suggestion}\n   */\n  static from_json(json) {\n    const ptr0 = passStringToWasm0$1(json, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    const ret = wasm$1.suggestion_from_json(ptr0, len0);\n    if (ret[2]) {\n      throw takeFromExternrefTable0$1(ret[1]);\n    }\n    return Suggestion.__wrap(ret[0]);\n  }\n  /**\n   * Get the text that is going to replace the problematic section.\n   * If [`Self::kind`] is `SuggestionKind::Remove`, this will return an empty\n   * string.\n   * @returns {string}\n   */\n  get_replacement_text() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.suggestion_get_replacement_text(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * @returns {SuggestionKind}\n   */\n  kind() {\n    const ret = wasm$1.suggestion_kind(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * @returns {string}\n   */\n  to_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm$1.suggestion_to_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0$1(ret[0], ret[1]);\n    } finally {\n      wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n};\nif (Symbol.dispose) Suggestion$1.prototype[Symbol.dispose] = Suggestion$1.prototype.free;\nconst SuggestionKind$1 = Object.freeze({\n  /**\n   * Replace the problematic text.\n   */\n  Replace: 0,\n  "0": "Replace",\n  /**\n   * Remove the problematic text.\n   */\n  Remove: 1,\n  "1": "Remove",\n  /**\n   * Insert additional text after the error.\n   */\n  InsertAfter: 2,\n  "2": "InsertAfter"\n});\nfunction get_default_lint_config$1() {\n  const ret = wasm$1.get_default_lint_config();\n  return ret;\n}\nfunction get_default_lint_config_as_json$1() {\n  let deferred1_0;\n  let deferred1_1;\n  try {\n    const ret = wasm$1.get_default_lint_config_as_json();\n    deferred1_0 = ret[0];\n    deferred1_1 = ret[1];\n    return getStringFromWasm0$1(ret[0], ret[1]);\n  } finally {\n    wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n  }\n}\nfunction setup$1() {\n  wasm$1.setup();\n}\nfunction to_title_case$1(text) {\n  let deferred2_0;\n  let deferred2_1;\n  try {\n    const ptr0 = passStringToWasm0$1(text, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN$1;\n    const ret = wasm$1.to_title_case(ptr0, len0);\n    deferred2_0 = ret[0];\n    deferred2_1 = ret[1];\n    return getStringFromWasm0$1(ret[0], ret[1]);\n  } finally {\n    wasm$1.__wbindgen_free(deferred2_0, deferred2_1, 1);\n  }\n}\nfunction __wbg_get_imports$1() {\n  const import0 = {\n    __proto__: null,\n    __wbg_Error_bce6d499ff0a4aff: function(arg0, arg1) {\n      const ret = Error(getStringFromWasm0$1(arg0, arg1));\n      return ret;\n    },\n    __wbg_String_8564e559799eccda: function(arg0, arg1) {\n      const ret = String(arg1);\n      const ptr1 = passStringToWasm0$1(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n      const len1 = WASM_VECTOR_LEN$1;\n      getDataViewMemory0$1().setInt32(arg0 + 4 * 1, len1, true);\n      getDataViewMemory0$1().setInt32(arg0 + 4 * 0, ptr1, true);\n    },\n    __wbg___wbindgen_boolean_get_2304fb8c853028c8: function(arg0) {\n      const v = arg0;\n      const ret = typeof v === "boolean" ? v : void 0;\n      return isLikeNone$1(ret) ? 16777215 : ret ? 1 : 0;\n    },\n    __wbg___wbindgen_debug_string_edece8177ad01481: function(arg0, arg1) {\n      const ret = debugString$1(arg1);\n      const ptr1 = passStringToWasm0$1(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n      const len1 = WASM_VECTOR_LEN$1;\n      getDataViewMemory0$1().setInt32(arg0 + 4 * 1, len1, true);\n      getDataViewMemory0$1().setInt32(arg0 + 4 * 0, ptr1, true);\n    },\n    __wbg___wbindgen_is_function_5cd60d5cf78b4eef: function(arg0) {\n      const ret = typeof arg0 === "function";\n      return ret;\n    },\n    __wbg___wbindgen_is_object_b4593df85baada48: function(arg0) {\n      const val = arg0;\n      const ret = typeof val === "object" && val !== null;\n      return ret;\n    },\n    __wbg___wbindgen_is_string_dde0fd9020db4434: function(arg0) {\n      const ret = typeof arg0 === "string";\n      return ret;\n    },\n    __wbg___wbindgen_jsval_loose_eq_0ad77b7717db155c: function(arg0, arg1) {\n      const ret = arg0 == arg1;\n      return ret;\n    },\n    __wbg___wbindgen_number_get_f73a1244370fcc2c: function(arg0, arg1) {\n      const obj = arg1;\n      const ret = typeof obj === "number" ? obj : void 0;\n      getDataViewMemory0$1().setFloat64(arg0 + 8 * 1, isLikeNone$1(ret) ? 0 : ret, true);\n      getDataViewMemory0$1().setInt32(arg0 + 4 * 0, !isLikeNone$1(ret), true);\n    },\n    __wbg___wbindgen_string_get_d109740c0d18f4d7: function(arg0, arg1) {\n      const obj = arg1;\n      const ret = typeof obj === "string" ? obj : void 0;\n      var ptr1 = isLikeNone$1(ret) ? 0 : passStringToWasm0$1(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n      var len1 = WASM_VECTOR_LEN$1;\n      getDataViewMemory0$1().setInt32(arg0 + 4 * 1, len1, true);\n      getDataViewMemory0$1().setInt32(arg0 + 4 * 0, ptr1, true);\n    },\n    __wbg___wbindgen_throw_9c31b086c2b26051: function(arg0, arg1) {\n      throw new Error(getStringFromWasm0$1(arg0, arg1));\n    },\n    __wbg_call_13665d9f14390edc: function() {\n      return handleError$1(function(arg0, arg1) {\n        const ret = arg0.call(arg1);\n        return ret;\n      }, arguments);\n    },\n    __wbg_done_54b8da57023b7ed2: function(arg0) {\n      const ret = arg0.done;\n      return ret;\n    },\n    __wbg_entries_564a7e8b1e54ede5: function(arg0) {\n      const ret = Object.entries(arg0);\n      return ret;\n    },\n    __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {\n      let deferred0_0;\n      let deferred0_1;\n      try {\n        deferred0_0 = arg0;\n        deferred0_1 = arg1;\n        console.error(getStringFromWasm0$1(arg0, arg1));\n      } finally {\n        wasm$1.__wbindgen_free(deferred0_0, deferred0_1, 1);\n      }\n    },\n    __wbg_getRandomValues_3f44b700395062e5: function() {\n      return handleError$1(function(arg0, arg1) {\n        globalThis.crypto.getRandomValues(getArrayU8FromWasm0$1(arg0, arg1));\n      }, arguments);\n    },\n    __wbg_getRandomValues_d49329ff89a07af1: function() {\n      return handleError$1(function(arg0, arg1) {\n        globalThis.crypto.getRandomValues(getArrayU8FromWasm0$1(arg0, arg1));\n      }, arguments);\n    },\n    __wbg_getTime_09f1dd40a44edb30: function(arg0) {\n      const ret = arg0.getTime();\n      return ret;\n    },\n    __wbg_get_3e9a707ab7d352eb: function() {\n      return handleError$1(function(arg0, arg1) {\n        const ret = Reflect.get(arg0, arg1);\n        return ret;\n      }, arguments);\n    },\n    __wbg_get_98fdf51d029a75eb: function(arg0, arg1) {\n      const ret = arg0[arg1 >>> 0];\n      return ret;\n    },\n    __wbg_get_unchecked_1dfe6d05ad91d9b7: function(arg0, arg1) {\n      const ret = arg0[arg1 >>> 0];\n      return ret;\n    },\n    __wbg_instanceof_ArrayBuffer_53db37b06f6b9afe: function(arg0) {\n      let result;\n      try {\n        result = arg0 instanceof ArrayBuffer;\n      } catch (_) {\n        result = false;\n      }\n      const ret = result;\n      return ret;\n    },\n    __wbg_instanceof_Uint8Array_abd07d4bd221d50b: function(arg0) {\n      let result;\n      try {\n        result = arg0 instanceof Uint8Array;\n      } catch (_) {\n        result = false;\n      }\n      const ret = result;\n      return ret;\n    },\n    __wbg_iterator_1441b47f341dc34f: function() {\n      const ret = Symbol.iterator;\n      return ret;\n    },\n    __wbg_length_2591a0f4f659a55c: function(arg0) {\n      const ret = arg0.length;\n      return ret;\n    },\n    __wbg_length_56fcd3e2b7e0299d: function(arg0) {\n      const ret = arg0.length;\n      return ret;\n    },\n    __wbg_lint_new: function(arg0) {\n      const ret = Lint$1.__wrap(arg0);\n      return ret;\n    },\n    __wbg_lint_unwrap: function(arg0) {\n      const ret = Lint$1.__unwrap(arg0);\n      return ret;\n    },\n    __wbg_log_0c201ade58bb55e1: function(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {\n      let deferred0_0;\n      let deferred0_1;\n      try {\n        deferred0_0 = arg0;\n        deferred0_1 = arg1;\n        console.log(getStringFromWasm0$1(arg0, arg1), getStringFromWasm0$1(arg2, arg3), getStringFromWasm0$1(arg4, arg5), getStringFromWasm0$1(arg6, arg7));\n      } finally {\n        wasm$1.__wbindgen_free(deferred0_0, deferred0_1, 1);\n      }\n    },\n    __wbg_log_ce2c4456b290c5e7: function(arg0, arg1) {\n      let deferred0_0;\n      let deferred0_1;\n      try {\n        deferred0_0 = arg0;\n        deferred0_1 = arg1;\n        console.log(getStringFromWasm0$1(arg0, arg1));\n      } finally {\n        wasm$1.__wbindgen_free(deferred0_0, deferred0_1, 1);\n      }\n    },\n    __wbg_mark_b4d943f3bc2d2404: function(arg0, arg1) {\n      performance.mark(getStringFromWasm0$1(arg0, arg1));\n    },\n    __wbg_measure_84362959e621a2c1: function() {\n      return handleError$1(function(arg0, arg1, arg2, arg3) {\n        let deferred0_0;\n        let deferred0_1;\n        let deferred1_0;\n        let deferred1_1;\n        try {\n          deferred0_0 = arg0;\n          deferred0_1 = arg1;\n          deferred1_0 = arg2;\n          deferred1_1 = arg3;\n          performance.measure(getStringFromWasm0$1(arg0, arg1), getStringFromWasm0$1(arg2, arg3));\n        } finally {\n          wasm$1.__wbindgen_free(deferred0_0, deferred0_1, 1);\n          wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);\n        }\n      }, arguments);\n    },\n    __wbg_new_02d162bc6cf02f60: function() {\n      const ret = new Object();\n      return ret;\n    },\n    __wbg_new_070df68d66325372: function() {\n      const ret = /* @__PURE__ */ new Map();\n      return ret;\n    },\n    __wbg_new_0_2722fcdb71a888a6: function() {\n      const ret = /* @__PURE__ */ new Date();\n      return ret;\n    },\n    __wbg_new_227d7c05414eb861: function() {\n      const ret = new Error();\n      return ret;\n    },\n    __wbg_new_310879b66b6e95e1: function() {\n      const ret = new Array();\n      return ret;\n    },\n    __wbg_new_7ddec6de44ff8f5d: function(arg0) {\n      const ret = new Uint8Array(arg0);\n      return ret;\n    },\n    __wbg_next_2a4e19f4f5083b0f: function(arg0) {\n      const ret = arg0.next;\n      return ret;\n    },\n    __wbg_next_6429a146bf756f93: function() {\n      return handleError$1(function(arg0) {\n        const ret = arg0.next();\n        return ret;\n      }, arguments);\n    },\n    __wbg_organizedgroup_new: function(arg0) {\n      const ret = OrganizedGroup$1.__wrap(arg0);\n      return ret;\n    },\n    __wbg_prototypesetcall_5f9bdc8d75e07276: function(arg0, arg1, arg2) {\n      Uint8Array.prototype.set.call(getArrayU8FromWasm0$1(arg0, arg1), arg2);\n    },\n    __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {\n      arg0[arg1] = arg2;\n    },\n    __wbg_set_78ea6a19f4818587: function(arg0, arg1, arg2) {\n      arg0[arg1 >>> 0] = arg2;\n    },\n    __wbg_set_facb7a5914e0fa39: function(arg0, arg1, arg2) {\n      const ret = arg0.set(arg1, arg2);\n      return ret;\n    },\n    __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {\n      const ret = arg1.stack;\n      const ptr1 = passStringToWasm0$1(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);\n      const len1 = WASM_VECTOR_LEN$1;\n      getDataViewMemory0$1().setInt32(arg0 + 4 * 1, len1, true);\n      getDataViewMemory0$1().setInt32(arg0 + 4 * 0, ptr1, true);\n    },\n    __wbg_suggestion_new: function(arg0) {\n      const ret = Suggestion$1.__wrap(arg0);\n      return ret;\n    },\n    __wbg_value_9cc0518af87a489c: function(arg0) {\n      const ret = arg0.value;\n      return ret;\n    },\n    __wbindgen_cast_0000000000000001: function(arg0) {\n      const ret = arg0;\n      return ret;\n    },\n    __wbindgen_cast_0000000000000002: function(arg0, arg1) {\n      const ret = getStringFromWasm0$1(arg0, arg1);\n      return ret;\n    },\n    __wbindgen_init_externref_table: function() {\n      const table = wasm$1.__wbindgen_externrefs;\n      const offset = table.grow(4);\n      table.set(0, void 0);\n      table.set(offset + 0, void 0);\n      table.set(offset + 1, null);\n      table.set(offset + 2, true);\n      table.set(offset + 3, false);\n    }\n  };\n  return {\n    __proto__: null,\n    "./harper_wasm_slim_bg.js": import0\n  };\n}\nconst LintFinalization$1 = typeof FinalizationRegistry === "undefined" ? { register: () => {\n}, unregister: () => {\n} } : new FinalizationRegistry((ptr) => wasm$1.__wbg_lint_free(ptr, 1));\nconst LinterFinalization$1 = typeof FinalizationRegistry === "undefined" ? { register: () => {\n}, unregister: () => {\n} } : new FinalizationRegistry((ptr) => wasm$1.__wbg_linter_free(ptr, 1));\nconst OrganizedGroupFinalization$1 = typeof FinalizationRegistry === "undefined" ? { register: () => {\n}, unregister: () => {\n} } : new FinalizationRegistry((ptr) => wasm$1.__wbg_organizedgroup_free(ptr, 1));\nconst SpanFinalization$1 = typeof FinalizationRegistry === "undefined" ? { register: () => {\n}, unregister: () => {\n} } : new FinalizationRegistry((ptr) => wasm$1.__wbg_span_free(ptr, 1));\nconst SuggestionFinalization$1 = typeof FinalizationRegistry === "undefined" ? { register: () => {\n}, unregister: () => {\n} } : new FinalizationRegistry((ptr) => wasm$1.__wbg_suggestion_free(ptr, 1));\nfunction addToExternrefTable0$1(obj) {\n  const idx = wasm$1.__externref_table_alloc();\n  wasm$1.__wbindgen_externrefs.set(idx, obj);\n  return idx;\n}\nfunction _assertClass$1(instance, klass) {\n  if (!(instance instanceof klass)) {\n    throw new Error(`expected instance of ${klass.name}`);\n  }\n}\nfunction debugString$1(val) {\n  const type = typeof val;\n  if (type == "number" || type == "boolean" || val == null) {\n    return `${val}`;\n  }\n  if (type == "string") {\n    return `"${val}"`;\n  }\n  if (type == "symbol") {\n    const description = val.description;\n    if (description == null) {\n      return "Symbol";\n    } else {\n      return `Symbol(${description})`;\n    }\n  }\n  if (type == "function") {\n    const name = val.name;\n    if (typeof name == "string" && name.length > 0) {\n      return `Function(${name})`;\n    } else {\n      return "Function";\n    }\n  }\n  if (Array.isArray(val)) {\n    const length = val.length;\n    let debug = "[";\n    if (length > 0) {\n      debug += debugString$1(val[0]);\n    }\n    for (let i = 1; i < length; i++) {\n      debug += ", " + debugString$1(val[i]);\n    }\n    debug += "]";\n    return debug;\n  }\n  const builtInMatches = /\\[object ([^\\]]+)\\]/.exec(toString.call(val));\n  let className;\n  if (builtInMatches && builtInMatches.length > 1) {\n    className = builtInMatches[1];\n  } else {\n    return toString.call(val);\n  }\n  if (className == "Object") {\n    try {\n      return "Object(" + JSON.stringify(val) + ")";\n    } catch (_) {\n      return "Object";\n    }\n  }\n  if (val instanceof Error) {\n    return `${val.name}: ${val.message}\n${val.stack}`;\n  }\n  return className;\n}\nfunction getArrayJsValueFromWasm0$1(ptr, len) {\n  ptr = ptr >>> 0;\n  const mem = getDataViewMemory0$1();\n  const result = [];\n  for (let i = ptr; i < ptr + 4 * len; i += 4) {\n    result.push(wasm$1.__wbindgen_externrefs.get(mem.getUint32(i, true)));\n  }\n  wasm$1.__externref_drop_slice(ptr, len);\n  return result;\n}\nfunction getArrayU8FromWasm0$1(ptr, len) {\n  ptr = ptr >>> 0;\n  return getUint8ArrayMemory0$1().subarray(ptr / 1, ptr / 1 + len);\n}\nlet cachedBigUint64ArrayMemory0$1 = null;\nfunction getBigUint64ArrayMemory0$1() {\n  if (cachedBigUint64ArrayMemory0$1 === null || cachedBigUint64ArrayMemory0$1.byteLength === 0) {\n    cachedBigUint64ArrayMemory0$1 = new BigUint64Array(wasm$1.memory.buffer);\n  }\n  return cachedBigUint64ArrayMemory0$1;\n}\nlet cachedDataViewMemory0$1 = null;\nfunction getDataViewMemory0$1() {\n  if (cachedDataViewMemory0$1 === null || cachedDataViewMemory0$1.buffer.detached === true || cachedDataViewMemory0$1.buffer.detached === void 0 && cachedDataViewMemory0$1.buffer !== wasm$1.memory.buffer) {\n    cachedDataViewMemory0$1 = new DataView(wasm$1.memory.buffer);\n  }\n  return cachedDataViewMemory0$1;\n}\nfunction getStringFromWasm0$1(ptr, len) {\n  return decodeText$1(ptr >>> 0, len);\n}\nlet cachedUint8ArrayMemory0$1 = null;\nfunction getUint8ArrayMemory0$1() {\n  if (cachedUint8ArrayMemory0$1 === null || cachedUint8ArrayMemory0$1.byteLength === 0) {\n    cachedUint8ArrayMemory0$1 = new Uint8Array(wasm$1.memory.buffer);\n  }\n  return cachedUint8ArrayMemory0$1;\n}\nfunction handleError$1(f, args) {\n  try {\n    return f.apply(this, args);\n  } catch (e) {\n    const idx = addToExternrefTable0$1(e);\n    wasm$1.__wbindgen_exn_store(idx);\n  }\n}\nfunction isLikeNone$1(x) {\n  return x === void 0 || x === null;\n}\nfunction passArray64ToWasm0$1(arg, malloc) {\n  const ptr = malloc(arg.length * 8, 8) >>> 0;\n  getBigUint64ArrayMemory0$1().set(arg, ptr / 8);\n  WASM_VECTOR_LEN$1 = arg.length;\n  return ptr;\n}\nfunction passArray8ToWasm0$1(arg, malloc) {\n  const ptr = malloc(arg.length * 1, 1) >>> 0;\n  getUint8ArrayMemory0$1().set(arg, ptr / 1);\n  WASM_VECTOR_LEN$1 = arg.length;\n  return ptr;\n}\nfunction passArrayJsValueToWasm0$1(array, malloc) {\n  const ptr = malloc(array.length * 4, 4) >>> 0;\n  for (let i = 0; i < array.length; i++) {\n    const add = addToExternrefTable0$1(array[i]);\n    getDataViewMemory0$1().setUint32(ptr + 4 * i, add, true);\n  }\n  WASM_VECTOR_LEN$1 = array.length;\n  return ptr;\n}\nfunction passStringToWasm0$1(arg, malloc, realloc) {\n  if (realloc === void 0) {\n    const buf = cachedTextEncoder$1.encode(arg);\n    const ptr2 = malloc(buf.length, 1) >>> 0;\n    getUint8ArrayMemory0$1().subarray(ptr2, ptr2 + buf.length).set(buf);\n    WASM_VECTOR_LEN$1 = buf.length;\n    return ptr2;\n  }\n  let len = arg.length;\n  let ptr = malloc(len, 1) >>> 0;\n  const mem = getUint8ArrayMemory0$1();\n  let offset = 0;\n  for (; offset < len; offset++) {\n    const code = arg.charCodeAt(offset);\n    if (code > 127) break;\n    mem[ptr + offset] = code;\n  }\n  if (offset !== len) {\n    if (offset !== 0) {\n      arg = arg.slice(offset);\n    }\n    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;\n    const view = getUint8ArrayMemory0$1().subarray(ptr + offset, ptr + len);\n    const ret = cachedTextEncoder$1.encodeInto(arg, view);\n    offset += ret.written;\n    ptr = realloc(ptr, len, offset, 1) >>> 0;\n  }\n  WASM_VECTOR_LEN$1 = offset;\n  return ptr;\n}\nfunction takeFromExternrefTable0$1(idx) {\n  const value = wasm$1.__wbindgen_externrefs.get(idx);\n  wasm$1.__externref_table_dealloc(idx);\n  return value;\n}\nlet cachedTextDecoder$1 = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });\ncachedTextDecoder$1.decode();\nconst MAX_SAFARI_DECODE_BYTES$1 = 2146435072;\nlet numBytesDecoded$1 = 0;\nfunction decodeText$1(ptr, len) {\n  numBytesDecoded$1 += len;\n  if (numBytesDecoded$1 >= MAX_SAFARI_DECODE_BYTES$1) {\n    cachedTextDecoder$1 = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });\n    cachedTextDecoder$1.decode();\n    numBytesDecoded$1 = len;\n  }\n  return cachedTextDecoder$1.decode(getUint8ArrayMemory0$1().subarray(ptr, ptr + len));\n}\nconst cachedTextEncoder$1 = new TextEncoder();\nif (!("encodeInto" in cachedTextEncoder$1)) {\n  cachedTextEncoder$1.encodeInto = function(arg, view) {\n    const buf = cachedTextEncoder$1.encode(arg);\n    view.set(buf);\n    return {\n      read: arg.length,\n      written: buf.length\n    };\n  };\n}\nlet WASM_VECTOR_LEN$1 = 0;\nlet wasm$1;\nfunction __wbg_finalize_init$1(instance, module) {\n  wasm$1 = instance.exports;\n  cachedBigUint64ArrayMemory0$1 = null;\n  cachedDataViewMemory0$1 = null;\n  cachedUint8ArrayMemory0$1 = null;\n  wasm$1.__wbindgen_start();\n  return wasm$1;\n}\nasync function __wbg_load$1(module, imports) {\n  if (typeof Response === "function" && module instanceof Response) {\n    if (typeof WebAssembly.instantiateStreaming === "function") {\n      try {\n        return await WebAssembly.instantiateStreaming(module, imports);\n      } catch (e) {\n        const validResponse = module.ok && expectedResponseType(module.type);\n        if (validResponse && module.headers.get("Content-Type") !== "application/wasm") {\n          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\\n", e);\n        } else {\n          throw e;\n        }\n      }\n    }\n    const bytes = await module.arrayBuffer();\n    return await WebAssembly.instantiate(bytes, imports);\n  } else {\n    const instance = await WebAssembly.instantiate(module, imports);\n    if (instance instanceof WebAssembly.Instance) {\n      return { instance, module };\n    } else {\n      return instance;\n    }\n  }\n  function expectedResponseType(type) {\n    switch (type) {\n      case "basic":\n      case "cors":\n      case "default":\n        return true;\n    }\n    return false;\n  }\n}\nfunction initSync$1(module) {\n  if (wasm$1 !== void 0) return wasm$1;\n  if (module !== void 0) {\n    if (Object.getPrototypeOf(module) === Object.prototype) {\n      ({ module } = module);\n    } else {\n      console.warn("using deprecated parameters for `initSync()`; pass a single object instead");\n    }\n  }\n  const imports = __wbg_get_imports$1();\n  if (!(module instanceof WebAssembly.Module)) {\n    module = new WebAssembly.Module(module);\n  }\n  const instance = new WebAssembly.Instance(module, imports);\n  return __wbg_finalize_init$1(instance);\n}\nasync function __wbg_init$1(module_or_path) {\n  if (wasm$1 !== void 0) return wasm$1;\n  if (module_or_path !== void 0) {\n    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {\n      ({ module_or_path } = module_or_path);\n    } else {\n      console.warn("using deprecated parameters for the initialization function; pass a single object instead");\n    }\n  }\n  if (module_or_path === void 0) {\n    module_or_path = new URL();\n  }\n  const imports = __wbg_get_imports$1();\n  if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {\n    module_or_path = fetch(module_or_path);\n  }\n  const { instance, module } = await __wbg_load$1(await module_or_path, imports);\n  return __wbg_finalize_init$1(instance);\n}\nvar defaultGlue = /* @__PURE__ */ Object.freeze({\n  __proto__: null,\n  Dialect: Dialect$1,\n  Language: Language$1,\n  Lint: Lint$1,\n  Linter: Linter$1,\n  OrganizedGroup: OrganizedGroup$1,\n  Span: Span$1,\n  Suggestion: Suggestion$1,\n  SuggestionKind: SuggestionKind$1,\n  default: __wbg_init$1,\n  get_default_lint_config: get_default_lint_config$1,\n  get_default_lint_config_as_json: get_default_lint_config_as_json$1,\n  initSync: initSync$1,\n  setup: setup$1,\n  to_title_case: to_title_case$1\n});\nconst Dialect = Object.freeze({\n  American: 0,\n  "0": "American",\n  British: 1,\n  "1": "British",\n  Australian: 2,\n  "2": "Australian",\n  Canadian: 3,\n  "3": "Canadian",\n  Indian: 4,\n  "4": "Indian"\n});\nconst Language = Object.freeze({\n  Plain: 0,\n  "0": "Plain",\n  Markdown: 1,\n  "1": "Markdown",\n  Typst: 2,\n  "2": "Typst"\n});\nclass Lint2 {\n  static __wrap(ptr) {\n    const obj = Object.create(Lint2.prototype);\n    obj.__wbg_ptr = ptr;\n    LintFinalization.register(obj, obj.__wbg_ptr, obj);\n    return obj;\n  }\n  static __unwrap(jsValue) {\n    if (!(jsValue instanceof Lint2)) {\n      return 0;\n    }\n    return jsValue.__destroy_into_raw();\n  }\n  __destroy_into_raw() {\n    const ptr = this.__wbg_ptr;\n    this.__wbg_ptr = 0;\n    LintFinalization.unregister(this);\n    return ptr;\n  }\n  free() {\n    const ptr = this.__destroy_into_raw();\n    wasm.__wbg_lint_free(ptr, 0);\n  }\n  /**\n   * @param {string} json\n   * @returns {Lint}\n   */\n  static from_json(json) {\n    const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    const ret = wasm.lint_from_json(ptr0, len0);\n    if (ret[2]) {\n      throw takeFromExternrefTable0(ret[1]);\n    }\n    return Lint2.__wrap(ret[0]);\n  }\n  /**\n   * Get the content of the source material pointed to by [`Self::span`]\n   * @returns {string}\n   */\n  get_problem_text() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.lint_get_problem_text(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a string representing the general category of the lint.\n   * @returns {string}\n   */\n  lint_kind() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.lint_lint_kind(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a string representing the general category of the lint.\n   * @returns {string}\n   */\n  lint_kind_pretty() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.lint_lint_kind_pretty(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a description of the error.\n   * @returns {string}\n   */\n  message() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.lint_message(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a description of the error as HTML.\n   * @returns {string}\n   */\n  message_html() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.lint_message_html(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get the location of the problematic text.\n   * @returns {Span}\n   */\n  span() {\n    const ret = wasm.lint_span(this.__wbg_ptr);\n    return Span2.__wrap(ret);\n  }\n  /**\n   * Equivalent to calling `.length` on the result of `suggestions()`.\n   * @returns {number}\n   */\n  suggestion_count() {\n    const ret = wasm.lint_suggestion_count(this.__wbg_ptr);\n    return ret >>> 0;\n  }\n  /**\n   * Get an array of any suggestions that may resolve the issue.\n   * @returns {Suggestion[]}\n   */\n  suggestions() {\n    const ret = wasm.lint_suggestions(this.__wbg_ptr);\n    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();\n    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);\n    return v1;\n  }\n  /**\n   * @returns {string}\n   */\n  to_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.lint_to_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n}\nif (Symbol.dispose) Lint2.prototype[Symbol.dispose] = Lint2.prototype.free;\nclass Linter2 {\n  static __wrap(ptr) {\n    const obj = Object.create(Linter2.prototype);\n    obj.__wbg_ptr = ptr;\n    LinterFinalization.register(obj, obj.__wbg_ptr, obj);\n    return obj;\n  }\n  __destroy_into_raw() {\n    const ptr = this.__wbg_ptr;\n    this.__wbg_ptr = 0;\n    LinterFinalization.unregister(this);\n    return ptr;\n  }\n  free() {\n    const ptr = this.__destroy_into_raw();\n    wasm.__wbg_linter_free(ptr, 0);\n  }\n  /**\n   * Apply a suggestion from a given lint.\n   * This action will be logged to the Linter\'s statistics.\n   * @param {string} source_text\n   * @param {Lint} lint\n   * @param {Suggestion} suggestion\n   * @returns {string}\n   */\n  apply_suggestion(source_text, lint, suggestion) {\n    let deferred3_0;\n    let deferred3_1;\n    try {\n      const ptr0 = passStringToWasm0(source_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n      const len0 = WASM_VECTOR_LEN;\n      _assertClass(lint, Lint2);\n      _assertClass(suggestion, Suggestion2);\n      const ret = wasm.linter_apply_suggestion(this.__wbg_ptr, ptr0, len0, lint.__wbg_ptr, suggestion.__wbg_ptr);\n      var ptr2 = ret[0];\n      var len2 = ret[1];\n      if (ret[3]) {\n        ptr2 = 0;\n        len2 = 0;\n        throw takeFromExternrefTable0(ret[2]);\n      }\n      deferred3_0 = ptr2;\n      deferred3_1 = len2;\n      return getStringFromWasm0(ptr2, len2);\n    } finally {\n      wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);\n    }\n  }\n  clear_ignored_lints() {\n    wasm.linter_clear_ignored_lints(this.__wbg_ptr);\n  }\n  /**\n   * Clear the user dictionary.\n   */\n  clear_words() {\n    wasm.linter_clear_words(this.__wbg_ptr);\n  }\n  /**\n   * Compute the context hash of a given lint.\n   * @param {string} source_text\n   * @param {Lint} lint\n   * @returns {bigint}\n   */\n  context_hash(source_text, lint) {\n    const ptr0 = passStringToWasm0(source_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    _assertClass(lint, Lint2);\n    const ret = wasm.linter_context_hash(this.__wbg_ptr, ptr0, len0, lint.__wbg_ptr);\n    return BigInt.asUintN(64, ret);\n  }\n  /**\n   * Export the linter\'s ignored lints as a privacy-respecting JSON list of hashes.\n   * @returns {string}\n   */\n  export_ignored_lints() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.linter_export_ignored_lints(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Export words from the dictionary.\n   * Note: this will only return words previously added by [`Self::import_words`].\n   * @returns {string[]}\n   */\n  export_words() {\n    const ret = wasm.linter_export_words(this.__wbg_ptr);\n    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();\n    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);\n    return v1;\n  }\n  /**\n   * @returns {string}\n   */\n  generate_stats_file() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.linter_generate_stats_file(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get the dialect this struct was constructed for.\n   * @returns {Dialect}\n   */\n  get_dialect() {\n    const ret = wasm.linter_get_dialect(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * @returns {string}\n   */\n  get_lint_config_as_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.linter_get_lint_config_as_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * @returns {any}\n   */\n  get_lint_config_as_object() {\n    const ret = wasm.linter_get_lint_config_as_object(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * Get a JSON map containing the descriptions of all the linting rules, formatted as Markdown.\n   * @returns {string}\n   */\n  get_lint_descriptions_as_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.linter_get_lint_descriptions_as_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a Record containing the descriptions of all the linting rules, formatted as Markdown.\n   * @returns {any}\n   */\n  get_lint_descriptions_as_object() {\n    const ret = wasm.linter_get_lint_descriptions_as_object(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * Get a JSON map containing the descriptions of all the linting rules, formatted as HTML.\n   * @returns {string}\n   */\n  get_lint_descriptions_html_as_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.linter_get_lint_descriptions_html_as_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * Get a Record containing the descriptions of all the linting rules, formatted as HTML.\n   * @returns {any}\n   */\n  get_lint_descriptions_html_as_object() {\n    const ret = wasm.linter_get_lint_descriptions_html_as_object(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * @returns {string}\n   */\n  get_structured_lint_config_as_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.linter_get_structured_lint_config_as_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * @returns {any}\n   */\n  get_structured_lint_config_as_object() {\n    const ret = wasm.linter_get_structured_lint_config_as_object(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * Add a specific context hash to the ignored lints list.\n   * @param {BigUint64Array} hashes\n   */\n  ignore_hashes(hashes) {\n    const ptr0 = passArray64ToWasm0(hashes, wasm.__wbindgen_malloc);\n    const len0 = WASM_VECTOR_LEN;\n    wasm.linter_ignore_hashes(this.__wbg_ptr, ptr0, len0);\n  }\n  /**\n   * @param {string} source_text\n   * @param {Lint[]} lints\n   */\n  ignore_lints(source_text, lints) {\n    const ptr0 = passStringToWasm0(source_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    const ptr1 = passArrayJsValueToWasm0(lints, wasm.__wbindgen_malloc);\n    const len1 = WASM_VECTOR_LEN;\n    wasm.linter_ignore_lints(this.__wbg_ptr, ptr0, len0, ptr1, len1);\n  }\n  /**\n   * Import into the linter\'s ignored lints from a privacy-respecting JSON list of hashes.\n   * @param {string} json\n   */\n  import_ignored_lints(json) {\n    const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    const ret = wasm.linter_import_ignored_lints(this.__wbg_ptr, ptr0, len0);\n    if (ret[1]) {\n      throw takeFromExternrefTable0(ret[0]);\n    }\n  }\n  /**\n   * @param {string} file\n   */\n  import_stats_file(file) {\n    const ptr0 = passStringToWasm0(file, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    const ret = wasm.linter_import_stats_file(this.__wbg_ptr, ptr0, len0);\n    if (ret[1]) {\n      throw takeFromExternrefTable0(ret[0]);\n    }\n  }\n  /**\n   * Load a Weirpack from raw bytes, merging its rules into the current linter.\n   * Returns test failures if any are found, and does not import in that case.\n   * @param {Uint8Array} bytes\n   * @returns {any}\n   */\n  import_weirpack(bytes) {\n    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);\n    const len0 = WASM_VECTOR_LEN;\n    const ret = wasm.linter_import_weirpack(this.__wbg_ptr, ptr0, len0);\n    if (ret[2]) {\n      throw takeFromExternrefTable0(ret[1]);\n    }\n    return takeFromExternrefTable0(ret[0]);\n  }\n  /**\n   * Import words into the dictionary.\n   * @param {string[]} additional_words\n   */\n  import_words(additional_words) {\n    const ptr0 = passArrayJsValueToWasm0(additional_words, wasm.__wbindgen_malloc);\n    const len0 = WASM_VECTOR_LEN;\n    wasm.linter_import_words(this.__wbg_ptr, ptr0, len0);\n  }\n  /**\n   * Helper method to quickly check if a plain string is likely intended to be English\n   * @param {string} text\n   * @returns {boolean}\n   */\n  is_likely_english(text) {\n    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    const ret = wasm.linter_is_likely_english(this.__wbg_ptr, ptr0, len0);\n    return ret !== 0;\n  }\n  /**\n   * Helper method to remove non-English text from a plain English document.\n   * @param {string} text\n   * @returns {string}\n   */\n  isolate_english(text) {\n    let deferred2_0;\n    let deferred2_1;\n    try {\n      const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n      const len0 = WASM_VECTOR_LEN;\n      const ret = wasm.linter_isolate_english(this.__wbg_ptr, ptr0, len0);\n      deferred2_0 = ret[0];\n      deferred2_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);\n    }\n  }\n  /**\n   * Perform the configured linting on the provided text.\n   *\n   * If the provided regex mask cannot be parsed, this method will return an empty array.\n   * @param {string} text\n   * @param {Language} language\n   * @param {boolean} all_headings\n   * @param {string | null | undefined} regex_mask\n   * @param {boolean} dedup\n   * @returns {Lint[]}\n   */\n  lint(text, language, all_headings, regex_mask, dedup) {\n    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    var ptr1 = isLikeNone(regex_mask) ? 0 : passStringToWasm0(regex_mask, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    var len1 = WASM_VECTOR_LEN;\n    const ret = wasm.linter_lint(this.__wbg_ptr, ptr0, len0, language, all_headings, ptr1, len1, dedup);\n    var v3 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();\n    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);\n    return v3;\n  }\n  /**\n   * Construct a new `Linter`.\n   * Note that this can mean constructing the curated dictionary, which is the most expensive operation\n   * in Harper.\n   * @param {Dialect} dialect\n   * @returns {Linter}\n   */\n  static new(dialect) {\n    const ret = wasm.linter_new(dialect);\n    return Linter2.__wrap(ret);\n  }\n  /**\n   * @param {string} text\n   * @param {Language} language\n   * @param {boolean} all_headings\n   * @param {string | null | undefined} regex_mask\n   * @param {boolean} dedup\n   * @returns {OrganizedGroup[]}\n   */\n  organized_lints(text, language, all_headings, regex_mask, dedup) {\n    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    var ptr1 = isLikeNone(regex_mask) ? 0 : passStringToWasm0(regex_mask, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    var len1 = WASM_VECTOR_LEN;\n    const ret = wasm.linter_organized_lints(this.__wbg_ptr, ptr0, len0, language, all_headings, ptr1, len1, dedup);\n    var v3 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();\n    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);\n    return v3;\n  }\n  /**\n   * @param {string} json\n   */\n  set_lint_config_from_json(json) {\n    const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    const ret = wasm.linter_set_lint_config_from_json(this.__wbg_ptr, ptr0, len0);\n    if (ret[1]) {\n      throw takeFromExternrefTable0(ret[0]);\n    }\n  }\n  /**\n   * @param {any} object\n   */\n  set_lint_config_from_object(object) {\n    const ret = wasm.linter_set_lint_config_from_object(this.__wbg_ptr, object);\n    if (ret[1]) {\n      throw takeFromExternrefTable0(ret[0]);\n    }\n  }\n  /**\n   * @param {bigint | null} [start_time]\n   * @param {bigint | null} [end_time]\n   * @returns {any}\n   */\n  summarize_stats(start_time, end_time) {\n    const ret = wasm.linter_summarize_stats(this.__wbg_ptr, !isLikeNone(start_time), isLikeNone(start_time) ? BigInt(0) : start_time, !isLikeNone(end_time), isLikeNone(end_time) ? BigInt(0) : end_time);\n    return ret;\n  }\n}\nif (Symbol.dispose) Linter2.prototype[Symbol.dispose] = Linter2.prototype.free;\nclass OrganizedGroup2 {\n  static __wrap(ptr) {\n    const obj = Object.create(OrganizedGroup2.prototype);\n    obj.__wbg_ptr = ptr;\n    OrganizedGroupFinalization.register(obj, obj.__wbg_ptr, obj);\n    return obj;\n  }\n  __destroy_into_raw() {\n    const ptr = this.__wbg_ptr;\n    this.__wbg_ptr = 0;\n    OrganizedGroupFinalization.unregister(this);\n    return ptr;\n  }\n  free() {\n    const ptr = this.__destroy_into_raw();\n    wasm.__wbg_organizedgroup_free(ptr, 0);\n  }\n  /**\n   * @returns {string}\n   */\n  get group() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.__wbg_get_organizedgroup_group(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * @returns {Lint[]}\n   */\n  get lints() {\n    const ret = wasm.__wbg_get_organizedgroup_lints(this.__wbg_ptr);\n    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();\n    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);\n    return v1;\n  }\n  /**\n   * @param {string} arg0\n   */\n  set group(arg0) {\n    const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    wasm.__wbg_set_organizedgroup_group(this.__wbg_ptr, ptr0, len0);\n  }\n  /**\n   * @param {Lint[]} arg0\n   */\n  set lints(arg0) {\n    const ptr0 = passArrayJsValueToWasm0(arg0, wasm.__wbindgen_malloc);\n    const len0 = WASM_VECTOR_LEN;\n    wasm.__wbg_set_organizedgroup_lints(this.__wbg_ptr, ptr0, len0);\n  }\n}\nif (Symbol.dispose) OrganizedGroup2.prototype[Symbol.dispose] = OrganizedGroup2.prototype.free;\nclass Span2 {\n  static __wrap(ptr) {\n    const obj = Object.create(Span2.prototype);\n    obj.__wbg_ptr = ptr;\n    SpanFinalization.register(obj, obj.__wbg_ptr, obj);\n    return obj;\n  }\n  __destroy_into_raw() {\n    const ptr = this.__wbg_ptr;\n    this.__wbg_ptr = 0;\n    SpanFinalization.unregister(this);\n    return ptr;\n  }\n  free() {\n    const ptr = this.__destroy_into_raw();\n    wasm.__wbg_span_free(ptr, 0);\n  }\n  /**\n   * @returns {number}\n   */\n  get end() {\n    const ret = wasm.__wbg_get_span_end(this.__wbg_ptr);\n    return ret >>> 0;\n  }\n  /**\n   * @returns {number}\n   */\n  get start() {\n    const ret = wasm.__wbg_get_span_start(this.__wbg_ptr);\n    return ret >>> 0;\n  }\n  /**\n   * @param {number} arg0\n   */\n  set end(arg0) {\n    wasm.__wbg_set_span_end(this.__wbg_ptr, arg0);\n  }\n  /**\n   * @param {number} arg0\n   */\n  set start(arg0) {\n    wasm.__wbg_set_span_start(this.__wbg_ptr, arg0);\n  }\n  /**\n   * @param {string} json\n   * @returns {Span}\n   */\n  static from_json(json) {\n    const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    const ret = wasm.span_from_json(ptr0, len0);\n    if (ret[2]) {\n      throw takeFromExternrefTable0(ret[1]);\n    }\n    return Span2.__wrap(ret[0]);\n  }\n  /**\n   * @returns {boolean}\n   */\n  is_empty() {\n    const ret = wasm.span_is_empty(this.__wbg_ptr);\n    return ret !== 0;\n  }\n  /**\n   * @returns {number}\n   */\n  len() {\n    const ret = wasm.span_len(this.__wbg_ptr);\n    return ret >>> 0;\n  }\n  /**\n   * @param {number} start\n   * @param {number} end\n   * @returns {Span}\n   */\n  static new(start, end) {\n    const ret = wasm.span_new(start, end);\n    return Span2.__wrap(ret);\n  }\n  /**\n   * @returns {string}\n   */\n  to_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.span_to_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n}\nif (Symbol.dispose) Span2.prototype[Symbol.dispose] = Span2.prototype.free;\nclass Suggestion2 {\n  static __wrap(ptr) {\n    const obj = Object.create(Suggestion2.prototype);\n    obj.__wbg_ptr = ptr;\n    SuggestionFinalization.register(obj, obj.__wbg_ptr, obj);\n    return obj;\n  }\n  __destroy_into_raw() {\n    const ptr = this.__wbg_ptr;\n    this.__wbg_ptr = 0;\n    SuggestionFinalization.unregister(this);\n    return ptr;\n  }\n  free() {\n    const ptr = this.__destroy_into_raw();\n    wasm.__wbg_suggestion_free(ptr, 0);\n  }\n  /**\n   * @param {string} json\n   * @returns {Suggestion}\n   */\n  static from_json(json) {\n    const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    const ret = wasm.suggestion_from_json(ptr0, len0);\n    if (ret[2]) {\n      throw takeFromExternrefTable0(ret[1]);\n    }\n    return Suggestion2.__wrap(ret[0]);\n  }\n  /**\n   * Get the text that is going to replace the problematic section.\n   * If [`Self::kind`] is `SuggestionKind::Remove`, this will return an empty\n   * string.\n   * @returns {string}\n   */\n  get_replacement_text() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.suggestion_get_replacement_text(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n  /**\n   * @returns {SuggestionKind}\n   */\n  kind() {\n    const ret = wasm.suggestion_kind(this.__wbg_ptr);\n    return ret;\n  }\n  /**\n   * @returns {string}\n   */\n  to_json() {\n    let deferred1_0;\n    let deferred1_1;\n    try {\n      const ret = wasm.suggestion_to_json(this.__wbg_ptr);\n      deferred1_0 = ret[0];\n      deferred1_1 = ret[1];\n      return getStringFromWasm0(ret[0], ret[1]);\n    } finally {\n      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n    }\n  }\n}\nif (Symbol.dispose) Suggestion2.prototype[Symbol.dispose] = Suggestion2.prototype.free;\nconst SuggestionKind = Object.freeze({\n  /**\n   * Replace the problematic text.\n   */\n  Replace: 0,\n  "0": "Replace",\n  /**\n   * Remove the problematic text.\n   */\n  Remove: 1,\n  "1": "Remove",\n  /**\n   * Insert additional text after the error.\n   */\n  InsertAfter: 2,\n  "2": "InsertAfter"\n});\nfunction get_default_lint_config() {\n  const ret = wasm.get_default_lint_config();\n  return ret;\n}\nfunction get_default_lint_config_as_json() {\n  let deferred1_0;\n  let deferred1_1;\n  try {\n    const ret = wasm.get_default_lint_config_as_json();\n    deferred1_0 = ret[0];\n    deferred1_1 = ret[1];\n    return getStringFromWasm0(ret[0], ret[1]);\n  } finally {\n    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n  }\n}\nfunction setup() {\n  wasm.setup();\n}\nfunction to_title_case(text) {\n  let deferred2_0;\n  let deferred2_1;\n  try {\n    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    const len0 = WASM_VECTOR_LEN;\n    const ret = wasm.to_title_case(ptr0, len0);\n    deferred2_0 = ret[0];\n    deferred2_1 = ret[1];\n    return getStringFromWasm0(ret[0], ret[1]);\n  } finally {\n    wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);\n  }\n}\nfunction __wbg_get_imports() {\n  const import0 = {\n    __proto__: null,\n    __wbg_Error_bce6d499ff0a4aff: function(arg0, arg1) {\n      const ret = Error(getStringFromWasm0(arg0, arg1));\n      return ret;\n    },\n    __wbg_String_8564e559799eccda: function(arg0, arg1) {\n      const ret = String(arg1);\n      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n      const len1 = WASM_VECTOR_LEN;\n      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);\n      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);\n    },\n    __wbg___wbindgen_boolean_get_2304fb8c853028c8: function(arg0) {\n      const v = arg0;\n      const ret = typeof v === "boolean" ? v : void 0;\n      return isLikeNone(ret) ? 16777215 : ret ? 1 : 0;\n    },\n    __wbg___wbindgen_debug_string_edece8177ad01481: function(arg0, arg1) {\n      const ret = debugString(arg1);\n      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n      const len1 = WASM_VECTOR_LEN;\n      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);\n      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);\n    },\n    __wbg___wbindgen_is_function_5cd60d5cf78b4eef: function(arg0) {\n      const ret = typeof arg0 === "function";\n      return ret;\n    },\n    __wbg___wbindgen_is_object_b4593df85baada48: function(arg0) {\n      const val = arg0;\n      const ret = typeof val === "object" && val !== null;\n      return ret;\n    },\n    __wbg___wbindgen_is_string_dde0fd9020db4434: function(arg0) {\n      const ret = typeof arg0 === "string";\n      return ret;\n    },\n    __wbg___wbindgen_jsval_loose_eq_0ad77b7717db155c: function(arg0, arg1) {\n      const ret = arg0 == arg1;\n      return ret;\n    },\n    __wbg___wbindgen_number_get_f73a1244370fcc2c: function(arg0, arg1) {\n      const obj = arg1;\n      const ret = typeof obj === "number" ? obj : void 0;\n      getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);\n      getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);\n    },\n    __wbg___wbindgen_string_get_d109740c0d18f4d7: function(arg0, arg1) {\n      const obj = arg1;\n      const ret = typeof obj === "string" ? obj : void 0;\n      var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n      var len1 = WASM_VECTOR_LEN;\n      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);\n      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);\n    },\n    __wbg___wbindgen_throw_9c31b086c2b26051: function(arg0, arg1) {\n      throw new Error(getStringFromWasm0(arg0, arg1));\n    },\n    __wbg_call_13665d9f14390edc: function() {\n      return handleError(function(arg0, arg1) {\n        const ret = arg0.call(arg1);\n        return ret;\n      }, arguments);\n    },\n    __wbg_done_54b8da57023b7ed2: function(arg0) {\n      const ret = arg0.done;\n      return ret;\n    },\n    __wbg_entries_564a7e8b1e54ede5: function(arg0) {\n      const ret = Object.entries(arg0);\n      return ret;\n    },\n    __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {\n      let deferred0_0;\n      let deferred0_1;\n      try {\n        deferred0_0 = arg0;\n        deferred0_1 = arg1;\n        console.error(getStringFromWasm0(arg0, arg1));\n      } finally {\n        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);\n      }\n    },\n    __wbg_getRandomValues_3f44b700395062e5: function() {\n      return handleError(function(arg0, arg1) {\n        globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));\n      }, arguments);\n    },\n    __wbg_getRandomValues_d49329ff89a07af1: function() {\n      return handleError(function(arg0, arg1) {\n        globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));\n      }, arguments);\n    },\n    __wbg_getTime_09f1dd40a44edb30: function(arg0) {\n      const ret = arg0.getTime();\n      return ret;\n    },\n    __wbg_get_3e9a707ab7d352eb: function() {\n      return handleError(function(arg0, arg1) {\n        const ret = Reflect.get(arg0, arg1);\n        return ret;\n      }, arguments);\n    },\n    __wbg_get_98fdf51d029a75eb: function(arg0, arg1) {\n      const ret = arg0[arg1 >>> 0];\n      return ret;\n    },\n    __wbg_get_unchecked_1dfe6d05ad91d9b7: function(arg0, arg1) {\n      const ret = arg0[arg1 >>> 0];\n      return ret;\n    },\n    __wbg_instanceof_ArrayBuffer_53db37b06f6b9afe: function(arg0) {\n      let result;\n      try {\n        result = arg0 instanceof ArrayBuffer;\n      } catch (_) {\n        result = false;\n      }\n      const ret = result;\n      return ret;\n    },\n    __wbg_instanceof_Uint8Array_abd07d4bd221d50b: function(arg0) {\n      let result;\n      try {\n        result = arg0 instanceof Uint8Array;\n      } catch (_) {\n        result = false;\n      }\n      const ret = result;\n      return ret;\n    },\n    __wbg_iterator_1441b47f341dc34f: function() {\n      const ret = Symbol.iterator;\n      return ret;\n    },\n    __wbg_length_2591a0f4f659a55c: function(arg0) {\n      const ret = arg0.length;\n      return ret;\n    },\n    __wbg_length_56fcd3e2b7e0299d: function(arg0) {\n      const ret = arg0.length;\n      return ret;\n    },\n    __wbg_lint_new: function(arg0) {\n      const ret = Lint2.__wrap(arg0);\n      return ret;\n    },\n    __wbg_lint_unwrap: function(arg0) {\n      const ret = Lint2.__unwrap(arg0);\n      return ret;\n    },\n    __wbg_log_0c201ade58bb55e1: function(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {\n      let deferred0_0;\n      let deferred0_1;\n      try {\n        deferred0_0 = arg0;\n        deferred0_1 = arg1;\n        console.log(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3), getStringFromWasm0(arg4, arg5), getStringFromWasm0(arg6, arg7));\n      } finally {\n        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);\n      }\n    },\n    __wbg_log_ce2c4456b290c5e7: function(arg0, arg1) {\n      let deferred0_0;\n      let deferred0_1;\n      try {\n        deferred0_0 = arg0;\n        deferred0_1 = arg1;\n        console.log(getStringFromWasm0(arg0, arg1));\n      } finally {\n        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);\n      }\n    },\n    __wbg_mark_b4d943f3bc2d2404: function(arg0, arg1) {\n      performance.mark(getStringFromWasm0(arg0, arg1));\n    },\n    __wbg_measure_84362959e621a2c1: function() {\n      return handleError(function(arg0, arg1, arg2, arg3) {\n        let deferred0_0;\n        let deferred0_1;\n        let deferred1_0;\n        let deferred1_1;\n        try {\n          deferred0_0 = arg0;\n          deferred0_1 = arg1;\n          deferred1_0 = arg2;\n          deferred1_1 = arg3;\n          performance.measure(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));\n        } finally {\n          wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);\n          wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);\n        }\n      }, arguments);\n    },\n    __wbg_new_02d162bc6cf02f60: function() {\n      const ret = new Object();\n      return ret;\n    },\n    __wbg_new_070df68d66325372: function() {\n      const ret = /* @__PURE__ */ new Map();\n      return ret;\n    },\n    __wbg_new_0_2722fcdb71a888a6: function() {\n      const ret = /* @__PURE__ */ new Date();\n      return ret;\n    },\n    __wbg_new_227d7c05414eb861: function() {\n      const ret = new Error();\n      return ret;\n    },\n    __wbg_new_310879b66b6e95e1: function() {\n      const ret = new Array();\n      return ret;\n    },\n    __wbg_new_7ddec6de44ff8f5d: function(arg0) {\n      const ret = new Uint8Array(arg0);\n      return ret;\n    },\n    __wbg_next_2a4e19f4f5083b0f: function(arg0) {\n      const ret = arg0.next;\n      return ret;\n    },\n    __wbg_next_6429a146bf756f93: function() {\n      return handleError(function(arg0) {\n        const ret = arg0.next();\n        return ret;\n      }, arguments);\n    },\n    __wbg_organizedgroup_new: function(arg0) {\n      const ret = OrganizedGroup2.__wrap(arg0);\n      return ret;\n    },\n    __wbg_prototypesetcall_5f9bdc8d75e07276: function(arg0, arg1, arg2) {\n      Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);\n    },\n    __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {\n      arg0[arg1] = arg2;\n    },\n    __wbg_set_78ea6a19f4818587: function(arg0, arg1, arg2) {\n      arg0[arg1 >>> 0] = arg2;\n    },\n    __wbg_set_facb7a5914e0fa39: function(arg0, arg1, arg2) {\n      const ret = arg0.set(arg1, arg2);\n      return ret;\n    },\n    __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {\n      const ret = arg1.stack;\n      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n      const len1 = WASM_VECTOR_LEN;\n      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);\n      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);\n    },\n    __wbg_suggestion_new: function(arg0) {\n      const ret = Suggestion2.__wrap(arg0);\n      return ret;\n    },\n    __wbg_value_9cc0518af87a489c: function(arg0) {\n      const ret = arg0.value;\n      return ret;\n    },\n    __wbindgen_cast_0000000000000001: function(arg0) {\n      const ret = arg0;\n      return ret;\n    },\n    __wbindgen_cast_0000000000000002: function(arg0, arg1) {\n      const ret = getStringFromWasm0(arg0, arg1);\n      return ret;\n    },\n    __wbindgen_init_externref_table: function() {\n      const table = wasm.__wbindgen_externrefs;\n      const offset = table.grow(4);\n      table.set(0, void 0);\n      table.set(offset + 0, void 0);\n      table.set(offset + 1, null);\n      table.set(offset + 2, true);\n      table.set(offset + 3, false);\n    }\n  };\n  return {\n    __proto__: null,\n    "./harper_wasm_bg.js": import0\n  };\n}\nconst LintFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {\n}, unregister: () => {\n} } : new FinalizationRegistry((ptr) => wasm.__wbg_lint_free(ptr, 1));\nconst LinterFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {\n}, unregister: () => {\n} } : new FinalizationRegistry((ptr) => wasm.__wbg_linter_free(ptr, 1));\nconst OrganizedGroupFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {\n}, unregister: () => {\n} } : new FinalizationRegistry((ptr) => wasm.__wbg_organizedgroup_free(ptr, 1));\nconst SpanFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {\n}, unregister: () => {\n} } : new FinalizationRegistry((ptr) => wasm.__wbg_span_free(ptr, 1));\nconst SuggestionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {\n}, unregister: () => {\n} } : new FinalizationRegistry((ptr) => wasm.__wbg_suggestion_free(ptr, 1));\nfunction addToExternrefTable0(obj) {\n  const idx = wasm.__externref_table_alloc();\n  wasm.__wbindgen_externrefs.set(idx, obj);\n  return idx;\n}\nfunction _assertClass(instance, klass) {\n  if (!(instance instanceof klass)) {\n    throw new Error(`expected instance of ${klass.name}`);\n  }\n}\nfunction debugString(val) {\n  const type = typeof val;\n  if (type == "number" || type == "boolean" || val == null) {\n    return `${val}`;\n  }\n  if (type == "string") {\n    return `"${val}"`;\n  }\n  if (type == "symbol") {\n    const description = val.description;\n    if (description == null) {\n      return "Symbol";\n    } else {\n      return `Symbol(${description})`;\n    }\n  }\n  if (type == "function") {\n    const name = val.name;\n    if (typeof name == "string" && name.length > 0) {\n      return `Function(${name})`;\n    } else {\n      return "Function";\n    }\n  }\n  if (Array.isArray(val)) {\n    const length = val.length;\n    let debug = "[";\n    if (length > 0) {\n      debug += debugString(val[0]);\n    }\n    for (let i = 1; i < length; i++) {\n      debug += ", " + debugString(val[i]);\n    }\n    debug += "]";\n    return debug;\n  }\n  const builtInMatches = /\\[object ([^\\]]+)\\]/.exec(toString.call(val));\n  let className;\n  if (builtInMatches && builtInMatches.length > 1) {\n    className = builtInMatches[1];\n  } else {\n    return toString.call(val);\n  }\n  if (className == "Object") {\n    try {\n      return "Object(" + JSON.stringify(val) + ")";\n    } catch (_) {\n      return "Object";\n    }\n  }\n  if (val instanceof Error) {\n    return `${val.name}: ${val.message}\n${val.stack}`;\n  }\n  return className;\n}\nfunction getArrayJsValueFromWasm0(ptr, len) {\n  ptr = ptr >>> 0;\n  const mem = getDataViewMemory0();\n  const result = [];\n  for (let i = ptr; i < ptr + 4 * len; i += 4) {\n    result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));\n  }\n  wasm.__externref_drop_slice(ptr, len);\n  return result;\n}\nfunction getArrayU8FromWasm0(ptr, len) {\n  ptr = ptr >>> 0;\n  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);\n}\nlet cachedBigUint64ArrayMemory0 = null;\nfunction getBigUint64ArrayMemory0() {\n  if (cachedBigUint64ArrayMemory0 === null || cachedBigUint64ArrayMemory0.byteLength === 0) {\n    cachedBigUint64ArrayMemory0 = new BigUint64Array(wasm.memory.buffer);\n  }\n  return cachedBigUint64ArrayMemory0;\n}\nlet cachedDataViewMemory0 = null;\nfunction getDataViewMemory0() {\n  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) {\n    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);\n  }\n  return cachedDataViewMemory0;\n}\nfunction getStringFromWasm0(ptr, len) {\n  return decodeText(ptr >>> 0, len);\n}\nlet cachedUint8ArrayMemory0 = null;\nfunction getUint8ArrayMemory0() {\n  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {\n    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);\n  }\n  return cachedUint8ArrayMemory0;\n}\nfunction handleError(f, args) {\n  try {\n    return f.apply(this, args);\n  } catch (e) {\n    const idx = addToExternrefTable0(e);\n    wasm.__wbindgen_exn_store(idx);\n  }\n}\nfunction isLikeNone(x) {\n  return x === void 0 || x === null;\n}\nfunction passArray64ToWasm0(arg, malloc) {\n  const ptr = malloc(arg.length * 8, 8) >>> 0;\n  getBigUint64ArrayMemory0().set(arg, ptr / 8);\n  WASM_VECTOR_LEN = arg.length;\n  return ptr;\n}\nfunction passArray8ToWasm0(arg, malloc) {\n  const ptr = malloc(arg.length * 1, 1) >>> 0;\n  getUint8ArrayMemory0().set(arg, ptr / 1);\n  WASM_VECTOR_LEN = arg.length;\n  return ptr;\n}\nfunction passArrayJsValueToWasm0(array, malloc) {\n  const ptr = malloc(array.length * 4, 4) >>> 0;\n  for (let i = 0; i < array.length; i++) {\n    const add = addToExternrefTable0(array[i]);\n    getDataViewMemory0().setUint32(ptr + 4 * i, add, true);\n  }\n  WASM_VECTOR_LEN = array.length;\n  return ptr;\n}\nfunction passStringToWasm0(arg, malloc, realloc) {\n  if (realloc === void 0) {\n    const buf = cachedTextEncoder.encode(arg);\n    const ptr2 = malloc(buf.length, 1) >>> 0;\n    getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);\n    WASM_VECTOR_LEN = buf.length;\n    return ptr2;\n  }\n  let len = arg.length;\n  let ptr = malloc(len, 1) >>> 0;\n  const mem = getUint8ArrayMemory0();\n  let offset = 0;\n  for (; offset < len; offset++) {\n    const code = arg.charCodeAt(offset);\n    if (code > 127) break;\n    mem[ptr + offset] = code;\n  }\n  if (offset !== len) {\n    if (offset !== 0) {\n      arg = arg.slice(offset);\n    }\n    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;\n    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);\n    const ret = cachedTextEncoder.encodeInto(arg, view);\n    offset += ret.written;\n    ptr = realloc(ptr, len, offset, 1) >>> 0;\n  }\n  WASM_VECTOR_LEN = offset;\n  return ptr;\n}\nfunction takeFromExternrefTable0(idx) {\n  const value = wasm.__wbindgen_externrefs.get(idx);\n  wasm.__externref_table_dealloc(idx);\n  return value;\n}\nlet cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });\ncachedTextDecoder.decode();\nconst MAX_SAFARI_DECODE_BYTES = 2146435072;\nlet numBytesDecoded = 0;\nfunction decodeText(ptr, len) {\n  numBytesDecoded += len;\n  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {\n    cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });\n    cachedTextDecoder.decode();\n    numBytesDecoded = len;\n  }\n  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));\n}\nconst cachedTextEncoder = new TextEncoder();\nif (!("encodeInto" in cachedTextEncoder)) {\n  cachedTextEncoder.encodeInto = function(arg, view) {\n    const buf = cachedTextEncoder.encode(arg);\n    view.set(buf);\n    return {\n      read: arg.length,\n      written: buf.length\n    };\n  };\n}\nlet WASM_VECTOR_LEN = 0;\nlet wasm;\nfunction __wbg_finalize_init(instance, module) {\n  wasm = instance.exports;\n  cachedBigUint64ArrayMemory0 = null;\n  cachedDataViewMemory0 = null;\n  cachedUint8ArrayMemory0 = null;\n  wasm.__wbindgen_start();\n  return wasm;\n}\nasync function __wbg_load(module, imports) {\n  if (typeof Response === "function" && module instanceof Response) {\n    if (typeof WebAssembly.instantiateStreaming === "function") {\n      try {\n        return await WebAssembly.instantiateStreaming(module, imports);\n      } catch (e) {\n        const validResponse = module.ok && expectedResponseType(module.type);\n        if (validResponse && module.headers.get("Content-Type") !== "application/wasm") {\n          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\\n", e);\n        } else {\n          throw e;\n        }\n      }\n    }\n    const bytes = await module.arrayBuffer();\n    return await WebAssembly.instantiate(bytes, imports);\n  } else {\n    const instance = await WebAssembly.instantiate(module, imports);\n    if (instance instanceof WebAssembly.Instance) {\n      return { instance, module };\n    } else {\n      return instance;\n    }\n  }\n  function expectedResponseType(type) {\n    switch (type) {\n      case "basic":\n      case "cors":\n      case "default":\n        return true;\n    }\n    return false;\n  }\n}\nfunction initSync(module) {\n  if (wasm !== void 0) return wasm;\n  if (module !== void 0) {\n    if (Object.getPrototypeOf(module) === Object.prototype) {\n      ({ module } = module);\n    } else {\n      console.warn("using deprecated parameters for `initSync()`; pass a single object instead");\n    }\n  }\n  const imports = __wbg_get_imports();\n  if (!(module instanceof WebAssembly.Module)) {\n    module = new WebAssembly.Module(module);\n  }\n  const instance = new WebAssembly.Instance(module, imports);\n  return __wbg_finalize_init(instance);\n}\nasync function __wbg_init(module_or_path) {\n  if (wasm !== void 0) return wasm;\n  if (module_or_path !== void 0) {\n    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {\n      ({ module_or_path } = module_or_path);\n    } else {\n      console.warn("using deprecated parameters for the initialization function; pass a single object instead");\n    }\n  }\n  if (module_or_path === void 0) {\n    module_or_path = new URL();\n  }\n  const imports = __wbg_get_imports();\n  if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {\n    module_or_path = fetch(module_or_path);\n  }\n  const { instance, module } = await __wbg_load(await module_or_path, imports);\n  return __wbg_finalize_init(instance);\n}\nvar fullGlue = /* @__PURE__ */ Object.freeze({\n  __proto__: null,\n  Dialect,\n  Language,\n  Lint: Lint2,\n  Linter: Linter2,\n  OrganizedGroup: OrganizedGroup2,\n  Span: Span2,\n  Suggestion: Suggestion2,\n  SuggestionKind,\n  default: __wbg_init,\n  get_default_lint_config,\n  get_default_lint_config_as_json,\n  initSync,\n  setup,\n  to_title_case\n});\nconst _PLazy = class _PLazy extends Promise {\n  constructor(executor) {\n    super((resolve) => {\n      resolve();\n    });\n    __privateAdd(this, _executor);\n    __privateAdd(this, _promise);\n    __privateSet(this, _executor, executor);\n  }\n  static from(function_) {\n    return new _PLazy((resolve) => {\n      resolve(function_());\n    });\n  }\n  static resolve(value) {\n    return new _PLazy((resolve) => {\n      resolve(value);\n    });\n  }\n  static reject(error) {\n    return new _PLazy((resolve, reject) => {\n      reject(error);\n    });\n  }\n  then(onFulfilled, onRejected) {\n    __privateGet(this, _promise) ?? __privateSet(this, _promise, new Promise(__privateGet(this, _executor)));\n    return __privateGet(this, _promise).then(onFulfilled, onRejected);\n  }\n  catch(onRejected) {\n    __privateGet(this, _promise) ?? __privateSet(this, _promise, new Promise(__privateGet(this, _executor)));\n    return __privateGet(this, _promise).catch(onRejected);\n  }\n  finally(onFinally) {\n    __privateGet(this, _promise) ?? __privateSet(this, _promise, new Promise(__privateGet(this, _executor)));\n    return __privateGet(this, _promise).finally(onFinally);\n  }\n};\n_executor = new WeakMap();\n_promise = new WeakMap();\nlet PLazy = _PLazy;\nconst copyProperty = (to, from, property, ignoreNonConfigurable) => {\n  if (property === "length" || property === "prototype") {\n    return;\n  }\n  if (property === "arguments" || property === "caller") {\n    return;\n  }\n  const toDescriptor = Object.getOwnPropertyDescriptor(to, property);\n  const fromDescriptor = Object.getOwnPropertyDescriptor(from, property);\n  if (!canCopyProperty(toDescriptor, fromDescriptor) && ignoreNonConfigurable) {\n    return;\n  }\n  Object.defineProperty(to, property, fromDescriptor);\n};\nconst canCopyProperty = function(toDescriptor, fromDescriptor) {\n  return toDescriptor === void 0 || toDescriptor.configurable || toDescriptor.writable === fromDescriptor.writable && toDescriptor.enumerable === fromDescriptor.enumerable && toDescriptor.configurable === fromDescriptor.configurable && (toDescriptor.writable || toDescriptor.value === fromDescriptor.value);\n};\nconst changePrototype = (to, from) => {\n  const fromPrototype = Object.getPrototypeOf(from);\n  if (fromPrototype === Object.getPrototypeOf(to)) {\n    return;\n  }\n  Object.setPrototypeOf(to, fromPrototype);\n};\nconst wrappedToString = (withName, fromBody) => `/* Wrapped ${withName}*/\n${fromBody}`;\nconst toStringDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, "toString");\nconst toStringName = Object.getOwnPropertyDescriptor(Function.prototype.toString, "name");\nconst changeToString = (to, from, name) => {\n  const withName = name === "" ? "" : `with ${name.trim()}() `;\n  const newToString = wrappedToString.bind(null, withName, from.toString());\n  Object.defineProperty(newToString, "name", toStringName);\n  Object.defineProperty(to, "toString", { ...toStringDescriptor, value: newToString });\n};\nfunction mimicFunction(to, from, { ignoreNonConfigurable = false } = {}) {\n  const { name } = to;\n  for (const property of Reflect.ownKeys(from)) {\n    copyProperty(to, from, property, ignoreNonConfigurable);\n  }\n  changePrototype(to, from);\n  changeToString(to, from, name);\n  return to;\n}\nconst cacheStore = /* @__PURE__ */ new WeakMap();\nfunction pMemoize(fn, { cacheKey = ([firstArgument]) => firstArgument, cache = /* @__PURE__ */ new Map() } = {}) {\n  const promiseCache = /* @__PURE__ */ new Map();\n  const memoized = function(...arguments_) {\n    const key = cacheKey(arguments_);\n    if (promiseCache.has(key)) {\n      return promiseCache.get(key);\n    }\n    const promise = (async () => {\n      try {\n        if (cache && await cache.has(key)) {\n          return await cache.get(key);\n        }\n        const promise2 = fn.apply(this, arguments_);\n        const result = await promise2;\n        try {\n          return result;\n        } finally {\n          if (cache) {\n            await cache.set(key, result);\n          }\n        }\n      } finally {\n        promiseCache.delete(key);\n      }\n    })();\n    promiseCache.set(key, promise);\n    return promise;\n  };\n  mimicFunction(memoized, fn, {\n    ignoreNonConfigurable: true\n  });\n  cacheStore.set(memoized, cache);\n  return memoized;\n}\nfunction inferGlueFlavor(binary) {\n  return binary.includes("harper_wasm_slim") ? "slim" : "full";\n}\nfunction loadGlue(glueFlavor) {\n  if (glueFlavor === "slim") {\n    return defaultGlue;\n  }\n  return fullGlue;\n}\nfunction getDefaultGlueBinary(binary, glueFlavor) {\n  if (glueFlavor === "slim") {\n    return binary;\n  }\n  if (binary.includes("harper_wasm_bg.wasm")) {\n    return binary.replace("harper_wasm_bg.wasm", "harper_wasm_slim_bg.wasm");\n  }\n  return null;\n}\nfunction getInitInput(binary) {\n  if (typeof process !== "undefined" && binary.startsWith("file://")) {\n    return Promise.resolve().then(function() {\n      return __viteBrowserExternal$1;\n    }).then(\n      (fs) => new Promise((resolve, reject) => {\n        fs.readFile(new URL(binary).pathname, (err, data) => {\n          if (err) reject(err);\n          resolve(data);\n        });\n      })\n    );\n  }\n  return binary;\n}\nasync function loadBinaryUncached(binary, glueFlavor) {\n  const exports = loadGlue(glueFlavor);\n  const defaultGlueBinary = getDefaultGlueBinary(binary, glueFlavor);\n  if (defaultGlueBinary != null) {\n    try {\n      await __wbg_init$1({ module_or_path: getInitInput(defaultGlueBinary) });\n    } catch (err) {\n      if (glueFlavor === "slim") {\n        throw err;\n      }\n    }\n  }\n  await exports.default({ module_or_path: getInitInput(binary) });\n  return exports;\n}\nconst loadBinaryByFlavor = {\n  full: pMemoize((binary) => loadBinaryUncached(binary, "full")),\n  slim: pMemoize((binary) => loadBinaryUncached(binary, "slim"))\n};\nfunction loadBinary(binary, glueFlavor) {\n  return loadBinaryByFlavor[glueFlavor](binary);\n}\nclass BinaryModuleImpl {\n  constructor() {\n    __publicField(this, "url", "");\n    __publicField(this, "glueFlavor", "full");\n    __publicField(this, "inner", null);\n  }\n  /** Load a binary from a specified URL. This is the only recommended way to construct this type. */\n  static create(url, glueFlavor) {\n    const module = new SuperBinaryModule();\n    module.url = url;\n    module.glueFlavor = glueFlavor ?? inferGlueFlavor(typeof url === "string" ? url : url.href);\n    module.inner = PLazy.from(\n      () => loadBinary(typeof module.url === "string" ? module.url : module.url.href, module.glueFlavor)\n    );\n    return module;\n  }\n  async getDefaultLintConfigAsJSON() {\n    const exported = await this.inner;\n    return exported.get_default_lint_config_as_json();\n  }\n  async getDefaultLintConfig() {\n    const exported = await this.inner;\n    return exported.get_default_lint_config();\n  }\n  async toTitleCase(text) {\n    const exported = await this.inner;\n    return exported.to_title_case(text);\n  }\n  async setup() {\n    const exported = await this.inner;\n    exported.setup();\n  }\n}\nclass SuperBinaryModule extends BinaryModuleImpl {\n  async createLinter(dialect) {\n    const exported = await this.getBinaryModule();\n    return exported.Linter.new(dialect ?? Dialect$1.American);\n  }\n  async getBinaryModule() {\n    return await PLazy.from(\n      () => loadBinary(typeof this.url === "string" ? this.url : this.url.href, this.glueFlavor)\n    );\n  }\n}\nclass LocalLinter {\n  constructor(init) {\n    __publicField(this, "binary");\n    __publicField(this, "inner");\n    __publicField(this, "disposed", false);\n    this.binary = init.binary;\n    this.binary.setup();\n    this.inner = this.createInner(init.dialect);\n  }\n  createInner(dialect) {\n    return PLazy.from(async () => {\n      await this.binary.setup();\n      return this.binary.createLinter(dialect);\n    });\n  }\n  async setup() {\n    await this.lint("", { language: "plaintext" });\n    const exported = await this.exportIgnoredLints();\n    await this.importIgnoredLints(exported);\n  }\n  async lint(text, options) {\n    const inner = await this.inner;\n    let language = Language$1.Markdown;\n    switch (options == null ? void 0 : options.language) {\n      case "plaintext":\n        language = Language$1.Plain;\n        break;\n      case "markdown":\n        language = Language$1.Markdown;\n        break;\n      case "typst":\n        language = Language$1.Typst;\n    }\n    const lints = inner.lint(\n      text,\n      language,\n      (options == null ? void 0 : options.forceAllHeadings) ?? false,\n      options == null ? void 0 : options.regex_mask,\n      (options == null ? void 0 : options.dedup) ?? true\n    );\n    return lints;\n  }\n  async organizedLints(text, options) {\n    const inner = await this.inner;\n    let language = Language$1.Markdown;\n    switch (options == null ? void 0 : options.language) {\n      case "plaintext":\n        language = Language$1.Plain;\n        break;\n      case "markdown":\n        language = Language$1.Markdown;\n        break;\n      case "typst":\n        language = Language$1.Typst;\n        break;\n    }\n    const lintGroups = inner.organized_lints(\n      text,\n      language,\n      (options == null ? void 0 : options.forceAllHeadings) ?? false,\n      options == null ? void 0 : options.regex_mask,\n      (options == null ? void 0 : options.dedup) ?? true\n    );\n    const output = {};\n    for (const group of lintGroups) {\n      output[group.group] = group.lints;\n      group.free();\n    }\n    return output;\n  }\n  async applySuggestion(text, lint, suggestion) {\n    const inner = await this.inner;\n    return inner.apply_suggestion(text, lint, suggestion);\n  }\n  async isLikelyEnglish(text) {\n    const inner = await this.inner;\n    return inner.is_likely_english(text);\n  }\n  async isolateEnglish(text) {\n    const inner = await this.inner;\n    return inner.isolate_english(text);\n  }\n  async getLintConfig() {\n    const inner = await this.inner;\n    return inner.get_lint_config_as_object();\n  }\n  async getDefaultLintConfigAsJSON() {\n    return await this.binary.getDefaultLintConfigAsJSON();\n  }\n  async getDefaultLintConfig() {\n    return await this.binary.getDefaultLintConfig();\n  }\n  async getStructuredLintConfig() {\n    const inner = await this.inner;\n    return inner.get_structured_lint_config_as_object();\n  }\n  async getStructuredLintConfigJSON() {\n    const inner = await this.inner;\n    return inner.get_structured_lint_config_as_json();\n  }\n  async setLintConfig(config) {\n    const inner = await this.inner;\n    inner.set_lint_config_from_object(config);\n  }\n  async getLintConfigAsJSON() {\n    const inner = await this.inner;\n    return inner.get_lint_config_as_json();\n  }\n  async setLintConfigWithJSON(config) {\n    const inner = await this.inner;\n    inner.set_lint_config_from_json(config);\n  }\n  async toTitleCase(text) {\n    return await this.binary.toTitleCase(text);\n  }\n  async getLintDescriptions() {\n    const inner = await this.inner;\n    return inner.get_lint_descriptions_as_object();\n  }\n  async getLintDescriptionsAsJSON() {\n    const inner = await this.inner;\n    return inner.get_lint_descriptions_as_json();\n  }\n  async getLintDescriptionsHTML() {\n    const inner = await this.inner;\n    return inner.get_lint_descriptions_html_as_object();\n  }\n  async getLintDescriptionsHTMLAsJSON() {\n    const inner = await this.inner;\n    return inner.get_lint_descriptions_html_as_json();\n  }\n  async ignoreLint(source, lint) {\n    return await this.ignoreLints(source, [lint]);\n  }\n  async ignoreLints(source, lints) {\n    const inner = await this.inner;\n    inner.ignore_lints(source, lints);\n  }\n  async ignoreLintHash(hash) {\n    const inner = await this.inner;\n    inner.ignore_hashes(new BigUint64Array([hash]));\n  }\n  async exportIgnoredLints() {\n    const inner = await this.inner;\n    return inner.export_ignored_lints();\n  }\n  async importIgnoredLints(json) {\n    const inner = await this.inner;\n    inner.import_ignored_lints(json);\n  }\n  async contextHash(source, lint) {\n    const inner = await this.inner;\n    return inner.context_hash(source, lint);\n  }\n  async clearIgnoredLints() {\n    const inner = await this.inner;\n    inner.clear_ignored_lints();\n  }\n  async clearWords() {\n    const inner = await this.inner;\n    return inner.clear_words();\n  }\n  async importWords(words) {\n    const inner = await this.inner;\n    return inner.import_words(words);\n  }\n  async exportWords() {\n    const inner = await this.inner;\n    return inner.export_words();\n  }\n  async getDialect() {\n    const inner = await this.inner;\n    return inner.get_dialect();\n  }\n  async setDialect(dialect) {\n    const inner = await this.inner;\n    if (inner.get_dialect() !== dialect) {\n      inner.free();\n      this.inner = this.createInner(dialect);\n    }\n    return Promise.resolve();\n  }\n  async summarizeStats(start, end) {\n    const inner = await this.inner;\n    return inner.summarize_stats(start, end);\n  }\n  async generateStatsFile() {\n    const inner = await this.inner;\n    return inner.generate_stats_file();\n  }\n  async importStatsFile(statsFile) {\n    const inner = await this.inner;\n    return inner.import_stats_file(statsFile);\n  }\n  /**\n   * Load a Weirpack from a Blob.\n   *\n   * Returns `undefined` if tests pass and rules are imported, otherwise returns\n   * the Weirpack test failures.\n   */\n  async loadWeirpackFromBlob(blob) {\n    const bytes = new Uint8Array(await blob.arrayBuffer());\n    return this.loadWeirpackFromBytes(bytes);\n  }\n  /**\n   * Load a Weirpack from a byte array.\n   *\n   * Returns `undefined` if tests pass and rules are imported, otherwise returns\n   * the Weirpack test failures.\n   */\n  async loadWeirpackFromBytes(bytes) {\n    const inner = await this.inner;\n    const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);\n    const result = inner.import_weirpack(data);\n    return result;\n  }\n  async dispose() {\n    if (this.disposed) {\n      return;\n    }\n    this.disposed = true;\n    const inner = await this.inner;\n    inner.free();\n  }\n}\nfunction assert(condition, message) {\n  if (!condition) {\n    throw new Error("Assertion failed");\n  }\n}\nfunction isSerializedRequest(v) {\n  return typeof v === "object" && v !== null && "procName" in v && "args" in v;\n}\nclass Serializer {\n  constructor(binary) {\n    __publicField(this, "binary");\n    this.binary = binary;\n    this.binary.setup();\n  }\n  async serializeArg(arg) {\n    var _a;\n    const { Lint: Lint3, Span: Span3, Suggestion: Suggestion3 } = await this.binary.getBinaryModule();\n    if (Array.isArray(arg)) {\n      return {\n        json: JSON.stringify(await Promise.all(arg.map((a) => this.serializeArg(a)))),\n        type: "Array"\n      };\n    }\n    const argType = typeof arg;\n    switch (argType) {\n      case "string":\n      case "number":\n      case "boolean":\n      case "undefined":\n        return { json: JSON.stringify(arg), type: argType };\n      case "bigint":\n        return { json: arg.toString(), type: argType };\n    }\n    if (arg.to_json !== void 0) {\n      const json = arg.to_json();\n      let type;\n      const constructorName = (_a = arg.constructor) == null ? void 0 : _a.name;\n      if (arg instanceof Lint3 || constructorName === "Lint") {\n        type = "Lint";\n      } else if (arg instanceof Suggestion3 || constructorName === "Suggestion") {\n        type = "Suggestion";\n      } else if (arg instanceof Span3 || constructorName === "Span") {\n        type = "Span";\n      }\n      if (type === void 0) {\n        throw new Error("Unhandled case: type undefined");\n      }\n      return { json, type };\n    }\n    if (argType == "object") {\n      return {\n        json: JSON.stringify(\n          await Promise.all(\n            Object.entries(arg).map(([key, value]) => this.serializeArg([key, value]))\n          )\n        ),\n        type: "object"\n      };\n    }\n    throw new Error(`Unhandled case: ${arg}`);\n  }\n  async serialize(req) {\n    return {\n      procName: req.procName,\n      args: await Promise.all(req.args.map((arg) => this.serializeArg(arg)))\n    };\n  }\n  async deserializeArg(requestArg) {\n    const { Lint: Lint3, Span: Span3, Suggestion: Suggestion3 } = await this.binary.getBinaryModule();\n    switch (requestArg.type) {\n      case "bigint":\n        return BigInt(requestArg.json);\n      case "undefined":\n        return void 0;\n      case "boolean":\n      case "number":\n      case "string":\n        return JSON.parse(requestArg.json);\n      case "Suggestion":\n        return Suggestion3.from_json(requestArg.json);\n      case "Lint":\n        return Lint3.from_json(requestArg.json);\n      case "Span":\n        return Span3.from_json(requestArg.json);\n      case "Array": {\n        const parsed = JSON.parse(requestArg.json);\n        assert(Array.isArray(parsed));\n        return await Promise.all(parsed.map((arg) => this.deserializeArg(arg)));\n      }\n      case "object": {\n        const parsed = JSON.parse(requestArg.json);\n        return Object.fromEntries(\n          await Promise.all(parsed.map((val) => this.deserializeArg(val)))\n        );\n      }\n      default:\n        throw new Error(`Unhandled case: ${requestArg.type}`);\n    }\n  }\n  async deserialize(request) {\n    return {\n      procName: request.procName,\n      args: await Promise.all(request.args.map((arg) => this.deserializeArg(arg)))\n    };\n  }\n}\nself.postMessage("ready");\nself.onmessage = (e) => {\n  const [binaryUrl, dialect, glueFlavor] = e.data;\n  if (typeof binaryUrl !== "string") {\n    throw new TypeError(`Expected binary to be a string of url but got ${typeof binaryUrl}.`);\n  }\n  if (glueFlavor !== void 0 && glueFlavor !== "full" && glueFlavor !== "slim") {\n    throw new TypeError(`Expected glue flavor to be "full" or "slim" but got ${glueFlavor}.`);\n  }\n  const binary = SuperBinaryModule.create(binaryUrl, glueFlavor);\n  const serializer = new Serializer(binary);\n  const linter = new LocalLinter({ binary, dialect });\n  async function processRequest(v) {\n    const { procName, args } = await serializer.deserialize(v);\n    if (procName in linter) {\n      const res = await linter[procName](...args);\n      postMessage(await serializer.serializeArg(res));\n    }\n  }\n  self.onmessage = (e2) => {\n    if (isSerializedRequest(e2.data)) {\n      processRequest(e2.data);\n    }\n  };\n};\nvar __viteBrowserExternal = {};\nvar __viteBrowserExternal$1 = /* @__PURE__ */ Object.freeze({\n  __proto__: null,\n  default: __viteBrowserExternal\n});\n';
const blob = typeof self !== "undefined" && self.Blob && new Blob(["URL.revokeObjectURL(import.meta.url);", jsContent], { type: "text/javascript;charset=utf-8" });
function WorkerWrapper(options) {
  let objURL;
  try {
    objURL = blob && (self.URL || self.webkitURL).createObjectURL(blob);
    if (!objURL) throw "";
    const worker = new Worker(objURL, {
      type: "module",
      name: options == null ? void 0 : options.name
    });
    worker.addEventListener("error", () => {
      (self.URL || self.webkitURL).revokeObjectURL(objURL);
    });
    return worker;
  } catch (e) {
    return new Worker(
      "data:text/javascript;charset=utf-8," + encodeURIComponent(jsContent),
      {
        type: "module",
        name: options == null ? void 0 : options.name
      }
    );
  }
}
class WorkerLinter {
  constructor(init) {
    __publicField(this, "binary");
    __publicField(this, "serializer");
    __publicField(this, "dialect");
    __publicField(this, "worker");
    __publicField(this, "requestQueue");
    __publicField(this, "working", true);
    __publicField(this, "disposed", false);
    this.binary = init.binary;
    this.serializer = new Serializer(this.binary);
    this.dialect = init.dialect;
    this.worker = new WorkerWrapper();
    this.requestQueue = [];
    this.worker.onmessage = () => {
      this.setupMainEventListeners();
      this.worker.postMessage([this.binary.url, this.dialect, resolveWasmGlueFlavor(this.binary)]);
      this.working = false;
      this.submitRemainingRequests();
    };
  }
  setupMainEventListeners() {
    this.worker.onmessage = (e) => {
      const { resolve } = this.requestQueue.shift();
      this.serializer.deserializeArg(e.data).then((v) => {
        resolve(v);
        this.working = false;
        this.submitRemainingRequests();
      });
    };
    this.worker.onmessageerror = (e) => {
      const { reject } = this.requestQueue.shift();
      reject(e.data);
      this.working = false;
      this.submitRemainingRequests();
    };
  }
  setup() {
    return this.rpc("setup", []);
  }
  lint(text, options) {
    return this.rpc("lint", [text, options]);
  }
  organizedLints(text, options) {
    return this.rpc("organizedLints", [text, options]);
  }
  applySuggestion(text, lint, suggestion) {
    return this.rpc("applySuggestion", [text, lint, suggestion]);
  }
  isLikelyEnglish(text) {
    return this.rpc("isLikelyEnglish", [text]);
  }
  isolateEnglish(text) {
    return this.rpc("isolateEnglish", [text]);
  }
  async getLintConfig() {
    return JSON.parse(await this.getLintConfigAsJSON());
  }
  setLintConfig(config) {
    return this.setLintConfigWithJSON(JSON.stringify(config));
  }
  getLintConfigAsJSON() {
    return this.rpc("getLintConfigAsJSON", []);
  }
  setLintConfigWithJSON(config) {
    return this.rpc("setLintConfigWithJSON", [config]);
  }
  toTitleCase(text) {
    return this.rpc("toTitleCase", [text]);
  }
  getLintDescriptionsAsJSON() {
    return this.rpc("getLintDescriptionsAsJSON", []);
  }
  async getLintDescriptions() {
    return JSON.parse(await this.getLintDescriptionsAsJSON());
  }
  getLintDescriptionsHTMLAsJSON() {
    return this.rpc("getLintDescriptionsHTMLAsJSON", []);
  }
  async getLintDescriptionsHTML() {
    return JSON.parse(await this.getLintDescriptionsHTMLAsJSON());
  }
  getDefaultLintConfigAsJSON() {
    return this.rpc("getDefaultLintConfigAsJSON", []);
  }
  async getDefaultLintConfig() {
    return JSON.parse(await this.getDefaultLintConfigAsJSON());
  }
  async getStructuredLintConfig() {
    return JSON.parse(await this.getStructuredLintConfigJSON());
  }
  getStructuredLintConfigJSON() {
    return this.rpc("getStructuredLintConfigJSON", []);
  }
  async dispose() {
    if (this.disposed) {
      return;
    }
    await this.rpc("dispose", []);
    this.disposed = true;
    this.requestQueue = [];
    this.worker.terminate();
  }
  ignoreLint(source, lint) {
    return this.ignoreLints(source, [lint]);
  }
  ignoreLints(source, lints) {
    return this.rpc("ignoreLints", [source, lints]);
  }
  ignoreLintHash(hash) {
    return this.rpc("ignoreLintHash", [hash]);
  }
  exportIgnoredLints() {
    return this.rpc("exportIgnoredLints", []);
  }
  importIgnoredLints(json) {
    return this.rpc("importIgnoredLints", [json]);
  }
  contextHash(source, lint) {
    return this.rpc("contextHash", [source, lint]);
  }
  clearIgnoredLints() {
    return this.rpc("clearIgnoredLints", []);
  }
  clearWords() {
    return this.rpc("clearWords", []);
  }
  importWords(words) {
    return this.rpc("importWords", [words]);
  }
  exportWords() {
    return this.rpc("exportWords", []);
  }
  getDialect() {
    return this.rpc("getDialect", []);
  }
  setDialect(dialect) {
    return this.rpc("setDialect", [dialect]);
  }
  summarizeStats(start, end) {
    return this.rpc("summarizeStats", [start, end]);
  }
  generateStatsFile() {
    return this.rpc("generateStatsFile", []);
  }
  importStatsFile(statsFile) {
    return this.rpc("importStatsFile", [statsFile]);
  }
  /**
   * Load a Weirpack from a Blob via the worker thread.
   *
   * Returns `undefined` when the tests pass and the pack is imported, otherwise
   * forwards the failure report back to the caller.
   */
  async loadWeirpackFromBlob(blob2) {
    const bytes = new Uint8Array(await blob2.arrayBuffer());
    const arr = Array.from(bytes);
    return await this.rpc("loadWeirpackFromBytes", [arr]);
  }
  /**
   * Load a Weirpack from bytes via the worker thread.
   *
   * Returns the failure report if tests fail or `undefined` when the pack is imported.
   */
  async loadWeirpackFromBytes(bytes) {
    const arr = Array.from(bytes);
    return await this.rpc("loadWeirpackFromBytes", [arr]);
  }
  /** Run a procedure on the remote worker. */
  async rpc(procName, args) {
    if (this.disposed) {
      throw new Error("WorkerLinter has been disposed.");
    }
    const promise = new Promise((resolve, reject) => {
      this.requestQueue.push({
        resolve,
        reject,
        request: { procName, args }
      });
      this.submitRemainingRequests();
    });
    return promise;
  }
  async submitRemainingRequests() {
    if (this.working) {
      return;
    }
    this.working = true;
    if (this.requestQueue.length > 0) {
      const { request } = this.requestQueue[0];
      const serialized = await this.serializer.serialize(request);
      this.worker.postMessage(serialized);
    } else {
      this.working = false;
    }
  }
}
var u8 = Uint8Array, u16 = Uint16Array, i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0; i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r = new i32(b[30]);
  for (var i = 1; i < 30; ++i) {
    for (var j = b[i]; j < b[i + 1]; ++j) {
      r[j] = j - b[i] << 5 | i;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2), fl = _a.b, revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0), fd = _b.b, revfd = _b.r;
var rev = new u16(32768);
for (var i = 0; i < 32768; ++i) {
  var x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var hMap = function(cd, mb, r) {
  var s = cd.length;
  var i = 0;
  var l = new u16(mb);
  for (; i < s; ++i) {
    if (cd[i])
      ++l[cd[i] - 1];
  }
  var le = new u16(mb);
  for (i = 1; i < mb; ++i) {
    le[i] = le[i - 1] + l[i - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        var sv = i << 4 | cd[i];
        var r_1 = mb - cd[i];
        var v = le[cd[i] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
      }
    }
  }
  return co;
};
var flt = new u8(288);
for (var i = 0; i < 144; ++i)
  flt[i] = 8;
for (var i = 144; i < 256; ++i)
  flt[i] = 9;
for (var i = 256; i < 280; ++i)
  flt[i] = 7;
for (var i = 280; i < 288; ++i)
  flt[i] = 8;
var fdt = new u8(32);
for (var i = 0; i < 32; ++i)
  fdt[i] = 5;
var flm = /* @__PURE__ */ hMap(flt, 9, 0), flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0), fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i = 1; i < a.length; ++i) {
    if (a[i] > m)
      m = a[i];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i = 0; i < hcLen; ++i) {
          clt[clim[i]] = bits(dat, pos + i * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i = 0; i < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i = sym - 257, b = fleb[i];
          add = bits(dat, pos, (1 << b) - 1) + fl[i];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};
var wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};
var hTree = function(d, mb) {
  var t = [];
  for (var i = 0; i < d.length; ++i) {
    if (d[i])
      t.push({ s: i, f: d[i] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i2].f ? i0++ : i2++];
    r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i = 1; i < s; ++i) {
    if (t2[i].s > maxSym)
      maxSym = t2[i].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (; i < s; ++i) {
      var i2_1 = t2[i].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i;
    }
    for (; i >= 0 && dt; --i) {
      var i2_3 = t2[i].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
};
var lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i = 1; i <= s; ++i) {
    if (c[i] == cln && i != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (; cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (; cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};
var clen = function(cf, cl) {
  var l = 0;
  for (var i = 0; i < cl.length; ++i)
    l += cf[i] * cl[i];
  return l;
};
var wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i = 0; i < s; ++i)
    out[o + i + 4] = dat[i];
  return (o + 4 + s) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i = 0; i < lclt.length; ++i)
    ++lcfreq[lclt[i] & 31];
  for (var i = 0; i < lcdt.length; ++i)
    ++lcfreq[lcdt[i] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i = 0; i < nlcc; ++i)
      wbits(out, p + 3 * i, lct[clim[i]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0; it < 2; ++it) {
      var clct = lcts[it];
      for (var i = 0; i < clct.length; ++i) {
        var len = clct[i] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i] >> 5 & 127), p += clct[i] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i = 0; i < li; ++i) {
    var sym = syms[i];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym >> 23 & 31), p += fleb[len];
      var dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i2) {
      return (dat[i2] ^ dat[i2 + 1] << bs1_1 ^ dat[i2 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25e3);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (; i + 2 < s; ++i) {
      var hv = hsh(i);
      var imod = i & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i) {
        var rem = s - i;
        if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
          li = lc_1 = eb = 0, bs = i;
          for (var j = 0; j < 286; ++j)
            lf[j] = 0;
          for (var j = 0; j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i + l] == dat[i + l - dif]) {
              var nl = 0;
              for (; nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0; j < mmd; ++j) {
                  var ti = i - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i];
          ++lf[dat[i]];
        }
      }
    }
    for (i = Math.max(i, wi); i < s; ++i) {
      syms[li++] = dat[i];
      ++lf[dat[i]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i, st.w = wi;
    }
  } else {
    for (var i = st.w || 0; i < s + lst; i += 65535) {
      var e = i + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
};
var crct = /* @__PURE__ */ function() {
  var t = new Int32Array(256);
  for (var i = 0; i < 256; ++i) {
    var c = i, k = 9;
    while (--k)
      c = (c & 1 && -306674912) ^ c >>> 1;
    t[i] = c;
  }
  return t;
}();
var crc = function() {
  var c = -1;
  return {
    p: function(d) {
      var cr = c;
      for (var i = 0; i < d.length; ++i)
        cr = crct[cr & 255 ^ d[i]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var mrg = function(a, b) {
  var o = {};
  for (var k in a)
    o[k] = a[k];
  for (var k in b)
    o[k] = b[k];
  return o;
};
var b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
};
var wbytes = function(d, b, v) {
  for (; v; ++b)
    d[b] = v, v >>>= 8;
};
function deflateSync(data, opts) {
  return dopt(data, opts || {}, 0, 0);
}
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var fltn = function(d, p, t, o) {
  for (var k in d) {
    var val = d[k], n = p + k, op = o;
    if (Array.isArray(val))
      op = mrg(o, val[1]), val = val[0];
    if (val instanceof u8)
      t[n] = [val, op];
    else {
      t[n += "/"] = [new u8(0), op];
      fltn(val, n, t, o);
    }
  }
};
var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
var dutf8 = function(d) {
  for (var r = "", i = 0; ; ) {
    var c = d[i++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i + eb > d.length)
      return { s: r, r: slc(d, i - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | d[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | d[i++] & 63);
  }
};
function strToU8(str, latin1) {
  var i;
  if (te)
    return te.encode(str);
  var l = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w = function(v) {
    ar[ai++] = v;
  };
  for (var i = 0; i < l; ++i) {
    if (ai + 5 > ar.length) {
      var n = new u8(ai + 8 + (l - i << 1));
      n.set(ar);
      ar = n;
    }
    var c = str.charCodeAt(i);
    if (c < 128 || latin1)
      w(c);
    else if (c < 2048)
      w(192 | c >> 6), w(128 | c & 63);
    else if (c > 55295 && c < 57344)
      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
    else
      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
  }
  return slc(ar, 0, ai);
}
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i = 0; i < dat.length; i += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var slzh = function(d, b) {
  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
  var fnl = b2(d, b + 28), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl, bs = b4(d, b + 20);
  var _a2 = z && bs == 4294967295 ? z64e(d, es) : [bs, b4(d, b + 24), b4(d, b + 42)], sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d, b + 10), sc, su, fn, es + b2(d, b + 30) + b2(d, b + 32), off];
};
var z64e = function(d, b) {
  for (; b2(d, b) != 1; b += 4 + b2(d, b + 2))
    ;
  return [b8(d, b + 12), b8(d, b + 4), b8(d, b + 20)];
};
var exfl = function(ex) {
  var le = 0;
  if (ex) {
    for (var k in ex) {
      var l = ex[k].length;
      if (l > 65535)
        err(9);
      le += l + 4;
    }
  }
  return le;
};
var wzh = function(d, b, f, fn, u, c, ce, co) {
  var fl2 = fn.length, ex = f.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
  if (ce != null)
    d[b++] = 20, d[b++] = f.os;
  d[b] = 20, b += 2;
  d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119)
    err(10);
  wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
  if (c != -1) {
    wbytes(d, b, f.crc);
    wbytes(d, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d, b + 8, f.size);
  }
  wbytes(d, b + 12, fl2);
  wbytes(d, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d, b, col);
    wbytes(d, b + 6, f.attrs);
    wbytes(d, b + 10, ce), b += 14;
  }
  d.set(fn, b);
  b += fl2;
  if (exl) {
    for (var k in ex) {
      var exf = ex[k], l = exf.length;
      wbytes(d, b, +k);
      wbytes(d, b + 2, l);
      d.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col)
    d.set(co, b), b += col;
  return b;
};
var wzf = function(o, b, c, d, e) {
  wbytes(o, b, 101010256);
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d);
  wbytes(o, b + 16, e);
};
function zipSync(data, opts) {
  if (!opts)
    opts = {};
  var r = {};
  var files = [];
  fltn(data, "", r, opts);
  var o = 0;
  var tot = 0;
  for (var fn in r) {
    var _a2 = r[fn], file = _a2[0], p = _a2[1];
    var compression = p.level == 0 ? 0 : 8;
    var f = strToU8(fn), s = f.length;
    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
    var exl = exfl(p.extra);
    if (s > 65535)
      err(11);
    var d = compression ? deflateSync(file, p) : file, l = d.length;
    var c = crc();
    c.p(file);
    files.push(mrg(p, {
      size: file.length,
      crc: c.d(),
      c: d,
      f,
      m,
      u: s != fn.length || m && com.length != ms,
      o,
      compression
    }));
    o += 30 + s + exl + l;
    tot += 76 + 2 * (s + exl) + (ms || 0) + l;
  }
  var out = new u8(tot + 22), oe = o, cdl = tot - o;
  for (var i = 0; i < files.length; ++i) {
    var f = files[i];
    wzh(out, f.o, f, f.f, f.u, f.c.length);
    var badd = 30 + f.f.length + exfl(f.extra);
    out.set(f.c, f.o + badd);
    wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
  }
  wzf(out, o, files.length, cdl, oe);
  return out;
}
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (; b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = o == 4294967295 || c == 65535;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  for (var i = 0; i < c; ++i) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}
const manifestFilename = "manifest.json";
function packWeirpackFiles(files) {
  if (!files.has(manifestFilename)) {
    throw new Error("Weirpack is missing manifest.json");
  }
  const entries = {};
  for (const [name, content] of files.entries()) {
    entries[name] = strToU8(content);
  }
  return zipSync(entries, { level: 6 });
}
function unpackWeirpackBytes(bytes) {
  const archive = unzipSync(bytes);
  const manifestBytes = archive[manifestFilename];
  if (!manifestBytes) {
    throw new Error("Weirpack is missing manifest.json");
  }
  const manifestText = strFromU8(manifestBytes);
  const manifest = JSON.parse(manifestText);
  const files = /* @__PURE__ */ new Map();
  files.set(manifestFilename, manifestText);
  const fileNames = Object.keys(archive);
  fileNames.sort();
  for (const name of fileNames) {
    const data = archive[name];
    if (!data || name === manifestFilename) {
      continue;
    }
    files.set(name, strFromU8(data));
  }
  return { manifest, files };
}
export {
  Dialect,
  LocalLinter,
  SuggestionKind,
  WorkerLinter,
  createBinaryModuleFromUrl,
  packWeirpackFiles,
  unpackWeirpackBytes
};
