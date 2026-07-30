"use client";
var e = require("react/jsx-runtime"), t = require("react"), o = require("react-dom");

const r = null, {min: n, max: s, abs: i, floor: l} = Math, c = (e, t, o) => n(o, s(t, e)), f = e => [ ...e ].sort((e, t) => e - t), u = "function" == typeof queueMicrotask ? queueMicrotask : e => {
    Promise.resolve().then(e);
}, d = () => {
    let e;
    return [ new Promise(t => {
        e = t;
    }), e ];
}, a = e => {
    let t;
    return () => (e && (t = e(), e = void 0), t);
}, h = (e, t, o) => {
    const r = o ? "unshift" : "push";
    for (let o = 0; o < t; o++) e[r](-1);
    return e;
}, g = (e, t) => {
    const o = e.t[t];
    return -1 === o ? e.o : o;
}, p = (e, t, o) => {
    const r = -1 === e.t[t];
    return e.t[t] = o, e.i = n(t, e.i), r;
}, v = (e, t) => {
    if (!e.l) return 0;
    if (e.i >= t) return e.u[t];
    e.i < 0 && (e.u[0] = 0, e.i = 0);
    let o = e.i, r = e.u[o];
    for (;o < t; ) r += g(e, o), e.u[++o] = r;
    return e.i = t, r;
}, _ = (e, t, o = 0, r = e.l - 1) => {
    let n = o;
    for (;o <= r; ) {
        const s = l((o + r) / 2);
        v(e, s) <= t ? (n = s, o = s + 1) : r = s - 1;
    }
    return c(n, 0, e.l - 1);
}, w = (e, t, o) => {
    const r = t - e.l;
    return e.i = o ? -1 : n(t - 1, e.i), e.l = t, r > 0 ? (h(e.u, r), h(e.t, r, o), 
    e.o * r) : (e.u.splice(r), (o ? e.t.splice(0, -r) : e.t.splice(r)).reduce((t, o) => t - (-1 === o ? e.o : o), 0));
}, S = "undefined" != typeof window, m = e => e.documentElement, $ = e => e.ownerDocument, z = e => e.defaultView, b = /*#__PURE__*/ a(() => !!/iP(hone|od|ad)/.test(navigator.userAgent) || "MacIntel" === navigator.platform && navigator.maxTouchPoints > 0), y = /*#__PURE__*/ a(() => "scrollBehavior" in m(document).style), x = e => s(e.h(), e.p()), I = (e, t = 40, o = 0, l, c = !1) => {
    let u = !!o, d = 1, a = 0, S = 0, m = 0, $ = 0, z = 0, y = 0, x = 0, I = 0, k = r, R = [ 0, u ? s(o - 1, 0) : -1 ], T = 0, C = !1;
    const M = ((e, t, o) => ({
        o: t,
        t: o ? h(o.slice(0, n(e, o.length)), s(0, e - o.length)) : h([], e),
        l: e,
        i: -1,
        u: h([], e + 1)
    }))(e, l ? l[1] : t, l && l[0]), O = new Set, E = () => m - S, H = () => E() + z + $, W = (e, t) => ((e, t, o, r) => {
        if (r = n(r, e.l - 1), v(e, r) <= t) {
            const n = _(e, o, r);
            return [ _(e, t, r, n), n ];
        }
        {
            const n = _(e, t, void 0, r);
            return [ n, _(e, o, n) ];
        }
    })(M, e, t, R[0]), q = () => v(M, M.l), B = (e, t) => {
        const o = v(M, e) - z;
        return t ? q() - o - J(e) : o;
    }, J = e => g(M, e), A = (e, t = -1) => M.t[e] === t, L = e => {
        e && (b() && 0 !== x || k && 1 === I ? z += e : $ += e);
    };
    return {
        v: () => {
            O.clear();
        },
        _: () => d,
        S: () => (e => [ e.t.slice(), e.o ])(M),
        m: (e = 200) => {
            if (!C || u) return R;
            let t, o;
            if (y) [t, o] = R; else {
                let r = s(0, H()), i = r + a;
                c || (e = s(0, e), 1 !== x && (r -= e), 2 !== x && (i += e)), [t, o] = R = W(s(0, r), s(0, i)), 
                k && (t = n(t, k[0]), o = s(o, k[1]));
            }
            return [ s(t, 0), n(o, M.l - 1) ];
        },
        $: e => _(M, e - S),
        I: A,
        k: B,
        R: J,
        T: () => M.l,
        C: () => m,
        M: () => 0 !== x,
        p: () => a,
        O: () => S,
        h: q,
        H: () => (y = $, $ = 0, [ y, 2 === I ]),
        W: (e, t) => {
            const o = [ e, t ];
            return O.add(o), () => {
                O.delete(o);
            };
        },
        q: (e, t) => {
            let o, n, l = 0;
            switch (e) {
              case 1:
                {
                    if (t === m && 0 === I) break;
                    const e = y;
                    y = 0;
                    const o = t - m, r = i(o);
                    e && r < i(e) + 1 || 0 !== I || (x = o < 0 ? 2 : 1), u && (u = !1), m = t, l = 4;
                    const s = E();
                    s >= -a && s <= q() && (l += 1, n = r > a);
                    break;
                }

              case 2:
                l = 8, 0 !== x && (o = !0, l += 1), x = 0, I = 0, k = r;
                break;

              case 3:
                {
                    const e = t.filter(([e, t]) => !A(e, t));
                    if (!e.length) break;
                    L(e.reduce((e, [t, o]) => {
                        let r;
                        if (2 === I) r = !0; else if (k && 1 === I) r = t < k[0]; else {
                            const e = E(), o = B(t), n = J(t);
                            r = 1 !== x && 0 === I ? o + n <= e : o < e && o + n < e + a;
                        }
                        return r && (e += o - J(t)), e;
                    }, 0));
                    for (const [t, o] of e) {
                        const e = J(t), r = p(M, t, o);
                        c && (T += r ? o : o - e);
                    }
                    c && a && T > a && (L(((e, t) => {
                        let o = 0;
                        const r = [];
                        e.t.forEach((e, n) => {
                            -1 !== e && (r.push(e), n < t && o++);
                        }), e.i = -1;
                        const n = f(r), i = n.length, l = i / 2 | 0, c = i % 2 == 0 ? (n[l - 1] + n[l]) / 2 : n[l], u = e.o;
                        return ((e.o = c) - u) * s(t - o, 0);
                    })(M, _(M, H()))), c = !1), l = 3, n = !0;
                    break;
                }

              case 4:
                a !== t && (a || (C = n = !0), a = t, l = 3);
                break;

              case 5:
                t[1] ? (L(w(M, t[0], !0)), I = 2, l = 1) : (w(M, t[0]), l = 1);
                break;

              case 6:
                S = t;
                break;

              case 7:
                I = 1;
                break;

              case 8:
                k = W(t, t + a), l = 1;
            }
            l && (d = 1 + (2147483647 & d), o && z && ($ += z, z = 0), O.forEach(([e, t]) => {
                l & e && t(n);
            }));
        }
    };
}, k = setTimeout, R = (e, t) => t ? -e : e, T = (e, t, o, n, s, i) => {
    const l = Date.now;
    let c = 0, f = !1, u = !1, d = !1, a = !1;
    const h = (() => {
        let t;
        const o = () => {
            t != r && clearTimeout(t);
        }, n = () => {
            o(), t = k(() => {
                t = r, (() => {
                    if (f || u) return f = !1, void h();
                    d = !1, e.q(2);
                })();
            }, 150);
        };
        return n.B = o, n;
    })(), g = () => {
        c = l(), d && (a = !0), i && e.q(6, i()), e.q(1, n()), h();
    }, p = t => {
        if (f || !e.M() || t.ctrlKey) return;
        const r = l() - c;
        150 > r && 50 < r && (o ? t.deltaX : t.deltaY) && (f = !0);
    }, v = () => {
        u = !0, d = a = !1;
    }, _ = () => {
        u = !1, b() && (d = !0);
    };
    return t.addEventListener("scroll", g), t.addEventListener("wheel", p, {
        passive: !0
    }), t.addEventListener("touchstart", v, {
        passive: !0
    }), t.addEventListener("touchend", _, {
        passive: !0
    }), {
        J: () => {
            t.removeEventListener("scroll", g), t.removeEventListener("wheel", p), t.removeEventListener("touchstart", v), 
            t.removeEventListener("touchend", _), h.B();
        },
        A: () => {
            const [t, o] = e.H();
            t && (s(t, o, a), a = !1, o && e.p() > e.h() && e.q(1, n()));
        }
    };
}, C = (e, t, o) => {
    let r;
    return [ async (n, s) => {
        if (!await t()) return;
        r && r();
        const i = () => {
            const [t, o] = d();
            return r = () => {
                o(!1);
            }, e.p() && k(r, 150), [ t, e.W(2, () => {
                o(!0);
            }) ];
        };
        if (s && y()) e.q(8, n()), u(async () => {
            for (;;) {
                let t = !0;
                for (let [o, r] = e.m(); o <= r; o++) if (e.I(o)) {
                    t = !1;
                    break;
                }
                if (t) break;
                const [o, r] = i();
                try {
                    if (!await o) return;
                } finally {
                    r();
                }
            }
            e.q(7), o(n(), s);
        }); else for (;;) {
            const [t, r] = i();
            try {
                if (e.q(7), o(n()), !await t) return;
            } finally {
                r();
            }
        }
    }, () => {
        r && r();
    } ];
}, M = (e, t) => {
    let o, r, n = d(), s = !1;
    const i = t ? "scrollLeft" : "scrollTop", l = t ? "overflowX" : "overflowY", [f, u] = C(e, () => n[0], (e, r) => {
        e = R(e, s), r ? o.scrollTo({
            [t ? "left" : "top"]: e,
            behavior: "smooth"
        }) : o[i] = e;
    });
    return {
        L(c, f) {
            o = f, t && (s = "rtl" === getComputedStyle(f).direction), r = T(e, f, t, () => R(f[i], s), (t, o, r) => {
                if (r) {
                    const e = f.style, t = e[l];
                    e[l] = "hidden", k(() => {
                        e[l] = t;
                    });
                }
                f[i] = R(e.C() + t, s), o && u();
            }), n[1](!0);
        },
        v() {
            r && r.J(), n[1](!1), n = d();
        },
        N: () => s,
        P(e) {
            f(() => e);
        },
        X(t) {
            t += e.C(), f(() => t);
        },
        Y(t, {align: o, smooth: r, offset: n = 0} = {}) {
            if (t = c(t, 0, e.T() - 1), "nearest" === o) {
                const r = e.k(t), n = e.C();
                if (r < n) o = "start"; else {
                    if (!(r + e.R(t) > n + e.p())) return;
                    o = "end";
                }
            }
            f(() => n + e.O() + e.k(t) + ("end" === o ? e.R(t) - e.p() : "center" === o ? (e.R(t) - e.p()) / 2 : 0), r);
        },
        V: () => {
            r && r.A();
        }
    };
}, O = (e, t) => {
    let o, r, n = d(), s = !1;
    const i = t ? "left" : "top", [l] = C(e, () => n[0], (e, t) => {
        e = R(e, s);
        const r = z($(o));
        t ? r.scroll({
            [i]: e,
            behavior: "smooth"
        }) : r.scroll({
            [i]: e
        });
    }), f = (e, t, o, r, n = 0) => {
        const i = r ? "offsetLeft" : "offsetTop", l = n + (r && s ? o.innerWidth - e[i] - e.offsetWidth : e[i]), c = e.offsetParent;
        return e !== t && c ? f(c, t, o, r, l) : l;
    };
    return {
        L(l) {
            o = l;
            const c = t ? "scrollX" : "scrollY", u = $(l), d = z(u);
            t && (s = "rtl" === getComputedStyle(m(u)).direction), r = T(e, d, t, () => R(d[c], s), (t, o) => {
                o ? d.scroll({
                    [i]: R(e.C() + t, s)
                }) : d.scrollBy({
                    [i]: R(t, s)
                });
            }, () => f(l, u.body, d, t)), n[1](!0);
        },
        v() {
            r && r.J(), o = void 0, n[1](!1), n = d();
        },
        N: () => s,
        V: () => {
            r && r.A();
        },
        Y(r, {align: n, smooth: s, offset: i = 0} = {}) {
            if (!o) return;
            if (r = c(r, 0, e.T() - 1), "nearest" === n) {
                const t = e.k(r), o = e.C();
                if (t < o) n = "start"; else {
                    if (!(t + e.R(r) > o + e.p())) return;
                    n = "end";
                }
            }
            const u = $(o), d = z(u), a = m(u), h = () => e.p() - (t ? a.clientWidth : a.clientHeight);
            l(() => i + f(o, u.body, d, t) + e.k(r) + ("end" === n ? e.R(r) - (e.p() - h()) : "center" === n ? (e.R(r) - (e.p() - h())) / 2 : 0), s);
        }
    };
}, E = (e, t) => {
    const o = M(e, !1), r = M(t, !0);
    return {
        L(e, t) {
            o.L(e, t), r.L(e, t);
        },
        v() {
            o.v(), r.v();
        },
        N: r.N,
        P(e, t) {
            null != e && o.P(e), null != t && r.P(t);
        },
        X(e, t) {
            null != e && o.X(e), null != t && r.X(t);
        },
        Y(e, t) {
            null != e && o.Y(e), null != t && r.Y(t);
        },
        V() {
            o.V(), r.V();
        }
    };
}, H = e => {
    let t;
    return {
        j(o) {
            (t || (t = new (z($(o)).ResizeObserver)(e))).observe(o);
        },
        D(e) {
            t.unobserve(e);
        },
        J() {
            t && t.disconnect();
        }
    };
}, W = (e, t) => {
    let o;
    const n = t ? "width" : "height", s = new WeakMap, i = H(t => {
        const i = [];
        for (const {target: l, contentRect: c} of t) if (l.offsetParent) if (l === o) e.q(4, c[n]); else {
            const e = s.get(l);
            e != r && i.push([ e, c[n] ]);
        }
        i.length && e.q(3, i);
    });
    return {
        U(e) {
            i.j(o = e);
        },
        F: (e, t) => (s.set(e, t), i.j(e), () => {
            s.delete(e), i.D(e);
        }),
        v: i.J
    };
}, q = (e, t) => {
    const o = t ? "width" : "height", n = t ? "innerWidth" : "innerHeight", s = new WeakMap, i = H(t => {
        const n = [];
        for (const {target: e, contentRect: i} of t) {
            if (!e.offsetParent) continue;
            const t = s.get(e);
            t != r && n.push([ t, i[o] ]);
        }
        n.length && e.q(3, n);
    });
    let l;
    return {
        U(t) {
            const o = z($(t)), r = () => {
                e.q(4, o[n]);
            };
            o.addEventListener("resize", r), u(r), l = () => {
                o.removeEventListener("resize", r);
            };
        },
        F: (e, t) => (s.set(e, t), i.j(e), () => {
            s.delete(e), i.D(e);
        }),
        v() {
            l && l(), i.J();
        }
    };
}, B = (e, t) => {
    let o;
    const r = new WeakMap, n = new Set, i = new Set, l = new Map, c = (e, t) => `${e}-${t}`, f = H(f => {
        const u = new Set, d = new Set;
        for (const {target: n, contentRect: {width: s, height: i}} of f) if (n.offsetParent) if (n === o) e.q(4, i), 
        t.q(4, s); else {
            const e = r.get(n);
            if (e) {
                const [t, o] = e, r = c(t, o), n = l.get(r);
                let f, a;
                n ? (n[0] !== i && (f = !0), n[1] !== s && (a = !0)) : f = a = !0, f && u.add(t), 
                a && d.add(o), (f || a) && l.set(r, [ i, s ]);
            }
        }
        if (u.size) {
            const t = [];
            u.forEach(e => {
                let o = 0;
                i.forEach(t => {
                    const r = l.get(c(e, t));
                    r && (o = s(o, r[0]));
                }), o && t.push([ e, o ]);
            }), e.q(3, t);
        }
        if (d.size) {
            const e = [];
            d.forEach(t => {
                let o = 0;
                n.forEach(e => {
                    const r = l.get(c(e, t));
                    r && (o = s(o, r[1]));
                }), o && e.push([ t, o ]);
            }), t.q(3, e);
        }
    });
    return {
        U(e) {
            f.j(o = e);
        },
        F: (e, t, o) => (r.set(e, [ t, o ]), n.add(t), i.add(o), f.j(e), () => {
            r.delete(e), f.D(e);
        }),
        G(o) {
            for (const [t] of o) for (let o = 0; o < e.T(); o++) l.delete(c(o, t));
            t.q(3, o);
        },
        K(o) {
            for (const [e] of o) for (let o = 0; o < t.T(); o++) l.delete(c(e, o));
            e.q(3, o);
        },
        v: f.J
    };
}, J = S ? t.useLayoutEffect : t.useEffect, A = "current", L = (e, t) => {
    if (Array.isArray(e)) for (const o of e) L(o, t); else null == e || "boolean" == typeof e || t.push(e);
}, N = (e, t) => {
    const o = e.key;
    return null != o ? o : "_" + t;
}, P = e => {
    const o = t.useRef(null);
    return o[A] || (o[A] = e());
}, X = e => {
    const o = t.useRef(e);
    return J(() => {
        o[A] = e;
    }, [ e ]), o;
}, Y = /*#__PURE__*/ t.memo(({Z: o, ee: r, te: n, oe: s, re: i, ne: l, se: c, ie: f}) => {
    const u = t.useRef(null);
    J(() => r(u[A], n), [ n ]);
    const d = t.useMemo(() => {
        const e = {
            contain: "layout style",
            position: i && f ? void 0 : "absolute",
            [c ? "height" : "width"]: "100%",
            [c ? "top" : "left"]: 0,
            [c ? "left" : "top"]: s,
            visibility: !i || f ? void 0 : "hidden"
        };
        return c && (e.display = "inline-flex"), e;
    }, [ s, i, f, c ]);
    return "string" == typeof l ? e.jsx(l, {
        ref: u,
        style: d,
        children: o
    }) : e.jsx(l, {
        ref: u,
        style: d,
        index: n,
        children: o
    });
}), V = (e, o) => t.useMemo(() => {
    if ("function" == typeof e) return [ t => e(o[t], t), o.length ];
    const t = (e => {
        const t = [];
        return L(e, t), t;
    })(e);
    return [ e => t[e], t.length ];
}, [ e, o ]), j = /*#__PURE__*/ t.forwardRef(({children: r, data: n, bufferSize: s, itemSize: i, shift: l, horizontal: c, keepMounted: d, cache: a, startMargin: h = 0, ssrCount: g, as: p = "div", item: v = "div", scrollRef: _, onScroll: w, onScrollEnd: S}, m) => {
    const [$, z] = V(r, n), b = t.useRef(null), y = t.useRef(!!g), k = X(w), R = X(S), [T, C, O, E] = P(() => {
        const e = !!c, t = I(z, i, g, a, !i);
        return [ t, W(t, e), M(t, e), e ];
    });
    z !== T.T() && T.q(5, [ z, l ]), h !== T.O() && T.q(6, h);
    const [H, q] = t.useReducer(T._, void 0, T._), B = T.M(), L = T.h(), j = O.N(), D = [], U = t => {
        const o = $(t);
        return e.jsx(Y, {
            ee: C.F,
            te: t,
            oe: T.k(t, j),
            re: T.I(t),
            ne: v,
            Z: o,
            se: E,
            ie: y[A]
        }, N(o, t));
    };
    if (J(() => {
        y[A] = !1, T.W(1, e => {
            e ? o.flushSync(q) : q();
        }), T.W(4, () => {
            k[A] && k[A](T.C());
        }), T.W(8, () => {
            R[A] && R[A]();
        });
        const e = b[A], t = t => {
            C.U(t), O.L(e, t);
        };
        return _ ? u(() => {
            _[A] && t(_[A]);
        }) : t(e.parentElement), () => {
            T.v(), C.v(), O.v();
        };
    }, []), J(() => {
        O.V();
    }, [ H ]), t.useImperativeHandle(m, () => ({
        get cache() {
            return T.S();
        },
        get scrollOffset() {
            return T.C();
        },
        get scrollSize() {
            return x(T);
        },
        get viewportSize() {
            return T.p();
        },
        findItemIndex: T.$,
        getItemOffset: T.k,
        getItemSize: T.R,
        scrollToIndex: O.Y,
        scrollTo: O.P,
        scrollBy: O.X
    }), []), d) {
        const e = new Set(d);
        for (let [t, o] = T.m(s); t <= o; t++) e.add(t);
        f([ ...e ]).forEach(e => {
            D.push(U(e));
        });
    } else for (let [e, t] = T.m(s); e <= t; e++) D.push(U(e));
    return e.jsx(p, {
        ref: b,
        style: {
            contain: "size style",
            overflowAnchor: "none",
            flex: "none",
            position: "relative",
            width: E ? L : "100%",
            height: E ? "100%" : L,
            pointerEvents: B ? "none" : void 0
        },
        children: D
    });
}), D = /*#__PURE__*/ t.forwardRef(({children: t, data: o, bufferSize: r, itemSize: n, shift: s, horizontal: i, keepMounted: l, cache: c, ssrCount: f, item: u, onScroll: d, onScrollEnd: a, style: h, ...g}, p) => e.jsx("div", {
    ...g,
    style: {
        display: i ? "inline-block" : "block",
        [i ? "overflowX" : "overflowY"]: "auto",
        contain: "strict",
        width: "100%",
        height: "100%",
        ...h
    },
    children: e.jsx(j, {
        ref: p,
        data: o,
        bufferSize: r,
        itemSize: n,
        shift: s,
        horizontal: i,
        keepMounted: l,
        cache: c,
        ssrCount: f,
        item: u,
        onScroll: d,
        onScrollEnd: a,
        children: t
    })
})), U = /*#__PURE__*/ t.forwardRef(({children: r, data: n, bufferSize: s, itemSize: i, shift: l, horizontal: c, cache: f, ssrCount: u, as: d = "div", item: a = "div", onScroll: h, onScrollEnd: g}, p) => {
    const [v, _] = V(r, n), w = t.useRef(null), S = X(h), m = X(g), $ = t.useRef(!!u), [z, b, y, x] = P(() => {
        const e = !!c, t = I(_, i, u, f, !i);
        return [ t, q(t, e), O(t, e), e ];
    });
    _ !== z.T() && z.q(5, [ _, l ]);
    const [k, R] = t.useReducer(z._, void 0, z._), T = z.M(), C = z.h(), M = y.N(), E = [];
    J(() => {
        $[A] = !1, z.W(1, e => {
            e ? o.flushSync(R) : R();
        }), z.W(4, () => {
            S[A] && S[A]();
        }), z.W(8, () => {
            m[A] && m[A]();
        });
        const e = w[A];
        return b.U(e), y.L(e), () => {
            z.v(), b.v(), y.v();
        };
    }, []), J(() => {
        y.V();
    }, [ k ]), t.useImperativeHandle(p, () => ({
        get cache() {
            return z.S();
        },
        get scrollOffset() {
            return z.C();
        },
        get viewportSize() {
            return z.p();
        },
        findItemIndex: z.$,
        getItemOffset: z.k,
        getItemSize: z.R,
        scrollToIndex: y.Y
    }), []);
    for (let [t, o] = z.m(s); t <= o; t++) {
        const o = v(t);
        E.push(e.jsx(Y, {
            ee: b.F,
            te: t,
            oe: z.k(t, M),
            re: z.I(t),
            ne: a,
            Z: o,
            se: x,
            ie: $[A]
        }, N(o, t)));
    }
    return e.jsx(d, {
        ref: w,
        style: {
            contain: "size style",
            overflowAnchor: "none",
            flex: "none",
            position: "relative",
            width: x ? C : "100%",
            height: x ? "100%" : C,
            pointerEvents: T ? "none" : void 0
        },
        children: E
    });
}), F = (e, t) => `${e}-${t}`, G = /*#__PURE__*/ t.memo(({Z: o, ee: r, le: n, ce: s, fe: i, ue: l, de: c, ae: f, re: u, he: d}) => {
    const a = t.useRef(null);
    return J(() => r.F(a[A], n, s), [ s, n ]), e.jsx(d, {
        ref: a,
        style: t.useMemo(() => ({
            contain: "layout style",
            display: "grid",
            position: "absolute",
            top: i,
            left: l,
            visibility: u ? "hidden" : void 0,
            minHeight: c,
            minWidth: f
        }), [ i, l, f, c, u ]),
        children: o
    });
}), K = /*#__PURE__*/ t.forwardRef(({children: r, row: n, col: s, cellHeight: i = 40, cellWidth: l = 100, bufferSize: c, ssrRowCount: f, ssrColCount: u, item: d = "div", domRef: a, onScroll: h, onScrollEnd: g, style: p, ...v}, _) => {
    const [w, S, m, $] = P(() => {
        const e = I(n, i, f), t = I(s, l, u);
        return [ e, t, B(e, t), E(e, t) ];
    });
    n !== w.T() && w.q(5, [ n ]), s !== S.T() && S.q(5, [ s ]);
    const [z, b] = t.useReducer(w._, void 0, w._), [y, k] = t.useReducer(S._, void 0, S._), R = w.M(), T = S.M(), C = x(w), M = x(S), O = t.useRef(null), H = X(h), W = X(g);
    J(() => {
        w.W(1, e => {
            e ? o.flushSync(b) : b();
        }), S.W(1, e => {
            e ? o.flushSync(k) : k();
        }), w.W(4, () => {
            H[A] && H[A](w.C());
        }), w.W(8, () => {
            W[A] && W[A]();
        });
        const e = O[A], t = e.parentElement;
        return m.U(t), $.L(e, t), () => {
            w.v(), S.v(), m.v(), $.v();
        };
    }, []), J(() => {
        $.V();
    }, [ z, y ]), t.useImperativeHandle(_, () => ({
        get scrollTop() {
            return w.C();
        },
        get scrollLeft() {
            return S.C();
        },
        get scrollHeight() {
            return x(w);
        },
        get scrollWidth() {
            return x(S);
        },
        get viewportHeight() {
            return w.p();
        },
        get viewportWidth() {
            return S.p();
        },
        findRowIndex: w.$,
        findColIndex: S.$,
        getRowOffset: w.k,
        getColOffset: S.k,
        getRowSize: w.R,
        getColSize: S.R,
        resizeCols(e) {
            m.G(e);
        },
        resizeRows(e) {
            m.K(e);
        },
        scrollToIndex: $.Y,
        scrollTo: $.P,
        scrollBy: $.X
    }), []);
    const q = t.useMemo(() => {
        const e = new Map;
        return (t, o) => {
            let n = e.get(F(t, o));
            return n || e.set(F(t, o), n = r({
                rowIndex: t,
                colIndex: o
            })), n;
        };
    }, [ r ]), L = $.N(), [N, Y] = w.m(c), [V, j] = S.m(c), D = [];
    for (let t = N; t <= Y; t++) for (let o = V; o <= j; o++) D.push(e.jsx(G, {
        ee: m,
        le: t,
        ce: o,
        fe: w.k(t),
        ue: S.k(o, L),
        de: w.R(t),
        ae: S.R(o),
        re: w.I(t) || S.I(o),
        he: d,
        Z: q(t, o)
    }, F(t, o)));
    return e.jsx("div", {
        ref: a,
        ...v,
        style: {
            overflow: "auto",
            contain: "strict",
            width: "100%",
            height: "100%",
            ...p
        },
        children: e.jsx("div", {
            ref: O,
            style: {
                contain: "size style",
                overflowAnchor: "none",
                flex: "none",
                position: "relative",
                width: M,
                height: C,
                pointerEvents: R || T ? "none" : void 0
            },
            children: D
        })
    });
});

exports.VList = D, exports.Virtualizer = j, exports.WindowVirtualizer = U, exports.experimental_VGrid = K;
//# sourceMappingURL=index.cjs.map
