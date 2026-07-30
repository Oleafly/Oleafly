//#region package/beamer/provides.ts
var macros = {
	mode: {
		signature: "s d<> d{}",
		renderInfo: { breakAround: true }
	},
	insertnavigation: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	insertsectionnavigation: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	insertsectionnavigationhorizontal: {
		signature: "m m m",
		renderInfo: { breakAround: true }
	},
	insertauthor: {
		signature: "o",
		renderInfo: { breakAround: true }
	},
	insertshortauthor: {
		signature: "o",
		renderInfo: { breakAround: true }
	},
	insertshortdate: {
		signature: "o",
		renderInfo: { breakAround: true }
	},
	insertshortinstitute: {
		signature: "o",
		renderInfo: { breakAround: true }
	},
	insertshortpart: {
		signature: "o",
		renderInfo: { breakAround: true }
	},
	insertshorttitle: {
		signature: "o",
		renderInfo: { breakAround: true }
	},
	insertsubsectionnavigation: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	insertsubsectionnavigationhorizontal: {
		signature: "m m m",
		renderInfo: { breakAround: true }
	},
	insertverticalnavigation: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	usebeamercolor: {
		signature: "s m",
		renderInfo: { breakAround: true }
	},
	usebeamertemplate: {
		signature: "s m",
		renderInfo: { breakAround: true }
	},
	setbeamercolor: {
		signature: "m m",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	setbeamersize: {
		signature: "m o o",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	setbeamertemplate: {
		signature: "m o o d{}",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	newcommand: {
		signature: "s d<> +m o +o +m",
		renderInfo: {
			breakAround: true,
			namedArguments: [
				"starred",
				null,
				"name",
				"numArgs",
				"default",
				"body"
			]
		}
	},
	renewcommand: {
		signature: "s d<> +m o +o +m",
		renderInfo: {
			breakAround: true,
			namedArguments: [
				"starred",
				null,
				"name",
				"numArgs",
				"default",
				"body"
			]
		}
	},
	newenvironment: {
		signature: "s d<> m o o m m",
		renderInfo: { breakAround: true }
	},
	renewenvironment: {
		signature: "s d<> m o o m m",
		renderInfo: { breakAround: true }
	},
	resetcounteronoverlays: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	resetcountonoverlays: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	logo: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	frametitle: {
		signature: "d<> o m",
		renderInfo: { breakAround: true }
	},
	framesubtitle: {
		signature: "d<> m",
		renderInfo: { breakAround: true }
	},
	pause: { signature: "o" },
	onslide: { signature: "t+ t* d<> d{}" },
	only: { signature: "d<> m d<>" },
	uncover: { signature: "d<> m" },
	visible: { signature: "d<> m" },
	invisible: { signature: "d<> m" },
	alt: { signature: "d<> m m d<>" },
	temporal: { signature: "r<> m m m" },
	item: {
		signature: "d<> o d<>",
		renderInfo: {
			hangingIndent: true,
			namedArguments: [
				null,
				"label",
				null
			]
		}
	},
	label: { signature: "d<> o m" },
	action: { signature: "d<> m" },
	beamerdefaultoverlayspecification: { signature: "m" },
	titlegraphic: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	subject: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	keywords: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	lecture: {
		signature: "o m m",
		renderInfo: { breakAround: true }
	},
	partpage: { renderInfo: { breakAround: true } },
	sectionpage: { renderInfo: { breakAround: true } },
	subsectionpage: { renderInfo: { breakAround: true } },
	AtBeginLecture: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	AtBeginPart: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	tableofcontents: {
		signature: "o",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	againframe: {
		signature: "d<> o o m",
		renderInfo: { breakAround: true }
	},
	framezoom: {
		signature: "r<> r<> o r() r()",
		renderInfo: { breakAround: true }
	},
	column: {
		signature: "d<> o m",
		renderInfo: { breakAround: true }
	},
	animate: {
		signature: "r<>",
		renderInfo: { breakAround: true }
	},
	animatevalue: {
		signature: "r<> m m m",
		renderInfo: { breakAround: true }
	},
	sound: {
		signature: "o m m",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	hyperlinksound: {
		signature: "o m m",
		renderInfo: {
			breakAround: true,
			pgfkeysArgs: true
		}
	},
	hyperlinkmute: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	section: {
		signature: "s d<> o m",
		renderInfo: {
			breakAround: true,
			namedArguments: [
				"starred",
				null,
				"tocTitle",
				"title"
			]
		}
	},
	subsection: {
		signature: "s d<> o m",
		renderInfo: {
			breakAround: true,
			namedArguments: [
				"starred",
				null,
				"tocTitle",
				"title"
			]
		}
	},
	subsubsection: {
		signature: "s d<> o m",
		renderInfo: {
			breakAround: true,
			namedArguments: [
				"starred",
				null,
				"tocTitle",
				"title"
			]
		}
	},
	part: {
		signature: "s d<> o m",
		renderInfo: {
			breakAround: true,
			namedArguments: [
				"starred",
				null,
				"tocTitle",
				"title"
			]
		}
	},
	bibitem: {
		signature: "s d<> o m",
		renderInfo: {
			hangingIndent: true,
			namedArguments: [
				"starred",
				null,
				"tocTitle",
				"title"
			]
		}
	}
};
var environments = {
	frame: { signature: "!d<> !o !o !d{} !d{}" },
	block: { signature: "!d<> !d{} !d<>" },
	alertblock: { signature: "!d<> !d{} !d<>" },
	exampleblock: { signature: "!d<> !d{} !d<>" },
	onlyenv: { signature: "!d<>" },
	altenv: { signature: "!d<> m m m m !d<>" },
	overlayarea: { signature: "m m" },
	overprint: { signature: "o" },
	actionenv: { signature: "!d<>" },
	columns: { signature: "d<> o" },
	column: { signature: "d<> o m" }
};
//#endregion
export { environments, macros };

//# sourceMappingURL=index.js.map