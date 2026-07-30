import { clamp } from "../../internals/clamp.mjs";
import { replaceArrayItemAtIndex } from "./replaceArrayItemAtIndex.mjs";
export function getSliderValue(valueInput, index, min, max, range, values) {
  let newValue = valueInput;
  newValue = clamp(newValue, min, max);
  if (range) {
    newValue = replaceArrayItemAtIndex(values, index,
    // Bound the new value to the thumb's neighbours.
    clamp(newValue, values[index - 1] ?? -Infinity, values[index + 1] ?? Infinity));
  }
  return newValue;
}