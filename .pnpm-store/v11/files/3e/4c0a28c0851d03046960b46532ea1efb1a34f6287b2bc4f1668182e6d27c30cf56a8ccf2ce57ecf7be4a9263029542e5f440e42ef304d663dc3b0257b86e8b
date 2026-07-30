//#region src/modules/createThemeCollection.ts
function createThemeCollection(options) {
	const descriptors = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of getCollectionEntries(options.themes)) {
		const themes = isThemeCollectionSource(entry) ? entry.getThemes() : [entry];
		for (const descriptor of themes) {
			if (seen.has(descriptor.name)) throw new Error(`Theme collection already contains theme "${descriptor.name}"`);
			seen.add(descriptor.name);
			descriptors.push(descriptor);
		}
	}
	const allThemes = Object.freeze([...descriptors]);
	const lightThemes = Object.freeze(allThemes.filter((descriptor) => descriptor.colorScheme === "light"));
	const darkThemes = Object.freeze(allThemes.filter((descriptor) => descriptor.colorScheme === "dark"));
	const themesByName = new Map(allThemes.map((descriptor) => [descriptor.name, descriptor]));
	const allNames = Object.freeze(allThemes.map((descriptor) => descriptor.name));
	const lightNames = Object.freeze(lightThemes.map((descriptor) => descriptor.name));
	const darkNames = Object.freeze(darkThemes.map((descriptor) => descriptor.name));
	function filteredThemes(filterOptions) {
		if (filterOptions == null) return allThemes;
		const { colorScheme, collection } = filterOptions;
		if (collection == null) {
			if (colorScheme === "light") return lightThemes;
			if (colorScheme === "dark") return darkThemes;
			return allThemes;
		}
		return allThemes.filter((descriptor) => {
			if (descriptor.collection !== collection) return false;
			return colorScheme == null || descriptor.colorScheme === colorScheme;
		});
	}
	return {
		getTheme(name) {
			return themesByName.get(name);
		},
		getThemes(themeOptions) {
			return filteredThemes(themeOptions);
		},
		getThemeNames(namesOptions) {
			if (namesOptions?.collection == null) {
				if (namesOptions?.colorScheme === "light") return lightNames;
				if (namesOptions?.colorScheme === "dark") return darkNames;
				return allNames;
			}
			return filteredThemes(namesOptions).map((descriptor) => descriptor.name);
		},
		hasTheme(name) {
			return themesByName.has(name);
		},
		orderBy(compare) {
			return createThemeCollection({ themes: allThemes.map((descriptor, index) => ({
				descriptor,
				index
			})).sort((a, b) => {
				const result = compare(a.descriptor, b.descriptor);
				if (result !== 0) return result;
				return a.index - b.index;
			}).map((entry) => entry.descriptor) });
		},
		pick(names) {
			const picked = [];
			const pickedNames = /* @__PURE__ */ new Set();
			for (const name of names) {
				if (pickedNames.has(name)) throw new Error(`Theme collection pick already includes theme "${name}"`);
				pickedNames.add(name);
				const descriptor = themesByName.get(name);
				if (descriptor == null) throw new Error(`Theme collection does not contain theme "${name}"`);
				picked.push(descriptor);
			}
			return createThemeCollection({ themes: picked });
		},
		registerInto(resolver) {
			for (const descriptor of allThemes) resolver.registerThemeIfAbsent(descriptor.name, descriptor.load);
		}
	};
}
function getCollectionEntries(input) {
	if (isThemeCollectionEntry(input)) return [input];
	return input;
}
function isThemeCollectionEntry(input) {
	return isThemeCollectionSource(input) || isThemeDescriptor(input);
}
function isThemeDescriptor(input) {
	return typeof input.name === "string" && typeof input.load === "function";
}
function isThemeCollectionSource(entry) {
	return typeof entry.getThemes === "function";
}
//#endregion
export { createThemeCollection };

//# sourceMappingURL=createThemeCollection.js.map