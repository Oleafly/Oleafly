import e, { forwardRef as t, useCallback as n, useEffect as r, useImperativeHandle as i, useRef as a, useState as o } from "react";
//#region ../core/src/utils/drawRoundedRect.ts
var s = (e, t, n, r, i, a) => {
	if (a === 0) e.rect(t, n, r, i);
	else {
		let o = r - a, s = i - a;
		e.translate(t, n), e.arc(a, a, a, Math.PI, Math.PI * 1.5), e.lineTo(o, 0), e.arc(o, a, a, Math.PI * 1.5, Math.PI * 2), e.lineTo(r, s), e.arc(o, s, a, Math.PI * 2, Math.PI * .5), e.lineTo(a, i), e.arc(a, s, a, Math.PI * .5, Math.PI), e.closePath(), e.translate(-t, -n);
	}
}, c = (e, t, n, r, i, a) => {
	e.fillStyle = a;
	let o = r / 3, s = i / 3;
	e.fillRect(t, n, 1, i), e.fillRect(o + t, n, 1, i), e.fillRect(o * 2 + t, n, 1, i), e.fillRect(o * 3 + t, n, 1, i), e.fillRect(o * 4 + t, n, 1, i), e.fillRect(t, n, r, 1), e.fillRect(t, s + n, r, 1), e.fillRect(t, s * 2 + n, r, 1), e.fillRect(t, s * 3 + n, r, 1), e.fillRect(t, s * 4 + n, r, 1);
}, l = (e) => !!e.match(/^\s*data:([a-z]+\/[a-z]+(;[a-z-]+=[a-z-]+)?)?(;base64)?,[a-z0-9!$&',()*+;=\-._~:@/?%\s]*\s*$/i), u = (e, t) => new Promise((n, r) => {
	let i = new Image();
	i.addEventListener("load", () => n(i)), i.addEventListener("error", r), !l(e) && t && (i.crossOrigin = t), i.src = e;
}), d = (e) => new Promise((t, n) => {
	let r = new FileReader();
	r.addEventListener("load", (e) => {
		try {
			if (!e?.target?.result) throw Error("No image data");
			t(u(e.target.result));
		} catch (e) {
			n(e);
		}
	}), r.readAsDataURL(e);
}), f = typeof File < "u", p = (e) => Math.PI / 180 * e, m = {
	x: .5,
	y: .5
}, h = class {
	constructor(e) {
		this.imageState = m, this.config = {
			border: 25,
			borderRadius: 0,
			scale: 1,
			rotate: 0,
			color: [
				0,
				0,
				0,
				.5
			],
			backgroundColor: "",
			borderColor: void 0,
			showGrid: !1,
			gridColor: "#666",
			disableBoundaryChecks: !1,
			disableHiDPIScaling: !1,
			disableCanvasRotation: !0,
			crossOrigin: void 0,
			...e
		}, this.pixelRatio = typeof window < "u" && window.devicePixelRatio && !this.config.disableHiDPIScaling ? window.devicePixelRatio : 1;
	}
	getPixelRatio() {
		return this.pixelRatio;
	}
	getImageState() {
		return this.imageState;
	}
	setImageState(e) {
		this.imageState = e;
	}
	updateConfig(e) {
		this.config = {
			...this.config,
			...e
		};
	}
	isVertical() {
		return !this.config.disableCanvasRotation && this.config.rotate % 180 != 0;
	}
	getBorders(e) {
		let t = e ?? this.config.border;
		return Array.isArray(t) ? t : [t, t];
	}
	getDimensions() {
		let { width: e, height: t, rotate: n, border: r } = this.config, i = {
			width: 0,
			height: 0
		}, [a, o] = this.getBorders(r);
		return this.isVertical() ? (i.width = t, i.height = e) : (i.width = e, i.height = t), i.width += a * 2, i.height += o * 2, {
			canvas: i,
			rotate: n,
			width: e,
			height: t,
			border: r
		};
	}
	getXScale() {
		if (!this.imageState.width || !this.imageState.height) throw Error("Image dimension is unknown.");
		let e = this.config.width / this.config.height, t = this.imageState.width / this.imageState.height;
		return Math.min(1, e / t);
	}
	getYScale() {
		if (!this.imageState.width || !this.imageState.height) throw Error("Image dimension is unknown.");
		let e = this.config.height / this.config.width, t = this.imageState.height / this.imageState.width;
		return Math.min(1, e / t);
	}
	getCroppingRect(e) {
		if (!this.imageState.width || !this.imageState.height) return {
			x: 0,
			y: 0,
			width: 1,
			height: 1
		};
		let t = e || {
			x: this.imageState.x,
			y: this.imageState.y
		}, n = 1 / this.config.scale * this.getXScale(), r = 1 / this.config.scale * this.getYScale(), i = {
			x: t.x - n / 2,
			y: t.y - r / 2,
			width: n,
			height: r
		}, a = 0, o = 1 - i.width, s = 0, c = 1 - i.height;
		return (this.config.disableBoundaryChecks || n > 1 || r > 1) && (a = -i.width, o = 1, s = -i.height, c = 1), {
			...i,
			x: Math.max(a, Math.min(i.x, o)),
			y: Math.max(s, Math.min(i.y, c))
		};
	}
	getInitialSize(e, t) {
		let n, r, i = this.getDimensions();
		return i.height / i.width > t / e ? (n = i.height, r = n / t * e) : (r = i.width, n = r / e * t), {
			height: n,
			width: r
		};
	}
	async loadImage(e) {
		let t;
		if (f && e instanceof File) t = await d(e);
		else if (typeof e == "string") t = await u(e, this.config.crossOrigin);
		else throw Error("Invalid image source");
		let n = {
			...this.getInitialSize(t.width, t.height),
			resource: t,
			x: .5,
			y: .5
		};
		return this.imageState = n, n;
	}
	clearImage() {
		this.imageState = m;
	}
	calculatePosition(e = this.imageState, t) {
		let [n, r] = this.getBorders(t);
		if (!e.width || !e.height) throw Error("Image dimension is unknown.");
		let i = this.getCroppingRect(), a = e.width * this.config.scale, o = e.height * this.config.scale, s = -i.x * a, c = -i.y * o;
		return this.isVertical() ? (s += r, c += n) : (s += n, c += r), {
			x: s,
			y: c,
			height: o,
			width: a
		};
	}
	paint(e) {
		e.save(), e.scale(this.pixelRatio, this.pixelRatio), e.translate(0, 0), e.fillStyle = "rgba(" + this.config.color.slice(0, 4).join(",") + ")";
		let t = this.config.borderRadius, n = this.getDimensions(), [r, i] = this.getBorders(n.border), a = n.canvas.height, o = n.canvas.width;
		t = Math.max(t, 0), t = Math.min(t, o / 2 - r, a / 2 - i), e.beginPath(), s(e, r, i, o - r * 2, a - i * 2, t), e.rect(o, 0, -o, a), e.fill("evenodd"), this.config.borderColor && (e.strokeStyle = "rgba(" + this.config.borderColor.slice(0, 4).join(",") + ")", e.lineWidth = 1, e.beginPath(), s(e, r + .5, i + .5, o - r * 2 - 1, a - i * 2 - 1, t), e.stroke()), this.config.showGrid && c(e, r, i, o - r * 2, a - i * 2, this.config.gridColor), e.restore();
	}
	paintImage(e, t, n, r = this.pixelRatio) {
		if (!t.resource) return;
		let i = this.calculatePosition(t, n);
		e.save(), e.translate(e.canvas.width / 2, e.canvas.height / 2), e.rotate(this.config.rotate * Math.PI / 180), e.translate(-(e.canvas.width / 2), -(e.canvas.height / 2)), this.isVertical() && e.translate((e.canvas.width - e.canvas.height) / 2, (e.canvas.height - e.canvas.width) / 2), e.scale(r, r), e.globalCompositeOperation = "destination-over", e.drawImage(t.resource, i.x, i.y, i.width, i.height), this.config.backgroundColor && (e.fillStyle = this.config.backgroundColor, e.fillRect(0, 0, e.canvas.width, e.canvas.height)), e.restore();
	}
	getImage() {
		let e = this.getCroppingRect(), t = this.imageState;
		if (!t.resource) throw Error("No image resource available, please report this to: https://github.com/mosch/react-avatar-editor/issues");
		e.x *= t.resource.width, e.y *= t.resource.height, e.width *= t.resource.width, e.height *= t.resource.height;
		let n = document.createElement("canvas");
		this.isVertical() ? (n.width = Math.round(e.height), n.height = Math.round(e.width)) : (n.width = Math.round(e.width), n.height = Math.round(e.height));
		let r = n.getContext("2d");
		if (!r) throw Error("No context found, please report this to: https://github.com/mosch/react-avatar-editor/issues");
		return r.translate(n.width / 2, n.height / 2), r.rotate(this.config.rotate * Math.PI / 180), r.translate(-(n.width / 2), -(n.height / 2)), this.isVertical() && r.translate((n.width - n.height) / 2, (n.height - n.width) / 2), this.config.backgroundColor && (r.fillStyle = this.config.backgroundColor, r.fillRect(0, 0, n.width, n.height)), r.drawImage(t.resource, -e.x, -e.y), n;
	}
	getImageScaledToCanvas() {
		let e = this.getDimensions(), t = this.imageState, n = document.createElement("canvas");
		if (this.isVertical() ? (n.width = e.height, n.height = e.width) : (n.width = e.width, n.height = e.height), !t.resource) return n;
		let r = n.getContext("2d");
		if (!r) return n;
		let i = this.calculatePosition(t, 0);
		return r.save(), r.translate(n.width / 2, n.height / 2), r.rotate(this.config.rotate * Math.PI / 180), r.translate(-(n.width / 2), -(n.height / 2)), this.isVertical() && r.translate((n.width - n.height) / 2, (n.height - n.width) / 2), this.config.backgroundColor && (r.fillStyle = this.config.backgroundColor, r.fillRect(0, 0, n.width, n.height)), r.drawImage(t.resource, i.x, i.y, i.width, i.height), r.restore(), n;
	}
	calculateDragPosition(e, t, n, r) {
		let i = n - e, a = r - t;
		if (!this.imageState.width || !this.imageState.height) throw Error("Image dimension is unknown.");
		let o = this.imageState.width * this.config.scale, s = this.imageState.height * this.config.scale, { x: c, y: l } = this.getCroppingRect();
		c *= o, l *= s;
		let u = this.config.rotate;
		u %= 360, u = u < 0 ? u + 360 : u;
		let d = Math.cos(p(u)), f = Math.sin(p(u)), m = c + i * d + a * f, h = l + -i * f + a * d, g = 1 / this.config.scale * this.getXScale(), _ = 1 / this.config.scale * this.getYScale();
		return {
			x: m / o + g / 2,
			y: h / s + _ / 2
		};
	}
}, g = () => {}, _ = () => {
	let e = !1;
	try {
		let t = Object.defineProperty({}, "passive", { get: function() {
			e = !0;
		} });
		window.addEventListener("test", g, t), window.removeEventListener("test", g, t);
	} catch {
		e = !1;
	}
	return e;
}, v = t((t, s) => {
	let { scale: c = 1, rotate: l = 0, border: u = 25, borderRadius: d = 0, width: f = 200, height: p = 200, color: m = [
		0,
		0,
		0,
		.5
	], showGrid: g = !1, gridColor: v = "#666", disableBoundaryChecks: y = !1, disableHiDPIScaling: b = !1, disableCanvasRotation: x = !0, image: S, position: C, backgroundColor: w, crossOrigin: T, onLoadStart: E, onLoadFailure: D, onLoadSuccess: O, onImageReady: k, onImageChange: A, onMouseUp: j, onMouseMove: M, onPositionChange: N, borderColor: P, style: ee } = t, F = a(null), I = a(new h({
		width: f,
		height: p,
		border: u,
		borderRadius: d,
		scale: c,
		rotate: l,
		color: m,
		backgroundColor: w,
		borderColor: P,
		showGrid: g,
		gridColor: v,
		disableBoundaryChecks: y,
		disableHiDPIScaling: b,
		disableCanvasRotation: x,
		crossOrigin: T
	})), L = a(!1), R = a(void 0), z = a(void 0), [te, B] = o(!1), [V, H] = o(!1), [U, W] = o(I.current.getImageState()), G = a(j);
	G.current = j;
	let K = a(M);
	K.current = M;
	let q = a(N);
	q.current = N, r(() => {
		I.current.updateConfig({
			width: f,
			height: p,
			border: u,
			borderRadius: d,
			scale: c,
			rotate: l,
			color: m,
			backgroundColor: w,
			borderColor: P,
			showGrid: g,
			gridColor: v,
			disableBoundaryChecks: y,
			disableHiDPIScaling: b,
			disableCanvasRotation: x,
			crossOrigin: T
		});
	}, [
		f,
		p,
		u,
		d,
		c,
		l,
		m,
		w,
		P,
		g,
		v,
		y,
		b,
		x,
		T
	]);
	let J = n(() => {
		if (!F.current) throw Error("No canvas found, please report this to: https://github.com/mosch/react-avatar-editor/issues");
		return F.current;
	}, []), Y = n(() => {
		let e = J().getContext("2d");
		if (!e) throw Error("No context found, please report this to: https://github.com/mosch/react-avatar-editor/issues");
		return e;
	}, [J]), X = n(async (e) => {
		H(!0), E?.();
		try {
			let t = await I.current.loadImage(e);
			L.current = !1, B(!1), W(t), k?.(), O?.(t);
		} catch {
			D?.();
		} finally {
			H(!1);
		}
	}, [
		E,
		k,
		O,
		D
	]), ne = n(() => {
		let e = J();
		Y().clearRect(0, 0, e.width, e.height), I.current.clearImage(), W(I.current.getImageState());
	}, [J, Y]), Z = n(() => {
		let e = Y(), t = J();
		e.clearRect(0, 0, t.width, t.height), I.current.paint(e), I.current.paintImage(e, U, u);
	}, [
		Y,
		J,
		U,
		u,
		f,
		p,
		d,
		c,
		l,
		m,
		w,
		P,
		g,
		v,
		y,
		b,
		x,
		T
	]), re = n((e) => {
		e.preventDefault(), L.current = !0, R.current = void 0, z.current = void 0, B(!0);
	}, []), ie = n(() => {
		L.current = !0, R.current = void 0, z.current = void 0, B(!0);
	}, []);
	i(s, () => ({
		getImage: () => I.current.getImage(),
		getImageScaledToCanvas: () => I.current.getImageScaledToCanvas(),
		getCroppingRect: () => I.current.getCroppingRect()
	}), []), r(() => {
		let e = Y();
		S && X(S), I.current.paint(e);
		let t = (e) => {
			if (!L.current) return;
			e.cancelable && e.preventDefault();
			let t = "targetTouches" in e ? e.targetTouches[0].pageX : e.clientX, n = "targetTouches" in e ? e.targetTouches[0].pageY : e.clientY, r = R.current, i = z.current;
			if (R.current = t, z.current = n, r !== void 0 && i !== void 0) {
				let e = I.current.getImageState();
				if (e.width && e.height) {
					let a = I.current.calculateDragPosition(t, n, r, i);
					q.current?.(a);
					let o = {
						...e,
						...a
					};
					I.current.setImageState(o), W(o);
				}
			}
			K.current?.(e);
		}, n = () => {
			L.current && (L.current = !1, B(!1), G.current?.());
		}, r = _() ? { passive: !1 } : !1;
		return document.addEventListener("mousemove", t, r), document.addEventListener("mouseup", n, r), document.addEventListener("touchmove", t, r), document.addEventListener("touchend", n, r), () => {
			document.removeEventListener("mousemove", t, !1), document.removeEventListener("mouseup", n, !1), document.removeEventListener("touchmove", t, !1), document.removeEventListener("touchend", n, !1);
		};
	}, []), r(() => {
		S ? X(S) : !S && U.x !== .5 && U.y !== .5 && ne();
	}, [
		S,
		f,
		p,
		w
	]), r(() => {
		Z();
	}, [Z]), r(() => {
		if (!V) return;
		let e = F.current;
		if (!e) return;
		let t = e.getContext("2d");
		if (!t) return;
		let n, r = performance.now(), i = (a) => {
			let o = (a - r) / 1e3, s = .03 + Math.sin(o * 2.5) * .02 + .02;
			t.save(), t.clearRect(0, 0, e.width, e.height), t.fillStyle = `rgba(255,255,255,${s})`, t.fillRect(0, 0, e.width, e.height), t.restore(), n = requestAnimationFrame(i);
		};
		return n = requestAnimationFrame(i), () => cancelAnimationFrame(n);
	}, [V]);
	let Q = a({
		image: S,
		width: f,
		height: p,
		position: C,
		scale: c,
		rotate: l,
		imageX: U.x,
		imageY: U.y
	});
	r(() => {
		let e = Q.current;
		(e.image !== S || e.width !== f || e.height !== p || e.position !== C || e.scale !== c || e.rotate !== l || e.imageX !== U.x || e.imageY !== U.y) && (A?.(), Q.current = {
			image: S,
			width: f,
			height: p,
			position: C,
			scale: c,
			rotate: l,
			imageX: U.x,
			imageY: U.y
		});
	}, [
		S,
		f,
		p,
		C,
		c,
		l,
		U.x,
		U.y,
		A
	]);
	let $ = I.current.getDimensions(), ae = I.current.getPixelRatio(), oe = {
		width: $.canvas.width,
		height: $.canvas.height,
		cursor: te ? "grabbing" : "grab",
		touchAction: "none",
		maxWidth: "none",
		maxHeight: "none"
	};
	return e.createElement("canvas", {
		width: $.canvas.width * ae,
		height: $.canvas.height * ae,
		onMouseDown: re,
		onTouchStart: ie,
		style: {
			...oe,
			...ee
		},
		ref: F
	});
});
v.displayName = "AvatarEditor";
function y() {
	let e = a(null);
	return {
		ref: e,
		getImage: () => {
			try {
				return e.current?.getImage() ?? null;
			} catch {
				return null;
			}
		},
		getImageScaledToCanvas: () => {
			try {
				return e.current?.getImageScaledToCanvas() ?? null;
			} catch {
				return null;
			}
		},
		getCroppingRect: () => e.current?.getCroppingRect() ?? null
	};
}
//#endregion
export { v as default, y as useAvatarEditor };

//# sourceMappingURL=index.mjs.map