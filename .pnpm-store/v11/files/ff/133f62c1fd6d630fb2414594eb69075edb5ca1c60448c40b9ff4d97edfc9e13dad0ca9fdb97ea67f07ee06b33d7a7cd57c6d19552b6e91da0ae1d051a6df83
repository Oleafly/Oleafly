export function validateMinimumDistance(values, step, minStepsBetweenValues) {
  if (!Array.isArray(values)) {
    return true;
  }
  const distances = values.reduce((acc, val, index, vals) => {
    if (index === vals.length - 1) {
      return acc;
    }
    acc.push(Math.abs(val - vals[index + 1]));
    return acc;
  }, []);
  return Math.min(...distances) >= step * minStepsBetweenValues;
}