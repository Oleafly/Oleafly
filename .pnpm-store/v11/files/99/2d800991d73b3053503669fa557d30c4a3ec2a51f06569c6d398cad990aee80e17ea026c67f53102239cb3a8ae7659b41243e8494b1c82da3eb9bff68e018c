"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _colorUtils = require("../colorUtils");
var _renderUtils = require("../renderUtils");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
const twoToneColorPalette = {
  primaryColor: '#333',
  secondaryColor: '#E6E6E6',
  calculated: false
};
function setTwoToneColors({
  primaryColor,
  secondaryColor
}) {
  twoToneColorPalette.primaryColor = primaryColor;
  twoToneColorPalette.secondaryColor = secondaryColor || (0, _colorUtils.getSecondaryColor)(primaryColor);
  twoToneColorPalette.calculated = !!secondaryColor;
}
function getTwoToneColors() {
  return {
    ...twoToneColorPalette
  };
}
const IconBaseTwoTone = props => {
  const {
    icon,
    className,
    onClick,
    style,
    primaryColor,
    secondaryColor,
    ...restProps
  } = props;
  const svgRef = React.useRef(null);
  let colors = twoToneColorPalette;
  if (primaryColor) {
    colors = {
      primaryColor,
      secondaryColor: secondaryColor || (0, _colorUtils.getSecondaryColor)(primaryColor)
    };
  }
  (0, _renderUtils.useInsertStyles)(svgRef);
  (0, _renderUtils.warning)((0, _renderUtils.isIconDefinition)(icon), `icon should be icon definiton, but got ${icon}`);
  if (!(0, _renderUtils.isIconDefinition)(icon)) {
    return null;
  }
  let target = icon;
  if (target && typeof target.icon === 'function') {
    target = {
      ...target,
      icon: target.icon(colors.primaryColor, colors.secondaryColor)
    };
  }
  return (0, _renderUtils.generate)(target.icon, `svg-${target.name}`, {
    className,
    onClick,
    style,
    'data-icon': target.name,
    width: '1em',
    height: '1em',
    fill: 'currentColor',
    'aria-hidden': 'true',
    ...restProps,
    ref: svgRef
  });
};
IconBaseTwoTone.displayName = 'IconReact';
IconBaseTwoTone.getTwoToneColors = getTwoToneColors;
IconBaseTwoTone.setTwoToneColors = setTwoToneColors;
var _default = exports.default = IconBaseTwoTone;