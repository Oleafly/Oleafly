Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let _unified_latex_unified_latex_ctan = require("@unified-latex/unified-latex-ctan");
let _unified_latex_unified_latex_util_trim = require("@unified-latex/unified-latex-util-trim");
let _unified_latex_unified_latex_util_pegjs = require("@unified-latex/unified-latex-util-pegjs");
let _unified_latex_unified_latex_util_visit = require("@unified-latex/unified-latex-util-visit");
let _unified_latex_unified_latex_util_match = require("@unified-latex/unified-latex-util-match");
let _unified_latex_unified_latex_util_print_raw = require("@unified-latex/unified-latex-util-print-raw");
let _unified_latex_unified_latex_util_arguments = require("@unified-latex/unified-latex-util-arguments");
let _unified_latex_unified_latex_util_environments = require("@unified-latex/unified-latex-util-environments");
let _unified_latex_unified_latex_util_catcode = require("@unified-latex/unified-latex-util-catcode");
//#region libs/compiler-ast.ts
/**
* Unified complier plugin that passes through a LaTeX AST without modification.
*/
var unifiedLatexAstComplier = function unifiedLatexAstComplier() {
	Object.assign(this, { Compiler: (x) => x });
};
//#endregion
//#region ../../node_modules/bail/index.js
/**
* Throw a given error.
*
* @param {Error|null|undefined} [error]
*   Maybe error.
* @returns {asserts error is null|undefined}
*/
function bail(error) {
	if (error) throw error;
}
//#endregion
//#region ../../node_modules/is-buffer/index.js
var require_is_buffer = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/*!
	* Determine if an object is a Buffer
	*
	* @author   Feross Aboukhadijeh <https://feross.org>
	* @license  MIT
	*/
	module.exports = function isBuffer(obj) {
		return obj != null && obj.constructor != null && typeof obj.constructor.isBuffer === "function" && obj.constructor.isBuffer(obj);
	};
}));
//#endregion
//#region ../../node_modules/extend/index.js
var require_extend = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var hasOwn = Object.prototype.hasOwnProperty;
	var toStr = Object.prototype.toString;
	var defineProperty = Object.defineProperty;
	var gOPD = Object.getOwnPropertyDescriptor;
	var isArray = function isArray(arr) {
		if (typeof Array.isArray === "function") return Array.isArray(arr);
		return toStr.call(arr) === "[object Array]";
	};
	var isPlainObject = function isPlainObject(obj) {
		if (!obj || toStr.call(obj) !== "[object Object]") return false;
		var hasOwnConstructor = hasOwn.call(obj, "constructor");
		var hasIsPrototypeOf = obj.constructor && obj.constructor.prototype && hasOwn.call(obj.constructor.prototype, "isPrototypeOf");
		if (obj.constructor && !hasOwnConstructor && !hasIsPrototypeOf) return false;
		var key;
		for (key in obj);
		return typeof key === "undefined" || hasOwn.call(obj, key);
	};
	var setProperty = function setProperty(target, options) {
		if (defineProperty && options.name === "__proto__") defineProperty(target, options.name, {
			enumerable: true,
			configurable: true,
			value: options.newValue,
			writable: true
		});
		else target[options.name] = options.newValue;
	};
	var getProperty = function getProperty(obj, name) {
		if (name === "__proto__") {
			if (!hasOwn.call(obj, name)) return;
			else if (gOPD) return gOPD(obj, name).value;
		}
		return obj[name];
	};
	module.exports = function extend() {
		var options, name, src, copy, copyIsArray, clone;
		var target = arguments[0];
		var i = 1;
		var length = arguments.length;
		var deep = false;
		if (typeof target === "boolean") {
			deep = target;
			target = arguments[1] || {};
			i = 2;
		}
		if (target == null || typeof target !== "object" && typeof target !== "function") target = {};
		for (; i < length; ++i) {
			options = arguments[i];
			if (options != null) for (name in options) {
				src = getProperty(target, name);
				copy = getProperty(options, name);
				if (target !== copy) {
					if (deep && copy && (isPlainObject(copy) || (copyIsArray = isArray(copy)))) {
						if (copyIsArray) {
							copyIsArray = false;
							clone = src && isArray(src) ? src : [];
						} else clone = src && isPlainObject(src) ? src : {};
						setProperty(target, {
							name,
							newValue: extend(deep, clone, copy)
						});
					} else if (typeof copy !== "undefined") setProperty(target, {
						name,
						newValue: copy
					});
				}
			}
		}
		return target;
	};
}));
//#endregion
//#region node_modules/is-plain-obj/index.js
function isPlainObject(value) {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return (prototype === null || prototype === Object.prototype || Object.getPrototypeOf(prototype) === null) && !(Symbol.toStringTag in value) && !(Symbol.iterator in value);
}
//#endregion
//#region ../../node_modules/trough/lib/index.js
/**
* @typedef {(error?: Error | null | undefined, ...output: Array<any>) => void} Callback
*   Callback.
*
* @typedef {(...input: Array<any>) => any} Middleware
*   Ware.
*
* @typedef Pipeline
*   Pipeline.
* @property {Run} run
*   Run the pipeline.
* @property {Use} use
*   Add middleware.
*
* @typedef {(...input: Array<any>) => void} Run
*   Call all middleware.
*
*   Calls `done` on completion with either an error or the output of the
*   last middleware.
*
*   > 👉 **Note**: as the length of input defines whether async functions get a
*   > `next` function,
*   > it’s recommended to keep `input` at one value normally.

*
* @typedef {(fn: Middleware) => Pipeline} Use
*   Add middleware.
*/
/**
* Create new middleware.
*
* @returns {Pipeline}
*   Pipeline.
*/
function trough() {
	/** @type {Array<Middleware>} */
	const fns = [];
	/** @type {Pipeline} */
	const pipeline = {
		run,
		use
	};
	return pipeline;
	/** @type {Run} */
	function run(...values) {
		let middlewareIndex = -1;
		/** @type {Callback} */
		const callback = values.pop();
		if (typeof callback !== "function") throw new TypeError("Expected function as last argument, not " + callback);
		next(null, ...values);
		/**
		* Run the next `fn`, or we’re done.
		*
		* @param {Error | null | undefined} error
		* @param {Array<any>} output
		*/
		function next(error, ...output) {
			const fn = fns[++middlewareIndex];
			let index = -1;
			if (error) {
				callback(error);
				return;
			}
			while (++index < values.length) if (output[index] === null || output[index] === void 0) output[index] = values[index];
			values = output;
			if (fn) wrap(fn, next)(...output);
			else callback(null, ...output);
		}
	}
	/** @type {Use} */
	function use(middelware) {
		if (typeof middelware !== "function") throw new TypeError("Expected `middelware` to be a function, not " + middelware);
		fns.push(middelware);
		return pipeline;
	}
}
/**
* Wrap `middleware` into a uniform interface.
*
* You can pass all input to the resulting function.
* `callback` is then called with the output of `middleware`.
*
* If `middleware` accepts more arguments than the later given in input,
* an extra `done` function is passed to it after that input,
* which must be called by `middleware`.
*
* The first value in `input` is the main input value.
* All other input values are the rest input values.
* The values given to `callback` are the input values,
* merged with every non-nullish output value.
*
* * if `middleware` throws an error,
*   returns a promise that is rejected,
*   or calls the given `done` function with an error,
*   `callback` is called with that error
* * if `middleware` returns a value or returns a promise that is resolved,
*   that value is the main output value
* * if `middleware` calls `done`,
*   all non-nullish values except for the first one (the error) overwrite the
*   output values
*
* @param {Middleware} middleware
*   Function to wrap.
* @param {Callback} callback
*   Callback called with the output of `middleware`.
* @returns {Run}
*   Wrapped middleware.
*/
function wrap(middleware, callback) {
	/** @type {boolean} */
	let called;
	return wrapped;
	/**
	* Call `middleware`.
	* @this {any}
	* @param {Array<any>} parameters
	* @returns {void}
	*/
	function wrapped(...parameters) {
		const fnExpectsCallback = middleware.length > parameters.length;
		/** @type {any} */
		let result;
		if (fnExpectsCallback) parameters.push(done);
		try {
			result = middleware.apply(this, parameters);
		} catch (error) {
			const exception = error;
			if (fnExpectsCallback && called) throw exception;
			return done(exception);
		}
		if (!fnExpectsCallback) if (result && result.then && typeof result.then === "function") result.then(then, done);
		else if (result instanceof Error) done(result);
		else then(result);
	}
	/**
	* Call `callback`, only once.
	*
	* @type {Callback}
	*/
	function done(error, ...output) {
		if (!called) {
			called = true;
			callback(error, ...output);
		}
	}
	/**
	* Call `done` with one value.
	*
	* @param {any} [value]
	*/
	function then(value) {
		done(null, value);
	}
}
//#endregion
//#region node_modules/unist-util-stringify-position/lib/index.js
/**
* @typedef {import('unist').Node} Node
* @typedef {import('unist').Point} Point
* @typedef {import('unist').Position} Position
*/
/**
* @typedef NodeLike
* @property {string} type
* @property {PositionLike | null | undefined} [position]
*
* @typedef PositionLike
* @property {PointLike | null | undefined} [start]
* @property {PointLike | null | undefined} [end]
*
* @typedef PointLike
* @property {number | null | undefined} [line]
* @property {number | null | undefined} [column]
* @property {number | null | undefined} [offset]
*/
/**
* Serialize the positional info of a point, position (start and end points),
* or node.
*
* @param {Node | NodeLike | Position | PositionLike | Point | PointLike | null | undefined} [value]
*   Node, position, or point.
* @returns {string}
*   Pretty printed positional info of a node (`string`).
*
*   In the format of a range `ls:cs-le:ce` (when given `node` or `position`)
*   or a point `l:c` (when given `point`), where `l` stands for line, `c` for
*   column, `s` for `start`, and `e` for end.
*   An empty string (`''`) is returned if the given value is neither `node`,
*   `position`, nor `point`.
*/
function stringifyPosition(value) {
	if (!value || typeof value !== "object") return "";
	if ("position" in value || "type" in value) return position(value.position);
	if ("start" in value || "end" in value) return position(value);
	if ("line" in value || "column" in value) return point(value);
	return "";
}
/**
* @param {Point | PointLike | null | undefined} point
* @returns {string}
*/
function point(point) {
	return index(point && point.line) + ":" + index(point && point.column);
}
/**
* @param {Position | PositionLike | null | undefined} pos
* @returns {string}
*/
function position(pos) {
	return point(pos && pos.start) + "-" + point(pos && pos.end);
}
/**
* @param {number | null | undefined} value
* @returns {number}
*/
function index(value) {
	return value && typeof value === "number" ? value : 1;
}
//#endregion
//#region node_modules/vfile-message/lib/index.js
/**
* @typedef {import('unist').Node} Node
* @typedef {import('unist').Position} Position
* @typedef {import('unist').Point} Point
* @typedef {object & {type: string, position?: Position | undefined}} NodeLike
*/
/**
* Message.
*/
var VFileMessage = class extends Error {
	/**
	* Create a message for `reason` at `place` from `origin`.
	*
	* When an error is passed in as `reason`, the `stack` is copied.
	*
	* @param {string | Error | VFileMessage} reason
	*   Reason for message, uses the stack and message of the error if given.
	*
	*   > 👉 **Note**: you should use markdown.
	* @param {Node | NodeLike | Position | Point | null | undefined} [place]
	*   Place in file where the message occurred.
	* @param {string | null | undefined} [origin]
	*   Place in code where the message originates (example:
	*   `'my-package:my-rule'` or `'my-rule'`).
	* @returns
	*   Instance of `VFileMessage`.
	*/
	constructor(reason, place, origin) {
		/** @type {[string | null, string | null]} */
		const parts = [null, null];
		/** @type {Position} */
		let position = {
			start: {
				line: null,
				column: null
			},
			end: {
				line: null,
				column: null
			}
		};
		super();
		if (typeof place === "string") {
			origin = place;
			place = void 0;
		}
		if (typeof origin === "string") {
			const index = origin.indexOf(":");
			if (index === -1) parts[1] = origin;
			else {
				parts[0] = origin.slice(0, index);
				parts[1] = origin.slice(index + 1);
			}
		}
		if (place) {
			if ("type" in place || "position" in place) {
				if (place.position) position = place.position;
			} else if ("start" in place || "end" in place) position = place;
			else if ("line" in place || "column" in place) position.start = place;
		}
		/**
		* Serialized positional info of error.
		*
		* On normal errors, this would be something like `ParseError`, buit in
		* `VFile` messages we use this space to show where an error happened.
		*/
		this.name = stringifyPosition(place) || "1:1";
		/**
		* Reason for message.
		*
		* @type {string}
		*/
		this.message = typeof reason === "object" ? reason.message : reason;
		/**
		* Stack of message.
		*
		* This is used by normal errors to show where something happened in
		* programming code, irrelevant for `VFile` messages,
		*
		* @type {string}
		*/
		this.stack = "";
		if (typeof reason === "object" && reason.stack) this.stack = reason.stack;
		/**
		* Reason for message.
		*
		* > 👉 **Note**: you should use markdown.
		*
		* @type {string}
		*/
		this.reason = this.message;
		/**
		* State of problem.
		*
		* * `true` — marks associated file as no longer processable (error)
		* * `false` — necessitates a (potential) change (warning)
		* * `null | undefined` — for things that might not need changing (info)
		*
		* @type {boolean | null | undefined}
		*/
		this.fatal;
		/**
		* Starting line of error.
		*
		* @type {number | null}
		*/
		this.line = position.start.line;
		/**
		* Starting column of error.
		*
		* @type {number | null}
		*/
		this.column = position.start.column;
		/**
		* Full unist position.
		*
		* @type {Position | null}
		*/
		this.position = position;
		/**
		* Namespace of message (example: `'my-package'`).
		*
		* @type {string | null}
		*/
		this.source = parts[0];
		/**
		* Category of message (example: `'my-rule'`).
		*
		* @type {string | null}
		*/
		this.ruleId = parts[1];
		/**
		* Path of a file (used throughout the `VFile` ecosystem).
		*
		* @type {string | null}
		*/
		this.file;
		/**
		* Specify the source value that’s being reported, which is deemed
		* incorrect.
		*
		* @type {string | null}
		*/
		this.actual;
		/**
		* Suggest acceptable values that can be used instead of `actual`.
		*
		* @type {Array<string> | null}
		*/
		this.expected;
		/**
		* Link to docs for the message.
		*
		* > 👉 **Note**: this must be an absolute URL that can be passed as `x`
		* > to `new URL(x)`.
		*
		* @type {string | null}
		*/
		this.url;
		/**
		* Long form description of the message (you should use markdown).
		*
		* @type {string | null}
		*/
		this.note;
	}
};
VFileMessage.prototype.file = "";
VFileMessage.prototype.name = "";
VFileMessage.prototype.reason = "";
VFileMessage.prototype.message = "";
VFileMessage.prototype.stack = "";
VFileMessage.prototype.fatal = null;
VFileMessage.prototype.column = null;
VFileMessage.prototype.line = null;
VFileMessage.prototype.source = null;
VFileMessage.prototype.ruleId = null;
VFileMessage.prototype.position = null;
//#endregion
//#region node_modules/vfile/lib/minpath.browser.js
var path = {
	basename,
	dirname,
	extname,
	join,
	sep: "/"
};
/**
* Get the basename from a path.
*
* @param {string} path
*   File path.
* @param {string | undefined} [ext]
*   Extension to strip.
* @returns {string}
*   Stem or basename.
*/
function basename(path, ext) {
	if (ext !== void 0 && typeof ext !== "string") throw new TypeError("\"ext\" argument must be a string");
	assertPath$1(path);
	let start = 0;
	let end = -1;
	let index = path.length;
	/** @type {boolean | undefined} */
	let seenNonSlash;
	if (ext === void 0 || ext.length === 0 || ext.length > path.length) {
		while (index--) if (path.charCodeAt(index) === 47) {
			if (seenNonSlash) {
				start = index + 1;
				break;
			}
		} else if (end < 0) {
			seenNonSlash = true;
			end = index + 1;
		}
		return end < 0 ? "" : path.slice(start, end);
	}
	if (ext === path) return "";
	let firstNonSlashEnd = -1;
	let extIndex = ext.length - 1;
	while (index--) if (path.charCodeAt(index) === 47) {
		if (seenNonSlash) {
			start = index + 1;
			break;
		}
	} else {
		if (firstNonSlashEnd < 0) {
			seenNonSlash = true;
			firstNonSlashEnd = index + 1;
		}
		if (extIndex > -1) if (path.charCodeAt(index) === ext.charCodeAt(extIndex--)) {
			if (extIndex < 0) end = index;
		} else {
			extIndex = -1;
			end = firstNonSlashEnd;
		}
	}
	if (start === end) end = firstNonSlashEnd;
	else if (end < 0) end = path.length;
	return path.slice(start, end);
}
/**
* Get the dirname from a path.
*
* @param {string} path
*   File path.
* @returns {string}
*   File path.
*/
function dirname(path) {
	assertPath$1(path);
	if (path.length === 0) return ".";
	let end = -1;
	let index = path.length;
	/** @type {boolean | undefined} */
	let unmatchedSlash;
	while (--index) if (path.charCodeAt(index) === 47) {
		if (unmatchedSlash) {
			end = index;
			break;
		}
	} else if (!unmatchedSlash) unmatchedSlash = true;
	return end < 0 ? path.charCodeAt(0) === 47 ? "/" : "." : end === 1 && path.charCodeAt(0) === 47 ? "//" : path.slice(0, end);
}
/**
* Get an extname from a path.
*
* @param {string} path
*   File path.
* @returns {string}
*   Extname.
*/
function extname(path) {
	assertPath$1(path);
	let index = path.length;
	let end = -1;
	let startPart = 0;
	let startDot = -1;
	let preDotState = 0;
	/** @type {boolean | undefined} */
	let unmatchedSlash;
	while (index--) {
		const code = path.charCodeAt(index);
		if (code === 47) {
			if (unmatchedSlash) {
				startPart = index + 1;
				break;
			}
			continue;
		}
		if (end < 0) {
			unmatchedSlash = true;
			end = index + 1;
		}
		if (code === 46) {
			if (startDot < 0) startDot = index;
			else if (preDotState !== 1) preDotState = 1;
		} else if (startDot > -1) preDotState = -1;
	}
	if (startDot < 0 || end < 0 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) return "";
	return path.slice(startDot, end);
}
/**
* Join segments from a path.
*
* @param {Array<string>} segments
*   Path segments.
* @returns {string}
*   File path.
*/
function join(...segments) {
	let index = -1;
	/** @type {string | undefined} */
	let joined;
	while (++index < segments.length) {
		assertPath$1(segments[index]);
		if (segments[index]) joined = joined === void 0 ? segments[index] : joined + "/" + segments[index];
	}
	return joined === void 0 ? "." : normalize(joined);
}
/**
* Normalize a basic file path.
*
* @param {string} path
*   File path.
* @returns {string}
*   File path.
*/
function normalize(path) {
	assertPath$1(path);
	const absolute = path.charCodeAt(0) === 47;
	let value = normalizeString(path, !absolute);
	if (value.length === 0 && !absolute) value = ".";
	if (value.length > 0 && path.charCodeAt(path.length - 1) === 47) value += "/";
	return absolute ? "/" + value : value;
}
/**
* Resolve `.` and `..` elements in a path with directory names.
*
* @param {string} path
*   File path.
* @param {boolean} allowAboveRoot
*   Whether `..` can move above root.
* @returns {string}
*   File path.
*/
function normalizeString(path, allowAboveRoot) {
	let result = "";
	let lastSegmentLength = 0;
	let lastSlash = -1;
	let dots = 0;
	let index = -1;
	/** @type {number | undefined} */
	let code;
	/** @type {number} */
	let lastSlashIndex;
	while (++index <= path.length) {
		if (index < path.length) code = path.charCodeAt(index);
		else if (code === 47) break;
		else code = 47;
		if (code === 47) {
			if (lastSlash === index - 1 || dots === 1) {} else if (lastSlash !== index - 1 && dots === 2) {
				if (result.length < 2 || lastSegmentLength !== 2 || result.charCodeAt(result.length - 1) !== 46 || result.charCodeAt(result.length - 2) !== 46) {
					if (result.length > 2) {
						lastSlashIndex = result.lastIndexOf("/");
						if (lastSlashIndex !== result.length - 1) {
							if (lastSlashIndex < 0) {
								result = "";
								lastSegmentLength = 0;
							} else {
								result = result.slice(0, lastSlashIndex);
								lastSegmentLength = result.length - 1 - result.lastIndexOf("/");
							}
							lastSlash = index;
							dots = 0;
							continue;
						}
					} else if (result.length > 0) {
						result = "";
						lastSegmentLength = 0;
						lastSlash = index;
						dots = 0;
						continue;
					}
				}
				if (allowAboveRoot) {
					result = result.length > 0 ? result + "/.." : "..";
					lastSegmentLength = 2;
				}
			} else {
				if (result.length > 0) result += "/" + path.slice(lastSlash + 1, index);
				else result = path.slice(lastSlash + 1, index);
				lastSegmentLength = index - lastSlash - 1;
			}
			lastSlash = index;
			dots = 0;
		} else if (code === 46 && dots > -1) dots++;
		else dots = -1;
	}
	return result;
}
/**
* Make sure `path` is a string.
*
* @param {string} path
*   File path.
* @returns {asserts path is string}
*   Nothing.
*/
function assertPath$1(path) {
	if (typeof path !== "string") throw new TypeError("Path must be a string. Received " + JSON.stringify(path));
}
//#endregion
//#region node_modules/vfile/lib/minproc.browser.js
var proc = { cwd };
function cwd() {
	return "/";
}
//#endregion
//#region node_modules/vfile/lib/minurl.shared.js
/**
* @typedef URL
* @property {string} hash
* @property {string} host
* @property {string} hostname
* @property {string} href
* @property {string} origin
* @property {string} password
* @property {string} pathname
* @property {string} port
* @property {string} protocol
* @property {string} search
* @property {any} searchParams
* @property {string} username
* @property {() => string} toString
* @property {() => string} toJSON
*/
/**
* Check if `fileUrlOrPath` looks like a URL.
*
* @param {unknown} fileUrlOrPath
*   File path or URL.
* @returns {fileUrlOrPath is URL}
*   Whether it’s a URL.
*/
function isUrl(fileUrlOrPath) {
	return fileUrlOrPath !== null && typeof fileUrlOrPath === "object" && fileUrlOrPath.href && fileUrlOrPath.origin;
}
//#endregion
//#region node_modules/vfile/lib/minurl.browser.js
/**
* @param {string | URL} path
*   File URL.
* @returns {string}
*   File URL.
*/
function urlToPath(path) {
	if (typeof path === "string") path = new URL(path);
	else if (!isUrl(path)) {
		/** @type {NodeJS.ErrnoException} */
		const error = /* @__PURE__ */ new TypeError("The \"path\" argument must be of type string or an instance of URL. Received `" + path + "`");
		error.code = "ERR_INVALID_ARG_TYPE";
		throw error;
	}
	if (path.protocol !== "file:") {
		/** @type {NodeJS.ErrnoException} */
		const error = /* @__PURE__ */ new TypeError("The URL must be of scheme file");
		error.code = "ERR_INVALID_URL_SCHEME";
		throw error;
	}
	return getPathFromURLPosix(path);
}
/**
* Get a path from a POSIX URL.
*
* @param {URL} url
*   URL.
* @returns {string}
*   File path.
*/
function getPathFromURLPosix(url) {
	if (url.hostname !== "") {
		/** @type {NodeJS.ErrnoException} */
		const error = /* @__PURE__ */ new TypeError("File URL host must be \"localhost\" or empty on darwin");
		error.code = "ERR_INVALID_FILE_URL_HOST";
		throw error;
	}
	const pathname = url.pathname;
	let index = -1;
	while (++index < pathname.length) if (pathname.charCodeAt(index) === 37 && pathname.charCodeAt(index + 1) === 50) {
		const third = pathname.charCodeAt(index + 2);
		if (third === 70 || third === 102) {
			/** @type {NodeJS.ErrnoException} */
			const error = /* @__PURE__ */ new TypeError("File URL path must not include encoded / characters");
			error.code = "ERR_INVALID_FILE_URL_PATH";
			throw error;
		}
	}
	return decodeURIComponent(pathname);
}
//#endregion
//#region node_modules/vfile/lib/index.js
var import_is_buffer = /* @__PURE__ */ __toESM(require_is_buffer(), 1);
/**
* Order of setting (least specific to most), we need this because otherwise
* `{stem: 'a', path: '~/b.js'}` would throw, as a path is needed before a
* stem can be set.
*
* @type {Array<'basename' | 'dirname' | 'extname' | 'history' | 'path' | 'stem'>}
*/
var order = [
	"history",
	"path",
	"basename",
	"stem",
	"extname",
	"dirname"
];
var VFile = class {
	/**
	* Create a new virtual file.
	*
	* `options` is treated as:
	*
	* *   `string` or `Buffer` — `{value: options}`
	* *   `URL` — `{path: options}`
	* *   `VFile` — shallow copies its data over to the new file
	* *   `object` — all fields are shallow copied over to the new file
	*
	* Path related fields are set in the following order (least specific to
	* most specific): `history`, `path`, `basename`, `stem`, `extname`,
	* `dirname`.
	*
	* You cannot set `dirname` or `extname` without setting either `history`,
	* `path`, `basename`, or `stem` too.
	*
	* @param {Compatible | null | undefined} [value]
	*   File value.
	* @returns
	*   New instance.
	*/
	constructor(value) {
		/** @type {Options | VFile} */
		let options;
		if (!value) options = {};
		else if (typeof value === "string" || buffer(value)) options = { value };
		else if (isUrl(value)) options = { path: value };
		else options = value;
		/**
		* Place to store custom information (default: `{}`).
		*
		* It’s OK to store custom data directly on the file but moving it to
		* `data` is recommended.
		*
		* @type {Data}
		*/
		this.data = {};
		/**
		* List of messages associated with the file.
		*
		* @type {Array<VFileMessage>}
		*/
		this.messages = [];
		/**
		* List of filepaths the file moved between.
		*
		* The first is the original path and the last is the current path.
		*
		* @type {Array<string>}
		*/
		this.history = [];
		/**
		* Base of `path` (default: `process.cwd()` or `'/'` in browsers).
		*
		* @type {string}
		*/
		this.cwd = proc.cwd();
		/**
		* Raw value.
		*
		* @type {Value}
		*/
		this.value;
		/**
		* Whether a file was saved to disk.
		*
		* This is used by vfile reporters.
		*
		* @type {boolean}
		*/
		this.stored;
		/**
		* Custom, non-string, compiled, representation.
		*
		* This is used by unified to store non-string results.
		* One example is when turning markdown into React nodes.
		*
		* @type {unknown}
		*/
		this.result;
		/**
		* Source map.
		*
		* This type is equivalent to the `RawSourceMap` type from the `source-map`
		* module.
		*
		* @type {Map | null | undefined}
		*/
		this.map;
		let index = -1;
		while (++index < order.length) {
			const prop = order[index];
			if (prop in options && options[prop] !== void 0 && options[prop] !== null) this[prop] = prop === "history" ? [...options[prop]] : options[prop];
		}
		/** @type {string} */
		let prop;
		for (prop in options) if (!order.includes(prop)) this[prop] = options[prop];
	}
	/**
	* Get the full path (example: `'~/index.min.js'`).
	*
	* @returns {string}
	*/
	get path() {
		return this.history[this.history.length - 1];
	}
	/**
	* Set the full path (example: `'~/index.min.js'`).
	*
	* Cannot be nullified.
	* You can set a file URL (a `URL` object with a `file:` protocol) which will
	* be turned into a path with `url.fileURLToPath`.
	*
	* @param {string | URL} path
	*/
	set path(path) {
		if (isUrl(path)) path = urlToPath(path);
		assertNonEmpty(path, "path");
		if (this.path !== path) this.history.push(path);
	}
	/**
	* Get the parent path (example: `'~'`).
	*/
	get dirname() {
		return typeof this.path === "string" ? path.dirname(this.path) : void 0;
	}
	/**
	* Set the parent path (example: `'~'`).
	*
	* Cannot be set if there’s no `path` yet.
	*/
	set dirname(dirname) {
		assertPath(this.basename, "dirname");
		this.path = path.join(dirname || "", this.basename);
	}
	/**
	* Get the basename (including extname) (example: `'index.min.js'`).
	*/
	get basename() {
		return typeof this.path === "string" ? path.basename(this.path) : void 0;
	}
	/**
	* Set basename (including extname) (`'index.min.js'`).
	*
	* Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
	* on windows).
	* Cannot be nullified (use `file.path = file.dirname` instead).
	*/
	set basename(basename) {
		assertNonEmpty(basename, "basename");
		assertPart(basename, "basename");
		this.path = path.join(this.dirname || "", basename);
	}
	/**
	* Get the extname (including dot) (example: `'.js'`).
	*/
	get extname() {
		return typeof this.path === "string" ? path.extname(this.path) : void 0;
	}
	/**
	* Set the extname (including dot) (example: `'.js'`).
	*
	* Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
	* on windows).
	* Cannot be set if there’s no `path` yet.
	*/
	set extname(extname) {
		assertPart(extname, "extname");
		assertPath(this.dirname, "extname");
		if (extname) {
			if (extname.charCodeAt(0) !== 46) throw new Error("`extname` must start with `.`");
			if (extname.includes(".", 1)) throw new Error("`extname` cannot contain multiple dots");
		}
		this.path = path.join(this.dirname, this.stem + (extname || ""));
	}
	/**
	* Get the stem (basename w/o extname) (example: `'index.min'`).
	*/
	get stem() {
		return typeof this.path === "string" ? path.basename(this.path, this.extname) : void 0;
	}
	/**
	* Set the stem (basename w/o extname) (example: `'index.min'`).
	*
	* Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
	* on windows).
	* Cannot be nullified (use `file.path = file.dirname` instead).
	*/
	set stem(stem) {
		assertNonEmpty(stem, "stem");
		assertPart(stem, "stem");
		this.path = path.join(this.dirname || "", stem + (this.extname || ""));
	}
	/**
	* Serialize the file.
	*
	* @param {BufferEncoding | null | undefined} [encoding='utf8']
	*   Character encoding to understand `value` as when it’s a `Buffer`
	*   (default: `'utf8'`).
	* @returns {string}
	*   Serialized file.
	*/
	toString(encoding) {
		return (this.value || "").toString(encoding || void 0);
	}
	/**
	* Create a warning message associated with the file.
	*
	* Its `fatal` is set to `false` and `file` is set to the current file path.
	* Its added to `file.messages`.
	*
	* @param {string | Error | VFileMessage} reason
	*   Reason for message, uses the stack and message of the error if given.
	* @param {Node | NodeLike | Position | Point | null | undefined} [place]
	*   Place in file where the message occurred.
	* @param {string | null | undefined} [origin]
	*   Place in code where the message originates (example:
	*   `'my-package:my-rule'` or `'my-rule'`).
	* @returns {VFileMessage}
	*   Message.
	*/
	message(reason, place, origin) {
		const message = new VFileMessage(reason, place, origin);
		if (this.path) {
			message.name = this.path + ":" + message.name;
			message.file = this.path;
		}
		message.fatal = false;
		this.messages.push(message);
		return message;
	}
	/**
	* Create an info message associated with the file.
	*
	* Its `fatal` is set to `null` and `file` is set to the current file path.
	* Its added to `file.messages`.
	*
	* @param {string | Error | VFileMessage} reason
	*   Reason for message, uses the stack and message of the error if given.
	* @param {Node | NodeLike | Position | Point | null | undefined} [place]
	*   Place in file where the message occurred.
	* @param {string | null | undefined} [origin]
	*   Place in code where the message originates (example:
	*   `'my-package:my-rule'` or `'my-rule'`).
	* @returns {VFileMessage}
	*   Message.
	*/
	info(reason, place, origin) {
		const message = this.message(reason, place, origin);
		message.fatal = null;
		return message;
	}
	/**
	* Create a fatal error associated with the file.
	*
	* Its `fatal` is set to `true` and `file` is set to the current file path.
	* Its added to `file.messages`.
	*
	* > 👉 **Note**: a fatal error means that a file is no longer processable.
	*
	* @param {string | Error | VFileMessage} reason
	*   Reason for message, uses the stack and message of the error if given.
	* @param {Node | NodeLike | Position | Point | null | undefined} [place]
	*   Place in file where the message occurred.
	* @param {string | null | undefined} [origin]
	*   Place in code where the message originates (example:
	*   `'my-package:my-rule'` or `'my-rule'`).
	* @returns {never}
	*   Message.
	* @throws {VFileMessage}
	*   Message.
	*/
	fail(reason, place, origin) {
		const message = this.message(reason, place, origin);
		message.fatal = true;
		throw message;
	}
};
/**
* Assert that `part` is not a path (as in, does not contain `path.sep`).
*
* @param {string | null | undefined} part
*   File path part.
* @param {string} name
*   Part name.
* @returns {void}
*   Nothing.
*/
function assertPart(part, name) {
	if (part && part.includes(path.sep)) throw new Error("`" + name + "` cannot be a path: did not expect `" + path.sep + "`");
}
/**
* Assert that `part` is not empty.
*
* @param {string | undefined} part
*   Thing.
* @param {string} name
*   Part name.
* @returns {asserts part is string}
*   Nothing.
*/
function assertNonEmpty(part, name) {
	if (!part) throw new Error("`" + name + "` cannot be empty");
}
/**
* Assert `path` exists.
*
* @param {string | undefined} path
*   Path.
* @param {string} name
*   Dependency name.
* @returns {asserts path is string}
*   Nothing.
*/
function assertPath(path, name) {
	if (!path) throw new Error("Setting `" + name + "` requires `path` to be set too");
}
/**
* Assert `value` is a buffer.
*
* @param {unknown} value
*   thing.
* @returns {value is Buffer}
*   Whether `value` is a Node.js buffer.
*/
function buffer(value) {
	return (0, import_is_buffer.default)(value);
}
//#endregion
//#region node_modules/unified/lib/index.js
/**
* @typedef {import('unist').Node} Node
* @typedef {import('vfile').VFileCompatible} VFileCompatible
* @typedef {import('vfile').VFileValue} VFileValue
* @typedef {import('..').Processor} Processor
* @typedef {import('..').Plugin} Plugin
* @typedef {import('..').Preset} Preset
* @typedef {import('..').Pluggable} Pluggable
* @typedef {import('..').PluggableList} PluggableList
* @typedef {import('..').Transformer} Transformer
* @typedef {import('..').Parser} Parser
* @typedef {import('..').Compiler} Compiler
* @typedef {import('..').RunCallback} RunCallback
* @typedef {import('..').ProcessCallback} ProcessCallback
*
* @typedef Context
* @property {Node} tree
* @property {VFile} file
*/
var import_extend = /* @__PURE__ */ __toESM(require_extend(), 1);
var unified = base().freeze();
var own = {}.hasOwnProperty;
/**
* @returns {Processor}
*/
function base() {
	const transformers = trough();
	/** @type {Processor['attachers']} */
	const attachers = [];
	/** @type {Record<string, unknown>} */
	let namespace = {};
	/** @type {boolean|undefined} */
	let frozen;
	let freezeIndex = -1;
	processor.data = data;
	processor.Parser = void 0;
	processor.Compiler = void 0;
	processor.freeze = freeze;
	processor.attachers = attachers;
	processor.use = use;
	processor.parse = parse;
	processor.stringify = stringify;
	processor.run = run;
	processor.runSync = runSync;
	processor.process = process;
	processor.processSync = processSync;
	return processor;
	/** @type {Processor} */
	function processor() {
		const destination = base();
		let index = -1;
		while (++index < attachers.length) destination.use(...attachers[index]);
		destination.data((0, import_extend.default)(true, {}, namespace));
		return destination;
	}
	/**
	* @param {string|Record<string, unknown>} [key]
	* @param {unknown} [value]
	* @returns {unknown}
	*/
	function data(key, value) {
		if (typeof key === "string") {
			if (arguments.length === 2) {
				assertUnfrozen("data", frozen);
				namespace[key] = value;
				return processor;
			}
			return own.call(namespace, key) && namespace[key] || null;
		}
		if (key) {
			assertUnfrozen("data", frozen);
			namespace = key;
			return processor;
		}
		return namespace;
	}
	/** @type {Processor['freeze']} */
	function freeze() {
		if (frozen) return processor;
		while (++freezeIndex < attachers.length) {
			const [attacher, ...options] = attachers[freezeIndex];
			if (options[0] === false) continue;
			if (options[0] === true) options[0] = void 0;
			/** @type {Transformer|void} */
			const transformer = attacher.call(processor, ...options);
			if (typeof transformer === "function") transformers.use(transformer);
		}
		frozen = true;
		freezeIndex = Number.POSITIVE_INFINITY;
		return processor;
	}
	/**
	* @param {Pluggable|null|undefined} [value]
	* @param {...unknown} options
	* @returns {Processor}
	*/
	function use(value, ...options) {
		/** @type {Record<string, unknown>|undefined} */
		let settings;
		assertUnfrozen("use", frozen);
		if (value === null || value === void 0) {} else if (typeof value === "function") addPlugin(value, ...options);
		else if (typeof value === "object") if (Array.isArray(value)) addList(value);
		else addPreset(value);
		else throw new TypeError("Expected usable value, not `" + value + "`");
		if (settings) namespace.settings = Object.assign(namespace.settings || {}, settings);
		return processor;
		/**
		* @param {import('..').Pluggable<unknown[]>} value
		* @returns {void}
		*/
		function add(value) {
			if (typeof value === "function") addPlugin(value);
			else if (typeof value === "object") if (Array.isArray(value)) {
				const [plugin, ...options] = value;
				addPlugin(plugin, ...options);
			} else addPreset(value);
			else throw new TypeError("Expected usable value, not `" + value + "`");
		}
		/**
		* @param {Preset} result
		* @returns {void}
		*/
		function addPreset(result) {
			addList(result.plugins);
			if (result.settings) settings = Object.assign(settings || {}, result.settings);
		}
		/**
		* @param {PluggableList|null|undefined} [plugins]
		* @returns {void}
		*/
		function addList(plugins) {
			let index = -1;
			if (plugins === null || plugins === void 0) {} else if (Array.isArray(plugins)) while (++index < plugins.length) {
				const thing = plugins[index];
				add(thing);
			}
			else throw new TypeError("Expected a list of plugins, not `" + plugins + "`");
		}
		/**
		* @param {Plugin} plugin
		* @param {...unknown} [value]
		* @returns {void}
		*/
		function addPlugin(plugin, value) {
			let index = -1;
			/** @type {Processor['attachers'][number]|undefined} */
			let entry;
			while (++index < attachers.length) if (attachers[index][0] === plugin) {
				entry = attachers[index];
				break;
			}
			if (entry) {
				if (isPlainObject(entry[1]) && isPlainObject(value)) value = (0, import_extend.default)(true, entry[1], value);
				entry[1] = value;
			} else attachers.push([...arguments]);
		}
	}
	/** @type {Processor['parse']} */
	function parse(doc) {
		processor.freeze();
		const file = vfile(doc);
		const Parser = processor.Parser;
		assertParser("parse", Parser);
		if (newable(Parser, "parse")) return new Parser(String(file), file).parse();
		return Parser(String(file), file);
	}
	/** @type {Processor['stringify']} */
	function stringify(node, doc) {
		processor.freeze();
		const file = vfile(doc);
		const Compiler = processor.Compiler;
		assertCompiler("stringify", Compiler);
		assertNode(node);
		if (newable(Compiler, "compile")) return new Compiler(node, file).compile();
		return Compiler(node, file);
	}
	/**
	* @param {Node} node
	* @param {VFileCompatible|RunCallback} [doc]
	* @param {RunCallback} [callback]
	* @returns {Promise<Node>|void}
	*/
	function run(node, doc, callback) {
		assertNode(node);
		processor.freeze();
		if (!callback && typeof doc === "function") {
			callback = doc;
			doc = void 0;
		}
		if (!callback) return new Promise(executor);
		executor(null, callback);
		/**
		* @param {null|((node: Node) => void)} resolve
		* @param {(error: Error) => void} reject
		* @returns {void}
		*/
		function executor(resolve, reject) {
			transformers.run(node, vfile(doc), done);
			/**
			* @param {Error|null} error
			* @param {Node} tree
			* @param {VFile} file
			* @returns {void}
			*/
			function done(error, tree, file) {
				tree = tree || node;
				if (error) reject(error);
				else if (resolve) resolve(tree);
				else callback(null, tree, file);
			}
		}
	}
	/** @type {Processor['runSync']} */
	function runSync(node, file) {
		/** @type {Node|undefined} */
		let result;
		/** @type {boolean|undefined} */
		let complete;
		processor.run(node, file, done);
		assertDone("runSync", "run", complete);
		return result;
		/**
		* @param {Error|null} [error]
		* @param {Node} [tree]
		* @returns {void}
		*/
		function done(error, tree) {
			bail(error);
			result = tree;
			complete = true;
		}
	}
	/**
	* @param {VFileCompatible} doc
	* @param {ProcessCallback} [callback]
	* @returns {Promise<VFile>|undefined}
	*/
	function process(doc, callback) {
		processor.freeze();
		assertParser("process", processor.Parser);
		assertCompiler("process", processor.Compiler);
		if (!callback) return new Promise(executor);
		executor(null, callback);
		/**
		* @param {null|((file: VFile) => void)} resolve
		* @param {(error?: Error|null|undefined) => void} reject
		* @returns {void}
		*/
		function executor(resolve, reject) {
			const file = vfile(doc);
			processor.run(processor.parse(file), file, (error, tree, file) => {
				if (error || !tree || !file) done(error);
				else {
					/** @type {unknown} */
					const result = processor.stringify(tree, file);
					if (result === void 0 || result === null) {} else if (looksLikeAVFileValue(result)) file.value = result;
					else file.result = result;
					done(error, file);
				}
			});
			/**
			* @param {Error|null|undefined} [error]
			* @param {VFile|undefined} [file]
			* @returns {void}
			*/
			function done(error, file) {
				if (error || !file) reject(error);
				else if (resolve) resolve(file);
				else callback(null, file);
			}
		}
	}
	/** @type {Processor['processSync']} */
	function processSync(doc) {
		/** @type {boolean|undefined} */
		let complete;
		processor.freeze();
		assertParser("processSync", processor.Parser);
		assertCompiler("processSync", processor.Compiler);
		const file = vfile(doc);
		processor.process(file, done);
		assertDone("processSync", "process", complete);
		return file;
		/**
		* @param {Error|null|undefined} [error]
		* @returns {void}
		*/
		function done(error) {
			complete = true;
			bail(error);
		}
	}
}
/**
* Check if `value` is a constructor.
*
* @param {unknown} value
* @param {string} name
* @returns {boolean}
*/
function newable(value, name) {
	return typeof value === "function" && value.prototype && (keys(value.prototype) || name in value.prototype);
}
/**
* Check if `value` is an object with keys.
*
* @param {Record<string, unknown>} value
* @returns {boolean}
*/
function keys(value) {
	/** @type {string} */
	let key;
	for (key in value) if (own.call(value, key)) return true;
	return false;
}
/**
* Assert a parser is available.
*
* @param {string} name
* @param {unknown} value
* @returns {asserts value is Parser}
*/
function assertParser(name, value) {
	if (typeof value !== "function") throw new TypeError("Cannot `" + name + "` without `Parser`");
}
/**
* Assert a compiler is available.
*
* @param {string} name
* @param {unknown} value
* @returns {asserts value is Compiler}
*/
function assertCompiler(name, value) {
	if (typeof value !== "function") throw new TypeError("Cannot `" + name + "` without `Compiler`");
}
/**
* Assert the processor is not frozen.
*
* @param {string} name
* @param {unknown} frozen
* @returns {asserts frozen is false}
*/
function assertUnfrozen(name, frozen) {
	if (frozen) throw new Error("Cannot call `" + name + "` on a frozen processor.\nCreate a new processor first, by calling it: use `processor()` instead of `processor`.");
}
/**
* Assert `node` is a unist node.
*
* @param {unknown} node
* @returns {asserts node is Node}
*/
function assertNode(node) {
	if (!isPlainObject(node) || typeof node.type !== "string") throw new TypeError("Expected node, got `" + node + "`");
}
/**
* Assert that `complete` is `true`.
*
* @param {string} name
* @param {string} asyncName
* @param {unknown} complete
* @returns {asserts complete is true}
*/
function assertDone(name, asyncName, complete) {
	if (!complete) throw new Error("`" + name + "` finished async. Use `" + asyncName + "` instead");
}
/**
* @param {VFileCompatible} [value]
* @returns {VFile}
*/
function vfile(value) {
	return looksLikeAVFile(value) ? value : new VFile(value);
}
/**
* @param {VFileCompatible} [value]
* @returns {value is VFile}
*/
function looksLikeAVFile(value) {
	return Boolean(value && typeof value === "object" && "message" in value && "messages" in value);
}
/**
* @param {unknown} [value]
* @returns {value is VFileValue}
*/
function looksLikeAVFileValue(value) {
	return typeof value === "string" || (0, import_is_buffer.default)(value);
}
//#endregion
//#region libs/parse-minimal.ts
/**
* Parse `str` to an AST with minimal processing. E.g., macro
* arguments are not attached to macros, etc. when parsed with this
* function.
*/
function parseMinimal(str) {
	return _unified_latex_unified_latex_util_pegjs.LatexPegParser.parse(str);
}
/**
* Parse `str` to an AST with minimal processing. E.g., macro
* arguments are not attached to macros, etc. when parsed with this
* function.
*
* The parsing assumes a math-mode context, so, for example, `^` and `_` are
* parsed as macros (even though arguments are not attached to them).
*/
function parseMathMinimal(str) {
	return _unified_latex_unified_latex_util_pegjs.LatexPegParser.parse(str, { startRule: "math" });
}
//#endregion
//#region libs/plugin-from-string-minimal.ts
/**
* Parse a string to a LaTeX AST with no post processing. For example,
* no macro arguments will be attached, etc.
*/
var unifiedLatexFromStringMinimal = function unifiedLatexFromStringMinimal(options) {
	const parser = (str) => {
		if (options?.mode === "math") return {
			type: "root",
			content: parseMathMinimal(str),
			_renderInfo: { inMathMode: true }
		};
		return parseMinimal(str);
	};
	Object.assign(this, { Parser: parser });
};
//#endregion
//#region libs/reparse-math.ts
/**
* Reparse math environments/macro contents that should have been parsed in math mode but weren't.
*/
var unifiedLatexReparseMath = function unifiedLatexReparseMath(options) {
	const { mathEnvs = [], mathMacros = [] } = options || {};
	return unifiedLatexReparseMathConstructPlugin({
		mathMacros,
		mathEnvs
	});
};
/**
* Construct the inner function for the `unifiedLatexReparseMath` plugin. This function should not be used by libraries.
*/
function unifiedLatexReparseMathConstructPlugin({ mathEnvs, mathMacros }) {
	const isMathEnvironment = _unified_latex_unified_latex_util_match.match.createEnvironmentMatcher(mathEnvs);
	const isMathMacro = _unified_latex_unified_latex_util_match.match.createMacroMatcher(mathMacros);
	return (tree) => {
		(0, _unified_latex_unified_latex_util_visit.visit)(tree, (node) => {
			if (_unified_latex_unified_latex_util_match.match.anyMacro(node)) {
				for (const arg of node.args || []) if (arg.content.length > 0 && !wasParsedInMathMode(arg.content)) arg.content = parseMathMinimal((0, _unified_latex_unified_latex_util_print_raw.printRaw)(arg.content));
			}
			if (_unified_latex_unified_latex_util_match.match.anyEnvironment(node)) {
				if (!wasParsedInMathMode(node.content)) node.content = parseMathMinimal((0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.content));
			}
		}, { test: (node) => isMathEnvironment(node) || isMathMacro(node) });
	};
}
/**
* Use a heuristic to decide whether a string was parsed in math mode. The heuristic
* looks for strings of length greater than 1 or the failure for "_" and "^" to be parsed
* as a macro.
*/
function wasParsedInMathMode(nodes) {
	return !nodes.some((node) => _unified_latex_unified_latex_util_match.match.anyString(node) && node.content.length > 1 || _unified_latex_unified_latex_util_match.match.string(node, "^") || _unified_latex_unified_latex_util_match.match.string(node, "_"));
}
//#endregion
//#region libs/process-macros-and-environments.ts
/**
* Unified plugin to process macros and environments. Any environments that contain math content
* are reparsed (if needed) in math mode.
*/
var unifiedLatexProcessMacrosAndEnvironmentsWithMathReparse = function unifiedLatexProcessMacrosAndEnvironmentsWithMathReparse(options) {
	const { environments = {}, macros = {} } = options || {};
	const mathMacros = Object.fromEntries(Object.entries(macros).filter(([_, info]) => info.renderInfo?.inMathMode === true));
	const mathEnvs = Object.fromEntries(Object.entries(environments).filter(([_, info]) => info.renderInfo?.inMathMode === true));
	const mathReparser = unifiedLatexReparseMathConstructPlugin({
		mathEnvs: Object.keys(mathEnvs),
		mathMacros: Object.keys(mathMacros)
	});
	const isRelevantEnvironment = _unified_latex_unified_latex_util_match.match.createEnvironmentMatcher(environments);
	const isRelevantMathEnvironment = _unified_latex_unified_latex_util_match.match.createEnvironmentMatcher(mathEnvs);
	return (tree) => {
		(0, _unified_latex_unified_latex_util_visit.visit)(tree, {
			enter: (nodes) => {
				if (!Array.isArray(nodes)) return;
				(0, _unified_latex_unified_latex_util_arguments.attachMacroArgsInArray)(nodes, mathMacros);
			},
			leave: (node) => {
				if (!isRelevantMathEnvironment(node)) return;
				const envName = (0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.env);
				const envInfo = environments[envName];
				if (!envInfo) throw new Error(`Could not find environment info for environment "${envName}"`);
				(0, _unified_latex_unified_latex_util_environments.processEnvironment)(node, envInfo);
			}
		}, { includeArrays: true });
		mathReparser(tree);
		(0, _unified_latex_unified_latex_util_visit.visit)(tree, {
			enter: (nodes) => {
				if (!Array.isArray(nodes)) return;
				(0, _unified_latex_unified_latex_util_arguments.attachMacroArgsInArray)(nodes, macros);
			},
			leave: (node) => {
				if (!isRelevantEnvironment(node)) return;
				const envName = (0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.env);
				const envInfo = environments[envName];
				if (!envInfo) throw new Error(`Could not find environment info for environment "${envName}"`);
				(0, _unified_latex_unified_latex_util_environments.processEnvironment)(node, envInfo);
			}
		}, { includeArrays: true });
	};
};
//#endregion
//#region libs/process-at-letter-and-expl-macros.ts
/**
* Unified plugin to reprocess macros names to possibly include `@`, `_`, or `:`.
* This plugin detects the `\makeatletter` and `\ExplSyntaxOn` commands and reprocesses macro names
* inside of those blocks to include those characters.
*/
var unifiedLatexProcessAtLetterAndExplMacros = function unifiedLatexProcessAtLetterAndExplMacros(options) {
	let { atLetter = false, expl3 = false, autodetectExpl3AndAtLetter = false } = options || {};
	return (tree) => {
		(0, _unified_latex_unified_latex_util_catcode.reparseExpl3AndAtLetterRegions)(tree);
		if (atLetter || expl3) autodetectExpl3AndAtLetter = false;
		if (autodetectExpl3AndAtLetter) {
			atLetter = (0, _unified_latex_unified_latex_util_catcode.hasReparsableMacroNames)(tree, "@");
			expl3 = (0, _unified_latex_unified_latex_util_catcode.hasReparsableMacroNames)(tree, "_");
		}
		const charSet = /* @__PURE__ */ new Set();
		if (atLetter) charSet.add("@");
		if (expl3) {
			charSet.add(":");
			charSet.add("_");
		}
		if (charSet.size > 0) (0, _unified_latex_unified_latex_util_catcode.reparseMacroNames)(tree, charSet);
	};
};
//#endregion
//#region libs/plugin-from-string.ts
/**
* Parse a string to a LaTeX AST.
*/
var unifiedLatexFromString = function unifiedLatexFromString(options) {
	const { mode = "regular", macros = {}, environments = {}, flags: { atLetter = false, expl3 = false, autodetectExpl3AndAtLetter = false } = {} } = options || {};
	const allMacroInfo = Object.assign({}, ...Object.values(_unified_latex_unified_latex_ctan.macroInfo), macros);
	const allEnvInfo = Object.assign({}, ...Object.values(_unified_latex_unified_latex_ctan.environmentInfo), environments);
	const fullParser = unified().use(unifiedLatexFromStringMinimal, { mode }).use(unifiedLatexProcessAtLetterAndExplMacros, {
		atLetter,
		expl3,
		autodetectExpl3AndAtLetter
	}).use(unifiedLatexProcessMacrosAndEnvironmentsWithMathReparse, {
		macros: allMacroInfo,
		environments: allEnvInfo
	}).use(_unified_latex_unified_latex_util_trim.unifiedLatexTrimEnvironmentContents).use(_unified_latex_unified_latex_util_trim.unifiedLatexTrimRoot).use(unifiedLatexAstComplier);
	const parser = (str) => {
		return fullParser.processSync({ value: str }).result;
	};
	Object.assign(this, { Parser: parser });
};
//#endregion
//#region libs/parse.ts
var parser = unified().use(unifiedLatexFromString).freeze();
/**
* Parse the string into an AST.
*/
function parse(str) {
	return parser.parse(str);
}
/**
* Returns the default `unified-latex` parser, or create a new one with the
* provided `unifiedLatexFromString` options
* @param options Plugin options of `unifiedLatexFromString` plugin.
* @returns The default `unified-latex` parser if `options` is `undefined`, or a
* newly created `unified-latex` parser with the provided `options`.
*/
function getParser(options) {
	return options ? unified().use(unifiedLatexFromString, options).freeze() : parser;
}
//#endregion
//#region libs/parse-math.ts
/**
* Parse `str` into an AST. Parsing starts in math mode and a list of
* nodes is returned (instead of a "root" node).
*/
function parseMath(str) {
	if (typeof str !== "string") str = (0, _unified_latex_unified_latex_util_print_raw.printRaw)(str);
	return unified().use(unifiedLatexFromString, { mode: "math" }).parse({ value: str }).content;
}
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions parse strings to a `unified-latex` Abstract Syntax Tree (AST).
*
* ## When should I use this?
*
* If you have a string that you would like to parse to a `unified-latex` `Ast.Ast`, or
* if you are building a plugin for `unified()` that manipulates LaTeX.
*/
//#endregion
exports.getParser = getParser;
exports.parse = parse;
exports.parseMath = parseMath;
exports.parseMathMinimal = parseMathMinimal;
exports.parseMinimal = parseMinimal;
exports.unifiedLatexAstComplier = unifiedLatexAstComplier;
exports.unifiedLatexFromString = unifiedLatexFromString;
exports.unifiedLatexFromStringMinimal = unifiedLatexFromStringMinimal;
exports.unifiedLatexProcessAtLetterAndExplMacros = unifiedLatexProcessAtLetterAndExplMacros;
exports.unifiedLatexProcessMacrosAndEnvironmentsWithMathReparse = unifiedLatexProcessMacrosAndEnvironmentsWithMathReparse;
exports.unifiedLatexReparseMath = unifiedLatexReparseMath;
exports.unifiedLatexReparseMathConstructPlugin = unifiedLatexReparseMathConstructPlugin;

//# sourceMappingURL=index.cjs.map