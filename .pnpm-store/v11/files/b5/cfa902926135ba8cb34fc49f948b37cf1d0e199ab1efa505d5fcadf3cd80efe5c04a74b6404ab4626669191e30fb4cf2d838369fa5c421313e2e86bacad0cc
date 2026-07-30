'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var fm = require('framer-motion');

function _interopNamespaceDefault(e) {
	var n = Object.create(null);
	if (e) {
		Object.keys(e).forEach(function (k) {
			if (k !== 'default') {
				var d = Object.getOwnPropertyDescriptor(e, k);
				Object.defineProperty(n, k, d.get ? d : {
					enumerable: true,
					get: function () { return e[k]; }
				});
			}
		});
	}
	n.default = e;
	return Object.freeze(n);
}

var fm__namespace = /*#__PURE__*/_interopNamespaceDefault(fm);

// Re-export everything from framer-motion.
//
// `motion` and `m` are aliased through local bindings so the module has
// explicit named exports for IDE auto-import (see #3432). The previous
// `export { motion, m } from "framer-motion"` line — sitting alongside
// `export * from "framer-motion"` — was a duplicate-source re-export pattern
// that caused Next.js Turbopack to OOM during module-graph analysis (#3741).
// Local declarations shadow the wildcard re-export per the ES spec, so
// `motion` and `m` come from the explicit bindings below and the rest from
// `export *`.
const motion = fm__namespace.motion;
const m = fm__namespace.m;

exports.m = m;
exports.motion = motion;
Object.keys(fm).forEach(function (k) {
	if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
		enumerable: true,
		get: function () { return fm[k]; }
	});
});
