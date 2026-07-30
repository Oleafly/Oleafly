interface GetPushedThumbValuesParams {
  values: readonly number[];
  index: number;
  nextValue: number;
  min: number;
  max: number;
  step: number;
  minStepsBetweenValues: number;
  initialValues?: readonly number[] | undefined;
}
/**
 * Returns a new array of slider values where attempting to move the thumb at `index`
 * beyond its neighbours "pushes" them while respecting `minStepsBetweenValues`.
 */
export declare function getPushedThumbValues({
  values,
  index,
  nextValue,
  min,
  max,
  step,
  minStepsBetweenValues,
  initialValues
}: GetPushedThumbValuesParams): number[];
export {};