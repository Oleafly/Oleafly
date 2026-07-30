import { clamp } from "../../internals/clamp.mjs";
import { valueToPercent } from "../../utils/valueToPercent.mjs";
export function valueArrayToPercentages(values, min, max) {
  const output = [];
  for (let i = 0; i < values.length; i += 1) {
    output.push(clamp(valueToPercent(values[i], min, max), 0, 100));
  }
  return output;
}