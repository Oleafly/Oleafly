import { unwrapDefault } from "./unwrapDefault.js";
//#region src/modules/createThemeResolver.ts
var DuplicateThemeError = class extends Error {
	constructor(name) {
		super(`Theme "${name}" is already registered`);
		this.name = "DuplicateThemeError";
	}
};
var UnregisteredThemeError = class extends Error {
	constructor(name) {
		super(`No loader registered for theme "${name}"`);
		this.name = "UnregisteredThemeError";
	}
};
var UnresolvedThemeError = class extends Error {
	constructor(name) {
		super(`Theme "${name}" has not been resolved`);
		this.name = "UnresolvedThemeError";
	}
};
function createThemeResolver() {
	const loaders = /* @__PURE__ */ new Map();
	const resolved = /* @__PURE__ */ new Map();
	const inflight = /* @__PURE__ */ new Map();
	let cacheGeneration = 0;
	function registerTheme(name, loader) {
		if (loaders.has(name)) throw new DuplicateThemeError(name);
		loaders.set(name, loader);
	}
	function registerThemeIfAbsent(name, loader) {
		if (loaders.has(name)) return false;
		loaders.set(name, loader);
		return true;
	}
	function hasRegisteredTheme(name) {
		return loaders.has(name);
	}
	function resolveTheme(name) {
		const cached = resolved.get(name);
		if (cached !== void 0) return Promise.resolve(cached);
		const existing = inflight.get(name);
		if (existing !== void 0) return existing;
		const loader = loaders.get(name);
		if (loader === void 0) return Promise.reject(new UnregisteredThemeError(name));
		const generation = cacheGeneration;
		const promise = loader().then((result) => {
			const theme = unwrapDefault(result);
			if (generation === cacheGeneration) resolved.set(name, theme);
			if (inflight.get(name) === promise) inflight.delete(name);
			return theme;
		}).catch((err) => {
			if (inflight.get(name) === promise) inflight.delete(name);
			throw err;
		});
		inflight.set(name, promise);
		return promise;
	}
	function resolveThemes(names) {
		return Promise.all(names.map((name) => resolveTheme(name)));
	}
	function seedResolvedTheme(name, theme) {
		resolved.set(name, theme);
	}
	function seedResolvedThemes(entries) {
		for (const [name, theme] of entries) seedResolvedTheme(name, theme);
	}
	function getResolvedTheme(name) {
		return resolved.get(name);
	}
	function getResolvedThemes(names) {
		const themes = [];
		for (const name of names) {
			const theme = resolved.get(name);
			if (theme === void 0) throw new UnresolvedThemeError(name);
			themes.push(theme);
		}
		return themes;
	}
	function hasResolvedTheme(name) {
		return resolved.has(name);
	}
	function hasResolvedThemes(names) {
		for (const name of names) if (!resolved.has(name)) return false;
		return true;
	}
	function getResolvedOrResolveTheme(name) {
		const cached = resolved.get(name);
		if (cached !== void 0) return cached;
		return resolveTheme(name);
	}
	function clearResolvedThemes() {
		cacheGeneration++;
		resolved.clear();
		inflight.clear();
	}
	return {
		clearResolvedThemes,
		getResolvedOrResolveTheme,
		getResolvedTheme,
		getResolvedThemes,
		hasRegisteredTheme,
		hasResolvedTheme,
		hasResolvedThemes,
		registerTheme,
		registerThemeIfAbsent,
		resolveTheme,
		resolveThemes,
		seedResolvedTheme,
		seedResolvedThemes
	};
}
//#endregion
export { DuplicateThemeError, UnregisteredThemeError, UnresolvedThemeError, createThemeResolver };

//# sourceMappingURL=createThemeResolver.js.map