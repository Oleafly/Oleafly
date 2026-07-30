"use client";
import ActionIcon from "../../ActionIcon/ActionIcon.mjs";
import { useTranslation } from "../../i18n/useTranslation.mjs";
import chat_default from "../../i18n/resources/en/chat.mjs";
import { useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { Progress } from "antd";
import { cssVar } from "antd-style";
import numeral from "numeral";
//#region src/chat/TokenTag/TokenTag.tsx
const format = (number) => numeral(number).format("0,0");
const TokenTag = ({ mode = "remained", maxValue, value, text, showInfo, size = 20, ...rest }) => {
	const { t } = useTranslation(chat_default);
	const valueLeft = maxValue - value;
	const percent = value / maxValue;
	const remainedText = text?.remained ?? t("tokenTag.remained");
	const usedText = text?.used ?? t("tokenTag.used");
	const overloadText = text?.overload ?? t("tokenTag.overload");
	const data = useMemo(() => {
		let type;
		let color;
		if (percent < .7) {
			type = "normal";
			color = cssVar.colorText;
		} else if (percent < .9) {
			type = "low";
			color = cssVar.colorWarning;
		} else {
			type = "overload";
			color = cssVar.colorError;
		}
		return {
			color,
			type
		};
	}, [percent]);
	const title = valueLeft > 0 ? [mode === "remained" ? remainedText : usedText, mode === "remained" ? format(valueLeft) : format(value)].join(" ") : overloadText;
	return /* @__PURE__ */ jsx(ActionIcon, {
		size,
		title: showInfo ? title : void 0,
		icon: /* @__PURE__ */ jsx(Progress, {
			percent: percent * 100,
			showInfo: false,
			size: Number(typeof size === "object" ? size?.size || 20 : size) || 20,
			strokeColor: data.color,
			type: "circle"
		}),
		...rest
	});
};
TokenTag.displayName = "TokenTag";
//#endregion
export { TokenTag as default };

//# sourceMappingURL=TokenTag.mjs.map