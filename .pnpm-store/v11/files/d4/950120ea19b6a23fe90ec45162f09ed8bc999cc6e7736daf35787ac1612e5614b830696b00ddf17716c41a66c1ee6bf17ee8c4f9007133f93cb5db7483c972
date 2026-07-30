"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Text from "../Text/Text.mjs";
import { stopPropagation } from "../utils/dom.mjs";
import MaterialFileTypeIcon from "../MaterialFileTypeIcon/MaterialFileTypeIcon.mjs";
import { memo, useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Select } from "antd";
import { bundledLanguagesInfo } from "shiki";
//#region src/Highlighter/LangSelect.tsx
const LangSelect = memo(({ ...rest }) => {
	return /* @__PURE__ */ jsx(Select, {
		showSearch: true,
		className: "languageTitle",
		options: useMemo(() => [{
			aliases: ["text", "txt"],
			label: /* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				gap: 4,
				children: [/* @__PURE__ */ jsx(MaterialFileTypeIcon, {
					fallbackUnknownType: false,
					filename: `*.txt`,
					size: 18,
					type: "file",
					variant: "raw"
				}), /* @__PURE__ */ jsx(Text, {
					ellipsis: true,
					fontSize: 13,
					children: "Plaintext"
				})]
			}),
			value: "plaintext"
		}, ...bundledLanguagesInfo.map((item) => ({
			aliases: item.aliases,
			label: /* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				gap: 4,
				children: [/* @__PURE__ */ jsx(MaterialFileTypeIcon, {
					fallbackUnknownType: false,
					filename: `*.${item?.aliases?.[0] || item.id}`,
					size: 18,
					type: "file",
					variant: "raw"
				}), /* @__PURE__ */ jsx(Text, {
					ellipsis: true,
					fontSize: 13,
					children: item.name
				})]
			}),
			title: (item.aliases || [item.id]).filter(Boolean).map((item) => `*.${item}`).join(","),
			value: item.id
		}))], []),
		size: "small",
		suffixIcon: false,
		variant: "borderless",
		style: {
			maxWidth: 240,
			width: "100%"
		},
		onClick: stopPropagation,
		...rest
	});
});
//#endregion
export { LangSelect, LangSelect as default };

//# sourceMappingURL=LangSelect.mjs.map