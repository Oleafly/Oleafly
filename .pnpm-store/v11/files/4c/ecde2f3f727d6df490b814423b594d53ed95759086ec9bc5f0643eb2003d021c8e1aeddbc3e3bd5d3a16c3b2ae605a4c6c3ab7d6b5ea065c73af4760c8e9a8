import _toConsumableArray from "@babel/runtime/helpers/esm/toConsumableArray";
import { isString } from '../_util/is';
export const DEFAULT_BORDER_BEAM_DURATION = 6;
export const MAX_BEAM_COLOR_STOP_PERCENT = 70;
const getLinearGradient = (...colorStops) => `linear-gradient(to left, ${colorStops.join(', ')}, transparent)`;
const normalizeBorderBeamColor = value => isString(value) ? [{
  color: value,
  percent: 0
}] : value ?? [];
const fillGradientEnd = items => {
  const lastItem = items[items.length - 1];
  if (!lastItem || lastItem.percent === 100) {
    return items;
  }
  return [].concat(_toConsumableArray(items), [{
    ...lastItem,
    percent: 100
  }]);
};
// Map user-facing 0~100 stops into the visible beam segment so the tail area stays reserved.
// We scale instead of hard-clamping because users describe the gradient against the full beam size:
// `30` should stay around the first third of the visible segment, rather than remain `30%` after
// the available range shrinks, which would distort the original color distribution.
const getMappedBeamColorStopPercent = percent => Number((Math.min(Math.max(percent, 0), 100) / 100 * MAX_BEAM_COLOR_STOP_PERCENT).toFixed(2));
const normalizeGradientItems = items => fillGradientEnd(items).map(item => ({
  ...item,
  percent: getMappedBeamColorStopPercent(item.percent)
}));
// Build the beam gradient from a solid color or explicit gradient stops.
export const getBorderBeamGradient = value => {
  // Reserve the trailing section for fade-out so custom gradients keep a visible tail.
  const normalizedStops = normalizeGradientItems(normalizeBorderBeamColor(value));
  return normalizedStops.length ? getLinearGradient.apply(void 0, _toConsumableArray(normalizedStops.map(item => `${item.color} ${item.percent}%`))) : undefined;
};