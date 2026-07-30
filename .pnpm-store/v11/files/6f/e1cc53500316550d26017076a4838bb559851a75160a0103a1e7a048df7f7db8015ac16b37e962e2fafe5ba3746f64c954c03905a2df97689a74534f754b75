import { createContext as e, useCallback as t, useContext as n, useEffect as r, useLayoutEffect as i, useMemo as a, useRef as o, useState as s } from "react";
import { jsx as c } from "react/jsx-runtime";
//#region src/lib/parseHotkeys.ts
var l = [
	"shift",
	"alt",
	"meta",
	"mod",
	"ctrl",
	"control"
];
function u() {
	return typeof navigator > "u" ? !1 : /mac/i.test(navigator.userAgent) && !/iphone|ipad|ipod/i.test(navigator.userAgent);
}
var d = {
	esc: "escape",
	return: "enter",
	left: "arrowleft",
	right: "arrowright",
	up: "arrowup",
	down: "arrowdown",
	ShiftLeft: "shift",
	ShiftRight: "shift",
	AltLeft: "alt",
	AltRight: "alt",
	MetaLeft: "meta",
	MetaRight: "meta",
	OSLeft: "meta",
	OSRight: "meta",
	ControlLeft: "ctrl",
	ControlRight: "ctrl"
};
function f(e) {
	return (d[e.trim()] || e.trim()).toLowerCase().replace(/key|digit|numpad/, "");
}
function p(e) {
	return l.includes(e);
}
function m(e, t = ",") {
	return e.toLowerCase().split(t);
}
function h(e, t = "+", n = ">", r = !1, i, a) {
	let o = [], s = !1;
	e = e.trim(), e.includes(n) ? (s = !0, o = e.toLocaleLowerCase().split(n).map((e) => f(e))) : o = e.toLocaleLowerCase().split(t).map((e) => f(e));
	let c = {
		alt: o.includes("alt"),
		ctrl: o.includes("ctrl") || o.includes("control"),
		shift: o.includes("shift"),
		meta: o.includes("meta"),
		mod: o.includes("mod"),
		useKey: r
	}, u = o.filter((e) => !l.includes(e));
	return {
		...c,
		keys: u,
		description: i,
		isSequence: s,
		hotkey: e,
		metadata: a
	};
}
//#endregion
//#region src/lib/isHotkeyPressed.ts
typeof document < "u" && (document.addEventListener("keydown", (e) => {
	e.code !== void 0 && y([f(e.code)]);
}), document.addEventListener("keyup", (e) => {
	e.code !== void 0 && b([f(e.code)]);
})), typeof window < "u" && (window.addEventListener("blur", () => {
	g.clear();
}), window.addEventListener("focus", () => {
	g.clear();
}), window.addEventListener("contextmenu", () => {
	setTimeout(() => {
		g.clear();
	}, 0);
})), typeof document < "u" && document.addEventListener("visibilitychange", () => {
	g.clear();
});
var g = /* @__PURE__ */ new Set();
function _(e) {
	return Array.isArray(e);
}
function v(e, t = ",") {
	return (_(e) ? e : e.split(t)).every((e) => g.has(e.trim().toLowerCase()));
}
function y(e) {
	let t = Array.isArray(e) ? e : [e];
	g.has("meta") && g.forEach((e) => {
		p(e) || g.delete(e.toLowerCase());
	}), t.forEach((e) => {
		g.add(e.toLowerCase());
	});
}
function b(e) {
	e === "meta" ? g.clear() : (Array.isArray(e) ? e : [e]).forEach((e) => {
		g.delete(e.toLowerCase());
	});
}
//#endregion
//#region src/lib/validators.ts
function x(e, t, n) {
	(typeof n == "function" && n(e, t) || n === !0) && e.preventDefault();
}
function S(e, t, n) {
	return typeof n == "function" ? n(e, t) : n === !0 || n === void 0;
}
var C = [
	"input",
	"textarea",
	"select",
	"searchbox",
	"slider",
	"spinbutton",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"option",
	"radio",
	"textbox"
];
function w(e) {
	return T(e, C);
}
function T(e, t = !1) {
	let { target: n, composed: r } = e, i, a;
	return E(n) && r ? (i = e.composedPath()[0] && e.composedPath()[0].tagName, a = e.composedPath()[0] && e.composedPath()[0].role) : (i = n && n.tagName, a = n && n.role), _(t) ? !!(i && t?.some((e) => e.toLowerCase() === i.toLowerCase() || e === a)) : !!(i && t && t);
}
function E(e) {
	return !!e.tagName && !e.tagName.startsWith("-") && e.tagName.includes("-");
}
function D(e, t) {
	return e.length === 0 && t ? !1 : t ? e.some((e) => t.includes(e)) || e.includes("*") : !0;
}
var O = (e, t, n = !1) => {
	let { alt: r, meta: i, mod: a, shift: o, ctrl: s, keys: c, useKey: l } = t, { code: d, key: p, ctrlKey: m, metaKey: h, shiftKey: g, altKey: _ } = e, y = f(d), b = typeof e.getModifierState == "function" && e.getModifierState("AltGraph");
	if (!l && !c?.includes(y) && ![
		"ctrl",
		"control",
		"unknown",
		"meta",
		"alt",
		"shift",
		"os"
	].includes(y)) return !1;
	if (!n) {
		if (r !== _ && y !== "alt" || o !== g && y !== "shift") return !1;
		if (a) {
			if (u() ? !h : !m) return !1;
		} else if (i !== h && y !== "meta" && y !== "os" || s !== m && y !== "ctrl" && y !== "control") return !1;
		if (b && !r && !s && !a && ![
			"alt",
			"ctrl",
			"control"
		].includes(y)) return !1;
	}
	return l && c?.length === 1 && c.includes(p.toLowerCase()) || c && c.length === 1 && c.includes(y) ? !0 : c && c.length > 0 ? c.includes(y) ? v(c) : !1 : !c || c.length === 0;
}, k = e(void 0), A = () => n(k);
function j({ addHotkey: e, removeHotkey: t, children: n }) {
	return /* @__PURE__ */ c(k.Provider, {
		value: {
			addHotkey: e,
			removeHotkey: t
		},
		children: n
	});
}
//#endregion
//#region src/lib/deepEqual.ts
function M(e, t) {
	return e && t && typeof e == "object" && typeof t == "object" ? Object.keys(e).length === Object.keys(t).length && Object.keys(e).reduce((n, r) => n && M(e[r], t[r]), !0) : e === t;
}
//#endregion
//#region src/lib/HotkeysProvider.tsx
var N = e({
	hotkeys: [],
	activeScopes: [],
	toggleScope: () => {},
	enableScope: () => {},
	disableScope: () => {}
}), P = () => n(N), F = ({ initiallyActiveScopes: e = ["*"], children: n }) => {
	let [r, i] = s(e), [a, o] = s([]), l = t((e) => {
		i((t) => t.includes("*") ? [e] : Array.from(new Set([...t, e])));
	}, []), u = t((e) => {
		i((t) => t.filter((t) => t !== e));
	}, []), d = t((e) => {
		i((t) => t.includes(e) ? t.filter((t) => t !== e) : t.includes("*") ? [e] : Array.from(new Set([...t, e])));
	}, []), f = t((e) => {
		o((t) => [...t, e]);
	}, []), p = t((e) => {
		o((t) => t.filter((t) => !M(t, e)));
	}, []);
	return /* @__PURE__ */ c(N.Provider, {
		value: {
			activeScopes: r,
			hotkeys: a,
			enableScope: l,
			disableScope: u,
			toggleScope: d
		},
		children: /* @__PURE__ */ c(j, {
			addHotkey: f,
			removeHotkey: p,
			children: n
		})
	});
};
//#endregion
//#region src/lib/useDeepEqualMemo.ts
function I(e) {
	let t = o(void 0);
	return M(t.current, e) || (t.current = e), t.current;
}
//#endregion
//#region src/lib/useHotkeys.ts
var L = (e) => {
	e.stopPropagation(), e.preventDefault(), e.stopImmediatePropagation();
}, R = typeof window < "u" ? i : r;
function z(e) {
	if (!e) return;
	let { enabled: t, preventDefault: n, ignoreEventWhen: r, ...i } = e;
	return typeof t == "function" ? i : {
		...i,
		enabled: t
	};
}
function B(e, n, r, i) {
	let [a, c] = s(null), l = t((e) => (c(e), () => c(null)), []), u = o(!1), d = Array.isArray(r) ? Array.isArray(i) ? void 0 : i : r, g = _(e) ? e.join(d?.delimiter) : e, v = Array.isArray(r) ? r : Array.isArray(i) ? i : void 0, C = t(n, v ?? []), E = o(C);
	v ? E.current = C : E.current = n;
	let k = I(z(d)), j = o(d?.enabled);
	j.current = d?.enabled;
	let M = o(d?.preventDefault);
	M.current = d?.preventDefault;
	let N = o(d?.ignoreEventWhen);
	N.current = d?.ignoreEventWhen;
	let { activeScopes: F } = P(), B = A();
	return R(() => {
		if (j.current === !1 || !D(F, k?.scopes)) return;
		let e = [], t, n = (n, r = !1) => {
			if (!(w(n) && !T(n, k?.enableOnFormTags))) {
				if (a !== null) {
					let e = a.getRootNode();
					if ((e instanceof Document || e instanceof ShadowRoot) && e.activeElement !== a && !a.contains(e.activeElement)) {
						L(n);
						return;
					}
				}
				n.target?.isContentEditable && !k?.enableOnContentEditable || m(g, k?.delimiter).forEach((i) => {
					if (i.includes(k?.splitKey ?? "+") && i.includes(k?.sequenceSplitKey ?? ">")) {
						console.warn(`Hotkey ${i} contains both ${k?.splitKey ?? "+"} and ${k?.sequenceSplitKey ?? ">"} which is not supported.`);
						return;
					}
					let a = h(i, k?.splitKey, k?.sequenceSplitKey, k?.useKey, k?.description, k?.metadata);
					if (a.isSequence) {
						t = setTimeout(() => {
							e = [];
						}, k?.sequenceTimeoutMs ?? 1e3);
						let r = a.useKey ? n.key : f(n.code);
						if (p(r.toLowerCase())) return;
						if (e.push(r), r !== a.keys?.[e.length - 1]) {
							e = [], t && clearTimeout(t);
							return;
						}
						e.length === a.keys?.length && (E.current(n, a), t && clearTimeout(t), e = []);
					} else if (O(n, a, k?.ignoreModifiers) || a.keys?.includes("*")) {
						if (N.current?.(n) || r && u.current || (x(n, a, M.current), !S(n, a, j.current))) return;
						E.current(n, a), r || (u.current = !0);
					}
				});
			}
		}, r = (e) => {
			e.code !== void 0 && (y(f(e.code)), (k?.keydown === void 0 && k?.keyup !== !0 || k?.keydown) && n(e));
		}, i = (e) => {
			e.code !== void 0 && (b(f(e.code)), u.current = !1, k?.keyup && n(e, !0));
		}, o = a || d?.document || document;
		return o.addEventListener("keyup", i, d?.eventListenerOptions), o.addEventListener("keydown", r, d?.eventListenerOptions), B && m(g, k?.delimiter).forEach((e) => {
			B.addHotkey(h(e, k?.splitKey, k?.sequenceSplitKey, k?.useKey, k?.description, k?.metadata));
		}), () => {
			o.removeEventListener("keyup", i, d?.eventListenerOptions), o.removeEventListener("keydown", r, d?.eventListenerOptions), B && m(g, k?.delimiter).forEach((e) => {
				B.removeHotkey(h(e, k?.splitKey, k?.sequenceSplitKey, k?.useKey, k?.description, k?.metadata));
			}), e = [], t && clearTimeout(t);
		};
	}, [
		a,
		k,
		F,
		g
	]), l;
}
//#endregion
//#region src/lib/useRecordHotkeys.ts
function V(e = !1, n = []) {
	let [i, o] = s(/* @__PURE__ */ new Set()), [c, l] = s(!1), u = a(() => new Set(n.map((e) => e.toLowerCase())), [n]), d = t((t) => {
		if (t.code === void 0) return;
		let n = f(e ? t.key : t.code).toLowerCase();
		u.has(n) || (t.preventDefault(), t.stopPropagation(), o((e) => {
			let t = new Set(e);
			return t.add(n), t;
		}));
	}, [e, u]), p = t(() => {
		l(!1);
	}, []), m = t(() => {
		o(/* @__PURE__ */ new Set()), l(!0);
	}, []), h = t(() => {
		o(/* @__PURE__ */ new Set());
	}, []);
	return r(() => {
		if (typeof document < "u" && c) return document.addEventListener("keydown", d), () => {
			document.removeEventListener("keydown", d);
		};
	}, [c, d]), [i, {
		start: m,
		stop: p,
		resetKeys: h,
		isRecording: c
	}];
}
//#endregion
export { F as HotkeysProvider, v as isHotkeyPressed, B as useHotkeys, P as useHotkeysContext, V as useRecordHotkeys };
