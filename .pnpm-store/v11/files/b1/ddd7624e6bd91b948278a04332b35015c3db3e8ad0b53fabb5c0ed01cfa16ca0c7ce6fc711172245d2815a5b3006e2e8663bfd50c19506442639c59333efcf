"use client";
import { jsx as e } from "react/jsx-runtime";

import { useLayoutEffect as t, useEffect as o, useRef as n, memo as r, useMemo as s, forwardRef as i, useReducer as l, useImperativeHandle as c } from "react";

import { flushSync as f } from "react-dom";

const u = null, {min: d, max: a, abs: h, floor: g} = Math, p = (e, t, o) => d(o, a(t, e)), v = e => [ ...e ].sort((e, t) => e - t), m = "function" == typeof queueMicrotask ? queueMicrotask : e => {
    Promise.resolve().then(e);
}, _ = () => {
    let e;
    return [ new Promise(t => {
        e = t;
    }), e ];
}, w = e => {
    let t;
    return () => (e && (t = e(), e = void 0), t);
}, S = (e, t, o) => {
    const n = o ? "unshift" : "push";
    for (let o = 0; o < t; o++) e[n](-1);
    return e;
}, $ = (e, t) => {
    const o = e.t[t];
    return -1 === o ? e.o : o;
}, z = (e, t, o) => {
    const n = -1 === e.t[t];
    return e.t[t] = o, e.i = d(t, e.i), n;
}, b = (e, t) => {
    if (!e.l) return 0;
    if (e.i >= t) return e.u[t];
    e.i < 0 && (e.u[0] = 0, e.i = 0);
    let o = e.i, n = e.u[o];
    for (;o < t; ) n += $(e, o), e.u[++o] = n;
    return e.i = t, n;
}, y = (e, t, o = 0, n = e.l - 1) => {
    let r = o;
    for (;o <= n; ) {
        const s = g((o + n) / 2);
        b(e, s) <= t ? (r = s, o = s + 1) : n = s - 1;
    }
    return p(r, 0, e.l - 1);
}, x = (e, t, o) => {
    const n = t - e.l;
    return e.i = o ? -1 : d(t - 1, e.i), e.l = t, n > 0 ? (S(e.u, n), S(e.t, n, o), 
    e.o * n) : (e.u.splice(n), (o ? e.t.splice(0, -n) : e.t.splice(n)).reduce((t, o) => t - (-1 === o ? e.o : o), 0));
}, I = "undefined" != typeof window, k = e => e.documentElement, R = e => e.ownerDocument, T = e => e.defaultView, C = /*#__PURE__*/ w(() => !!/iP(hone|od|ad)/.test(navigator.userAgent) || "MacIntel" === navigator.platform && navigator.maxTouchPoints > 0), M = /*#__PURE__*/ w(() => "scrollBehavior" in k(document).style), O = e => a(e.h(), e.p()), E = (e, t = 40, o = 0, n, r = !1) => {
    let s = !!o, i = 1, l = 0, c = 0, f = 0, g = 0, p = 0, m = 0, _ = 0, w = 0, I = u, k = [ 0, s ? a(o - 1, 0) : -1 ], R = 0, T = !1;
    const M = ((e, t, o) => ({
        o: t,
        t: o ? S(o.slice(0, d(e, o.length)), a(0, e - o.length)) : S([], e),
        l: e,
        i: -1,
        u: S([], e + 1)
    }))(e, n ? n[1] : t, n && n[0]), O = new Set, E = () => f - c, H = () => E() + p + g, W = (e, t) => ((e, t, o, n) => {
        if (n = d(n, e.l - 1), b(e, n) <= t) {
            const r = y(e, o, n);
            return [ y(e, t, n, r), r ];
        }
        {
            const r = y(e, t, void 0, n);
            return [ r, y(e, o, r) ];
        }
    })(M, e, t, k[0]), B = () => b(M, M.l), J = (e, t) => {
        const o = b(M, e) - p;
        return t ? B() - o - A(e) : o;
    }, A = e => $(M, e), L = (e, t = -1) => M.t[e] === t, N = e => {
        e && (C() && 0 !== _ || I && 1 === w ? p += e : g += e);
    };
    return {
        v: () => {
            O.clear();
        },
        m: () => i,
        _: () => (e => [ e.t.slice(), e.o ])(M),
        S: (e = 200) => {
            if (!T || s) return k;
            let t, o;
            if (m) [t, o] = k; else {
                let n = a(0, H()), s = n + l;
                r || (e = a(0, e), 1 !== _ && (n -= e), 2 !== _ && (s += e)), [t, o] = k = W(a(0, n), a(0, s)), 
                I && (t = d(t, I[0]), o = a(o, I[1]));
            }
            return [ a(t, 0), d(o, M.l - 1) ];
        },
        $: e => y(M, e - c),
        I: L,
        k: J,
        R: A,
        T: () => M.l,
        C: () => f,
        M: () => 0 !== _,
        p: () => l,
        O: () => c,
        h: B,
        H: () => (m = g, g = 0, [ m, 2 === w ]),
        W: (e, t) => {
            const o = [ e, t ];
            return O.add(o), () => {
                O.delete(o);
            };
        },
        B: (e, t) => {
            let o, n, d = 0;
            switch (e) {
              case 1:
                {
                    if (t === f && 0 === w) break;
                    const e = m;
                    m = 0;
                    const o = t - f, r = h(o);
                    e && r < h(e) + 1 || 0 !== w || (_ = o < 0 ? 2 : 1), s && (s = !1), f = t, d = 4;
                    const i = E();
                    i >= -l && i <= B() && (d += 1, n = r > l);
                    break;
                }

              case 2:
                d = 8, 0 !== _ && (o = !0, d += 1), _ = 0, w = 0, I = u;
                break;

              case 3:
                {
                    const e = t.filter(([e, t]) => !L(e, t));
                    if (!e.length) break;
                    N(e.reduce((e, [t, o]) => {
                        let n;
                        if (2 === w) n = !0; else if (I && 1 === w) n = t < I[0]; else {
                            const e = E(), o = J(t), r = A(t);
                            n = 1 !== _ && 0 === w ? o + r <= e : o < e && o + r < e + l;
                        }
                        return n && (e += o - A(t)), e;
                    }, 0));
                    for (const [t, o] of e) {
                        const e = A(t), n = z(M, t, o);
                        r && (R += n ? o : o - e);
                    }
                    r && l && R > l && (N(((e, t) => {
                        let o = 0;
                        const n = [];
                        e.t.forEach((e, r) => {
                            -1 !== e && (n.push(e), r < t && o++);
                        }), e.i = -1;
                        const r = v(n), s = r.length, i = s / 2 | 0, l = s % 2 == 0 ? (r[i - 1] + r[i]) / 2 : r[i], c = e.o;
                        return ((e.o = l) - c) * a(t - o, 0);
                    })(M, y(M, H()))), r = !1), d = 3, n = !0;
                    break;
                }

              case 4:
                l !== t && (l || (T = n = !0), l = t, d = 3);
                break;

              case 5:
                t[1] ? (N(x(M, t[0], !0)), w = 2, d = 1) : (x(M, t[0]), d = 1);
                break;

              case 6:
                c = t;
                break;

              case 7:
                w = 1;
                break;

              case 8:
                I = W(t, t + l), d = 1;
            }
            d && (i = 1 + (2147483647 & i), o && p && (g += p, p = 0), O.forEach(([e, t]) => {
                d & e && t(n);
            }));
        }
    };
}, H = setTimeout, W = (e, t) => t ? -e : e, B = (e, t, o, n, r, s) => {
    const i = Date.now;
    let l = 0, c = !1, f = !1, d = !1, a = !1;
    const h = (() => {
        let t;
        const o = () => {
            t != u && clearTimeout(t);
        }, n = () => {
            o(), t = H(() => {
                t = u, (() => {
                    if (c || f) return c = !1, void h();
                    d = !1, e.B(2);
                })();
            }, 150);
        };
        return n.J = o, n;
    })(), g = () => {
        l = i(), d && (a = !0), s && e.B(6, s()), e.B(1, n()), h();
    }, p = t => {
        if (c || !e.M() || t.ctrlKey) return;
        const n = i() - l;
        150 > n && 50 < n && (o ? t.deltaX : t.deltaY) && (c = !0);
    }, v = () => {
        f = !0, d = a = !1;
    }, m = () => {
        f = !1, C() && (d = !0);
    };
    return t.addEventListener("scroll", g), t.addEventListener("wheel", p, {
        passive: !0
    }), t.addEventListener("touchstart", v, {
        passive: !0
    }), t.addEventListener("touchend", m, {
        passive: !0
    }), {
        A: () => {
            t.removeEventListener("scroll", g), t.removeEventListener("wheel", p), t.removeEventListener("touchstart", v), 
            t.removeEventListener("touchend", m), h.J();
        },
        L: () => {
            const [t, o] = e.H();
            t && (r(t, o, a), a = !1, o && e.p() > e.h() && e.B(1, n()));
        }
    };
}, J = (e, t, o) => {
    let n;
    return [ async (r, s) => {
        if (!await t()) return;
        n && n();
        const i = () => {
            const [t, o] = _();
            return n = () => {
                o(!1);
            }, e.p() && H(n, 150), [ t, e.W(2, () => {
                o(!0);
            }) ];
        };
        if (s && M()) e.B(8, r()), m(async () => {
            for (;;) {
                let t = !0;
                for (let [o, n] = e.S(); o <= n; o++) if (e.I(o)) {
                    t = !1;
                    break;
                }
                if (t) break;
                const [o, n] = i();
                try {
                    if (!await o) return;
                } finally {
                    n();
                }
            }
            e.B(7), o(r(), s);
        }); else for (;;) {
            const [t, n] = i();
            try {
                if (e.B(7), o(r()), !await t) return;
            } finally {
                n();
            }
        }
    }, () => {
        n && n();
    } ];
}, A = (e, t) => {
    let o, n, r = _(), s = !1;
    const i = t ? "scrollLeft" : "scrollTop", l = t ? "overflowX" : "overflowY", [c, f] = J(e, () => r[0], (e, n) => {
        e = W(e, s), n ? o.scrollTo({
            [t ? "left" : "top"]: e,
            behavior: "smooth"
        }) : o[i] = e;
    });
    return {
        N(c, u) {
            o = u, t && (s = "rtl" === getComputedStyle(u).direction), n = B(e, u, t, () => W(u[i], s), (t, o, n) => {
                if (n) {
                    const e = u.style, t = e[l];
                    e[l] = "hidden", H(() => {
                        e[l] = t;
                    });
                }
                u[i] = W(e.C() + t, s), o && f();
            }), r[1](!0);
        },
        v() {
            n && n.A(), r[1](!1), r = _();
        },
        P: () => s,
        V(e) {
            c(() => e);
        },
        X(t) {
            t += e.C(), c(() => t);
        },
        Y(t, {align: o, smooth: n, offset: r = 0} = {}) {
            if (t = p(t, 0, e.T() - 1), "nearest" === o) {
                const n = e.k(t), r = e.C();
                if (n < r) o = "start"; else {
                    if (!(n + e.R(t) > r + e.p())) return;
                    o = "end";
                }
            }
            c(() => r + e.O() + e.k(t) + ("end" === o ? e.R(t) - e.p() : "center" === o ? (e.R(t) - e.p()) / 2 : 0), n);
        },
        q: () => {
            n && n.L();
        }
    };
}, L = (e, t) => {
    let o, n, r = _(), s = !1;
    const i = t ? "left" : "top", [l] = J(e, () => r[0], (e, t) => {
        e = W(e, s);
        const n = T(R(o));
        t ? n.scroll({
            [i]: e,
            behavior: "smooth"
        }) : n.scroll({
            [i]: e
        });
    }), c = (e, t, o, n, r = 0) => {
        const i = n ? "offsetLeft" : "offsetTop", l = r + (n && s ? o.innerWidth - e[i] - e.offsetWidth : e[i]), f = e.offsetParent;
        return e !== t && f ? c(f, t, o, n, l) : l;
    };
    return {
        N(l) {
            o = l;
            const f = t ? "scrollX" : "scrollY", u = R(l), d = T(u);
            t && (s = "rtl" === getComputedStyle(k(u)).direction), n = B(e, d, t, () => W(d[f], s), (t, o) => {
                o ? d.scroll({
                    [i]: W(e.C() + t, s)
                }) : d.scrollBy({
                    [i]: W(t, s)
                });
            }, () => c(l, u.body, d, t)), r[1](!0);
        },
        v() {
            n && n.A(), o = void 0, r[1](!1), r = _();
        },
        P: () => s,
        q: () => {
            n && n.L();
        },
        Y(n, {align: r, smooth: s, offset: i = 0} = {}) {
            if (!o) return;
            if (n = p(n, 0, e.T() - 1), "nearest" === r) {
                const t = e.k(n), o = e.C();
                if (t < o) r = "start"; else {
                    if (!(t + e.R(n) > o + e.p())) return;
                    r = "end";
                }
            }
            const f = R(o), u = T(f), d = k(f), a = () => e.p() - (t ? d.clientWidth : d.clientHeight);
            l(() => i + c(o, f.body, u, t) + e.k(n) + ("end" === r ? e.R(n) - (e.p() - a()) : "center" === r ? (e.R(n) - (e.p() - a())) / 2 : 0), s);
        }
    };
}, N = (e, t) => {
    const o = A(e, !1), n = A(t, !0);
    return {
        N(e, t) {
            o.N(e, t), n.N(e, t);
        },
        v() {
            o.v(), n.v();
        },
        P: n.P,
        V(e, t) {
            null != e && o.V(e), null != t && n.V(t);
        },
        X(e, t) {
            null != e && o.X(e), null != t && n.X(t);
        },
        Y(e, t) {
            null != e && o.Y(e), null != t && n.Y(t);
        },
        q() {
            o.q(), n.q();
        }
    };
}, P = e => {
    let t;
    return {
        j(o) {
            (t || (t = new (T(R(o)).ResizeObserver)(e))).observe(o);
        },
        D(e) {
            t.unobserve(e);
        },
        A() {
            t && t.disconnect();
        }
    };
}, V = (e, t) => {
    let o;
    const n = t ? "width" : "height", r = new WeakMap, s = P(t => {
        const s = [];
        for (const {target: i, contentRect: l} of t) if (i.offsetParent) if (i === o) e.B(4, l[n]); else {
            const e = r.get(i);
            e != u && s.push([ e, l[n] ]);
        }
        s.length && e.B(3, s);
    });
    return {
        G(e) {
            s.j(o = e);
        },
        U: (e, t) => (r.set(e, t), s.j(e), () => {
            r.delete(e), s.D(e);
        }),
        v: s.A
    };
}, X = (e, t) => {
    const o = t ? "width" : "height", n = t ? "innerWidth" : "innerHeight", r = new WeakMap, s = P(t => {
        const n = [];
        for (const {target: e, contentRect: s} of t) {
            if (!e.offsetParent) continue;
            const t = r.get(e);
            t != u && n.push([ t, s[o] ]);
        }
        n.length && e.B(3, n);
    });
    let i;
    return {
        G(t) {
            const o = T(R(t)), r = () => {
                e.B(4, o[n]);
            };
            o.addEventListener("resize", r), m(r), i = () => {
                o.removeEventListener("resize", r);
            };
        },
        U: (e, t) => (r.set(e, t), s.j(e), () => {
            r.delete(e), s.D(e);
        }),
        v() {
            i && i(), s.A();
        }
    };
}, Y = (e, t) => {
    let o;
    const n = new WeakMap, r = new Set, s = new Set, i = new Map, l = (e, t) => `${e}-${t}`, c = P(c => {
        const f = new Set, u = new Set;
        for (const {target: r, contentRect: {width: s, height: d}} of c) if (r.offsetParent) if (r === o) e.B(4, d), 
        t.B(4, s); else {
            const e = n.get(r);
            if (e) {
                const [t, o] = e, n = l(t, o), r = i.get(n);
                let c, a;
                r ? (r[0] !== d && (c = !0), r[1] !== s && (a = !0)) : c = a = !0, c && f.add(t), 
                a && u.add(o), (c || a) && i.set(n, [ d, s ]);
            }
        }
        if (f.size) {
            const t = [];
            f.forEach(e => {
                let o = 0;
                s.forEach(t => {
                    const n = i.get(l(e, t));
                    n && (o = a(o, n[0]));
                }), o && t.push([ e, o ]);
            }), e.B(3, t);
        }
        if (u.size) {
            const e = [];
            u.forEach(t => {
                let o = 0;
                r.forEach(e => {
                    const n = i.get(l(e, t));
                    n && (o = a(o, n[1]));
                }), o && e.push([ t, o ]);
            }), t.B(3, e);
        }
    });
    return {
        G(e) {
            c.j(o = e);
        },
        U: (e, t, o) => (n.set(e, [ t, o ]), r.add(t), s.add(o), c.j(e), () => {
            n.delete(e), c.D(e);
        }),
        F(o) {
            for (const [t] of o) for (let o = 0; o < e.T(); o++) i.delete(l(o, t));
            t.B(3, o);
        },
        K(o) {
            for (const [e] of o) for (let o = 0; o < t.T(); o++) i.delete(l(e, o));
            e.B(3, o);
        },
        v: c.A
    };
}, q = I ? t : o, j = "current", D = (e, t) => {
    if (Array.isArray(e)) for (const o of e) D(o, t); else null == e || "boolean" == typeof e || t.push(e);
}, G = (e, t) => {
    const o = e.key;
    return null != o ? o : "_" + t;
}, U = e => {
    const t = n(null);
    return t[j] || (t[j] = e());
}, F = e => {
    const t = n(e);
    return q(() => {
        t[j] = e;
    }, [ e ]), t;
}, K = /*#__PURE__*/ r(({Z: t, ee: o, te: r, oe: i, ne: l, re: c, se: f, ie: u}) => {
    const d = n(null);
    q(() => o(d[j], r), [ r ]);
    const a = s(() => {
        const e = {
            contain: "layout style",
            position: l && u ? void 0 : "absolute",
            [f ? "height" : "width"]: "100%",
            [f ? "top" : "left"]: 0,
            [f ? "left" : "top"]: i,
            visibility: !l || u ? void 0 : "hidden"
        };
        return f && (e.display = "inline-flex"), e;
    }, [ i, l, u, f ]);
    return e(c, "string" == typeof c ? {
        ref: d,
        style: a,
        children: t
    } : {
        ref: d,
        style: a,
        index: r,
        children: t
    });
}), Q = (e, t) => s(() => {
    if ("function" == typeof e) return [ o => e(t[o], o), t.length ];
    const o = (e => {
        const t = [];
        return D(e, t), t;
    })(e);
    return [ e => o[e], o.length ];
}, [ e, t ]), Z = /*#__PURE__*/ i(({children: t, data: o, bufferSize: r, itemSize: s, shift: i, horizontal: u, keepMounted: d, cache: a, startMargin: h = 0, ssrCount: g, as: p = "div", item: _ = "div", scrollRef: w, onScroll: S, onScrollEnd: $}, z) => {
    const [b, y] = Q(t, o), x = n(null), I = n(!!g), k = F(S), R = F($), [T, C, M, H] = U(() => {
        const e = !!u, t = E(y, s, g, a, !s);
        return [ t, V(t, e), A(t, e), e ];
    });
    y !== T.T() && T.B(5, [ y, i ]), h !== T.O() && T.B(6, h);
    const [W, B] = l(T.m, void 0, T.m), J = T.M(), L = T.h(), N = M.P(), P = [], X = t => {
        const o = b(t);
        return e(K, {
            ee: C.U,
            te: t,
            oe: T.k(t, N),
            ne: T.I(t),
            re: _,
            Z: o,
            se: H,
            ie: I[j]
        }, G(o, t));
    };
    if (q(() => {
        I[j] = !1, T.W(1, e => {
            e ? f(B) : B();
        }), T.W(4, () => {
            k[j] && k[j](T.C());
        }), T.W(8, () => {
            R[j] && R[j]();
        });
        const e = x[j], t = t => {
            C.G(t), M.N(e, t);
        };
        return w ? m(() => {
            w[j] && t(w[j]);
        }) : t(e.parentElement), () => {
            T.v(), C.v(), M.v();
        };
    }, []), q(() => {
        M.q();
    }, [ W ]), c(z, () => ({
        get cache() {
            return T._();
        },
        get scrollOffset() {
            return T.C();
        },
        get scrollSize() {
            return O(T);
        },
        get viewportSize() {
            return T.p();
        },
        findItemIndex: T.$,
        getItemOffset: T.k,
        getItemSize: T.R,
        scrollToIndex: M.Y,
        scrollTo: M.V,
        scrollBy: M.X
    }), []), d) {
        const e = new Set(d);
        for (let [t, o] = T.S(r); t <= o; t++) e.add(t);
        v([ ...e ]).forEach(e => {
            P.push(X(e));
        });
    } else for (let [e, t] = T.S(r); e <= t; e++) P.push(X(e));
    return e(p, {
        ref: x,
        style: {
            contain: "size style",
            overflowAnchor: "none",
            flex: "none",
            position: "relative",
            width: H ? L : "100%",
            height: H ? "100%" : L,
            pointerEvents: J ? "none" : void 0
        },
        children: P
    });
}), ee = /*#__PURE__*/ i(({children: t, data: o, bufferSize: n, itemSize: r, shift: s, horizontal: i, keepMounted: l, cache: c, ssrCount: f, item: u, onScroll: d, onScrollEnd: a, style: h, ...g}, p) => e("div", {
    ...g,
    style: {
        display: i ? "inline-block" : "block",
        [i ? "overflowX" : "overflowY"]: "auto",
        contain: "strict",
        width: "100%",
        height: "100%",
        ...h
    },
    children: e(Z, {
        ref: p,
        data: o,
        bufferSize: n,
        itemSize: r,
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
})), te = /*#__PURE__*/ i(({children: t, data: o, bufferSize: r, itemSize: s, shift: i, horizontal: u, cache: d, ssrCount: a, as: h = "div", item: g = "div", onScroll: p, onScrollEnd: v}, m) => {
    const [_, w] = Q(t, o), S = n(null), $ = F(p), z = F(v), b = n(!!a), [y, x, I, k] = U(() => {
        const e = !!u, t = E(w, s, a, d, !s);
        return [ t, X(t, e), L(t, e), e ];
    });
    w !== y.T() && y.B(5, [ w, i ]);
    const [R, T] = l(y.m, void 0, y.m), C = y.M(), M = y.h(), O = I.P(), H = [];
    q(() => {
        b[j] = !1, y.W(1, e => {
            e ? f(T) : T();
        }), y.W(4, () => {
            $[j] && $[j]();
        }), y.W(8, () => {
            z[j] && z[j]();
        });
        const e = S[j];
        return x.G(e), I.N(e), () => {
            y.v(), x.v(), I.v();
        };
    }, []), q(() => {
        I.q();
    }, [ R ]), c(m, () => ({
        get cache() {
            return y._();
        },
        get scrollOffset() {
            return y.C();
        },
        get viewportSize() {
            return y.p();
        },
        findItemIndex: y.$,
        getItemOffset: y.k,
        getItemSize: y.R,
        scrollToIndex: I.Y
    }), []);
    for (let [t, o] = y.S(r); t <= o; t++) {
        const o = _(t);
        H.push(e(K, {
            ee: x.U,
            te: t,
            oe: y.k(t, O),
            ne: y.I(t),
            re: g,
            Z: o,
            se: k,
            ie: b[j]
        }, G(o, t)));
    }
    return e(h, {
        ref: S,
        style: {
            contain: "size style",
            overflowAnchor: "none",
            flex: "none",
            position: "relative",
            width: k ? M : "100%",
            height: k ? "100%" : M,
            pointerEvents: C ? "none" : void 0
        },
        children: H
    });
}), oe = (e, t) => `${e}-${t}`, ne = /*#__PURE__*/ r(({Z: t, ee: o, le: r, ce: i, fe: l, ue: c, de: f, ae: u, ne: d, he: a}) => {
    const h = n(null);
    return q(() => o.U(h[j], r, i), [ i, r ]), e(a, {
        ref: h,
        style: s(() => ({
            contain: "layout style",
            display: "grid",
            position: "absolute",
            top: l,
            left: c,
            visibility: d ? "hidden" : void 0,
            minHeight: f,
            minWidth: u
        }), [ l, c, u, f, d ]),
        children: t
    });
}), re = /*#__PURE__*/ i(({children: t, row: o, col: r, cellHeight: i = 40, cellWidth: u = 100, bufferSize: d, ssrRowCount: a, ssrColCount: h, item: g = "div", domRef: p, onScroll: v, onScrollEnd: m, style: _, ...w}, S) => {
    const [$, z, b, y] = U(() => {
        const e = E(o, i, a), t = E(r, u, h);
        return [ e, t, Y(e, t), N(e, t) ];
    });
    o !== $.T() && $.B(5, [ o ]), r !== z.T() && z.B(5, [ r ]);
    const [x, I] = l($.m, void 0, $.m), [k, R] = l(z.m, void 0, z.m), T = $.M(), C = z.M(), M = O($), H = O(z), W = n(null), B = F(v), J = F(m);
    q(() => {
        $.W(1, e => {
            e ? f(I) : I();
        }), z.W(1, e => {
            e ? f(R) : R();
        }), $.W(4, () => {
            B[j] && B[j]($.C());
        }), $.W(8, () => {
            J[j] && J[j]();
        });
        const e = W[j], t = e.parentElement;
        return b.G(t), y.N(e, t), () => {
            $.v(), z.v(), b.v(), y.v();
        };
    }, []), q(() => {
        y.q();
    }, [ x, k ]), c(S, () => ({
        get scrollTop() {
            return $.C();
        },
        get scrollLeft() {
            return z.C();
        },
        get scrollHeight() {
            return O($);
        },
        get scrollWidth() {
            return O(z);
        },
        get viewportHeight() {
            return $.p();
        },
        get viewportWidth() {
            return z.p();
        },
        findRowIndex: $.$,
        findColIndex: z.$,
        getRowOffset: $.k,
        getColOffset: z.k,
        getRowSize: $.R,
        getColSize: z.R,
        resizeCols(e) {
            b.F(e);
        },
        resizeRows(e) {
            b.K(e);
        },
        scrollToIndex: y.Y,
        scrollTo: y.V,
        scrollBy: y.X
    }), []);
    const A = s(() => {
        const e = new Map;
        return (o, n) => {
            let r = e.get(oe(o, n));
            return r || e.set(oe(o, n), r = t({
                rowIndex: o,
                colIndex: n
            })), r;
        };
    }, [ t ]), L = y.P(), [P, V] = $.S(d), [X, D] = z.S(d), G = [];
    for (let t = P; t <= V; t++) for (let o = X; o <= D; o++) G.push(e(ne, {
        ee: b,
        le: t,
        ce: o,
        fe: $.k(t),
        ue: z.k(o, L),
        de: $.R(t),
        ae: z.R(o),
        ne: $.I(t) || z.I(o),
        he: g,
        Z: A(t, o)
    }, oe(t, o)));
    return e("div", {
        ref: p,
        ...w,
        style: {
            overflow: "auto",
            contain: "strict",
            width: "100%",
            height: "100%",
            ..._
        },
        children: e("div", {
            ref: W,
            style: {
                contain: "size style",
                overflowAnchor: "none",
                flex: "none",
                position: "relative",
                width: H,
                height: M,
                pointerEvents: T || C ? "none" : void 0
            },
            children: G
        })
    });
});

export { ee as VList, Z as Virtualizer, te as WindowVirtualizer, re as experimental_VGrid };
//# sourceMappingURL=index.js.map
