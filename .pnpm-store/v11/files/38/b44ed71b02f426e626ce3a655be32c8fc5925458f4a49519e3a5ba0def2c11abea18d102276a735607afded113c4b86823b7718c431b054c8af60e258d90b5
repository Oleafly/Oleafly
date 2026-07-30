//#region src/utils/devSingleton.ts
const DEV = process.env.NODE_ENV === "development";
const GLOBAL_KEY = "__LOBE_UI_DEV_SINGLETON_REGISTRY__";
const getRegistry = () => {
	const g = globalThis;
	if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = {
		global: /* @__PURE__ */ new Map(),
		scoped: /* @__PURE__ */ new Map()
	};
	return g[GLOBAL_KEY];
};
const getScopedMap = (registry, name) => {
	const existing = registry.scoped.get(name);
	if (existing) return existing;
	const next = /* @__PURE__ */ new WeakMap();
	registry.scoped.set(name, next);
	return next;
};
const singletonError = (name) => /* @__PURE__ */ new Error(`[lobe-ui] ${name} must be rendered only once in a single React tree. You probably mounted it multiple times (or in multiple roots).`);
/**
* Dev-only singleton guard.
* - If `scope` is provided, it's enforced per scope object (e.g. portal root).
* - Otherwise it's enforced globally in the current JS runtime.
*/
const registerDevSingleton = (name, scope) => {
	if (!DEV) return () => {};
	const registry = getRegistry();
	if (scope) {
		const scoped = getScopedMap(registry, name);
		const prev = scoped.get(scope) ?? 0;
		const next = prev + 1;
		scoped.set(scope, next);
		if (next > 1) {
			if (prev === 0) scoped.delete(scope);
			else scoped.set(scope, prev);
			throw singletonError(name);
		}
		return () => {
			const after = (scoped.get(scope) ?? 0) - 1;
			if (after <= 0) scoped.delete(scope);
			else scoped.set(scope, after);
		};
	}
	const prev = registry.global.get(name) ?? 0;
	const next = prev + 1;
	registry.global.set(name, next);
	if (next > 1) {
		if (prev === 0) registry.global.delete(name);
		else registry.global.set(name, prev);
		throw singletonError(name);
	}
	return () => {
		const after = (registry.global.get(name) ?? 0) - 1;
		if (after <= 0) registry.global.delete(name);
		else registry.global.set(name, after);
	};
};
//#endregion
export { registerDevSingleton };

//# sourceMappingURL=devSingleton.mjs.map