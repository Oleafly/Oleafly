import { createThemeResolver } from "./createThemeResolver.js";
//#region src/modules/createThemeController.ts
const FALLBACK_LIGHT_THEME = "pierre-light";
const FALLBACK_DARK_THEME = "pierre-dark";
function getStorage() {
	try {
		if (typeof globalThis !== "undefined" && globalThis.localStorage != null) return globalThis.localStorage;
	} catch {}
}
function createLocalStorageAdapter(storageKey, defaults) {
	return {
		load() {
			const raw = getStorage()?.getItem(storageKey);
			if (raw == null) return null;
			try {
				const parsed = JSON.parse(raw);
				if (parsed.mode == null) return null;
				return {
					darkThemeName: parsed.darkThemeName ?? defaults.darkThemeName,
					lightThemeName: parsed.lightThemeName ?? defaults.lightThemeName,
					mode: parsed.mode
				};
			} catch {
				return null;
			}
		},
		save(selection) {
			const storage = getStorage();
			try {
				storage?.setItem(storageKey, JSON.stringify(selection));
			} catch {}
		}
	};
}
function systemPrefersDark() {
	try {
		if (typeof globalThis !== "undefined" && globalThis.matchMedia != null) return globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
	} catch {}
	return false;
}
function resolveColorScheme(mode) {
	if (mode === "dark") return "dark";
	if (mode === "light") return "light";
	return systemPrefersDark() ? "dark" : "light";
}
function createThemeController(options) {
	const { storageKey, preloadInactive = false } = options;
	const catalog = "catalog" in options && options.catalog != null ? options.catalog : void 0;
	const selectedResolver = options.resolver ?? (catalog != null ? createThemeResolver() : void 0);
	if (selectedResolver == null) throw new Error("createThemeController requires a catalog or resolver");
	const resolver = selectedResolver;
	catalog?.registerInto(resolver);
	const defaultDarkThemeName = options.defaultDarkThemeName ?? catalog?.defaultDarkThemeName ?? FALLBACK_DARK_THEME;
	const defaultLightThemeName = options.defaultLightThemeName ?? catalog?.defaultLightThemeName ?? FALLBACK_LIGHT_THEME;
	const persistence = options.persistence ?? (storageKey != null ? createLocalStorageAdapter(storageKey, {
		darkThemeName: defaultDarkThemeName,
		lightThemeName: defaultLightThemeName
	}) : void 0);
	const initialMode = options.defaultMode ?? "system";
	let state = {
		darkThemeName: defaultDarkThemeName,
		lightThemeName: defaultLightThemeName,
		mode: initialMode,
		resolvedTheme: void 0,
		resolvedColorScheme: resolveColorScheme(initialMode)
	};
	const listeners = /* @__PURE__ */ new Set();
	let activeResolutionId = 0;
	let pendingSelectionPatch;
	function notify() {
		for (const listener of listeners) listener();
	}
	function hydrateFromStorage() {
		const loaded = persistence?.load();
		if (loaded == null) return;
		state = {
			...state,
			darkThemeName: loaded.darkThemeName,
			lightThemeName: loaded.lightThemeName,
			mode: loaded.mode,
			resolvedColorScheme: resolveColorScheme(loaded.mode)
		};
	}
	function persist() {
		persistence?.save({
			darkThemeName: state.darkThemeName,
			lightThemeName: state.lightThemeName,
			mode: state.mode
		});
	}
	function activeThemeNameFor(selection) {
		return selection.resolvedColorScheme === "dark" ? selection.darkThemeName : selection.lightThemeName;
	}
	function intendedState(patch = {}) {
		return {
			...state,
			...pendingSelectionPatch,
			...patch
		};
	}
	function reportResolutionError(error, context) {
		if (options.onResolutionError != null) {
			options.onResolutionError(error, context);
			return;
		}
		console.error(`[theming] Failed to resolve theme "${context.name}" for ${context.colorScheme} color scheme`, error);
	}
	function preloadInactiveFor(selection) {
		if (!preloadInactive) return;
		const activeName = activeThemeNameFor(selection);
		const inactive = selection.resolvedColorScheme === "dark" ? selection.lightThemeName : selection.darkThemeName;
		if (inactive !== activeName && resolver.getResolvedTheme(inactive) === void 0) resolver.resolveTheme(inactive).catch(() => {});
	}
	function resolveActive(patch = {}, { notifyPending = false, persistOnSuccess = false } = {}) {
		const selectionPatch = {
			...pendingSelectionPatch,
			...patch
		};
		const next = intendedState(patch);
		const name = activeThemeNameFor(next);
		const colorScheme = next.resolvedColorScheme;
		const cached = resolver.getResolvedTheme(name);
		if (cached !== void 0) {
			activeResolutionId++;
			pendingSelectionPatch = void 0;
			state = {
				...state,
				...selectionPatch,
				pendingThemeResolution: void 0,
				resolutionError: void 0,
				resolvedTheme: cached
			};
			if (persistOnSuccess) persist();
			notify();
			preloadInactiveFor(state);
			return;
		}
		const resolutionId = ++activeResolutionId;
		pendingSelectionPatch = selectionPatch;
		state = {
			...state,
			pendingThemeResolution: {
				colorScheme,
				name
			},
			resolutionError: void 0
		};
		if (notifyPending) notify();
		resolver.resolveTheme(name).then((theme) => {
			if (resolutionId !== activeResolutionId) return;
			const latestIntended = intendedState();
			if (latestIntended.resolvedColorScheme !== colorScheme || activeThemeNameFor(latestIntended) !== name) return;
			const patchToCommit = pendingSelectionPatch ?? {};
			pendingSelectionPatch = void 0;
			state = {
				...state,
				...patchToCommit,
				pendingThemeResolution: void 0,
				resolutionError: void 0,
				resolvedTheme: theme
			};
			if (persistOnSuccess) persist();
			notify();
			preloadInactiveFor(state);
		}).catch((error) => {
			if (resolutionId !== activeResolutionId) return;
			pendingSelectionPatch = void 0;
			state = {
				...state,
				pendingThemeResolution: void 0,
				resolutionError: {
					colorScheme,
					error,
					name
				}
			};
			reportResolutionError(error, {
				colorScheme,
				name
			});
			notify();
		});
	}
	function updateInactiveThemeName(key, name) {
		state = {
			...state,
			[key]: name,
			resolutionError: void 0
		};
		persist();
		notify();
		preloadInactiveFor(state);
	}
	function isSchemeActiveInIntendedState(scheme, patch = {}) {
		return intendedState(patch).resolvedColorScheme === scheme;
	}
	function setActiveSelection(patch) {
		resolveActive(patch, {
			notifyPending: true,
			persistOnSuccess: true
		});
	}
	function setInactiveThemeName(scheme, key, name) {
		if (isSchemeActiveInIntendedState(scheme, { [key]: name })) setActiveSelection({ [key]: name });
		else updateInactiveThemeName(key, name);
	}
	function setMode(mode) {
		setActiveSelection({
			mode,
			resolvedColorScheme: resolveColorScheme(mode)
		});
	}
	function maybeUpdateSystemColorScheme() {
		if (intendedState().mode !== "system") return;
		const next = resolveColorScheme("system");
		if (next !== intendedState().resolvedColorScheme) resolveActive({ resolvedColorScheme: next }, { notifyPending: true });
	}
	function isSelectedValue(key, value) {
		return intendedState()[key] === value;
	}
	let mediaQuery;
	const handleMediaChange = () => {
		maybeUpdateSystemColorScheme();
	};
	function attachMediaListener() {
		try {
			if (typeof globalThis !== "undefined" && globalThis.matchMedia != null) {
				mediaQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");
				mediaQuery.addEventListener("change", handleMediaChange);
			}
		} catch {}
	}
	hydrateFromStorage();
	attachMediaListener();
	resolveActive();
	return {
		resolver,
		destroy() {
			if (mediaQuery != null) {
				mediaQuery.removeEventListener("change", handleMediaChange);
				mediaQuery = void 0;
			}
			listeners.clear();
		},
		getState() {
			return state;
		},
		setColorMode(mode) {
			if (isSelectedValue("mode", mode)) return;
			setMode(mode);
		},
		setThemeNameForScheme(scheme, name) {
			const key = scheme === "light" ? "lightThemeName" : "darkThemeName";
			if (isSelectedValue(key, name)) return;
			setInactiveThemeName(scheme, key, name);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}
//#endregion
export { createThemeController };

//# sourceMappingURL=createThemeController.js.map