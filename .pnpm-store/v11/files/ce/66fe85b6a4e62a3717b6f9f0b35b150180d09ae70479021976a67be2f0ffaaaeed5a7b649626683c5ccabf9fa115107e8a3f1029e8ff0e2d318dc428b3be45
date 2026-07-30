export default function normalizeIcon(value, key, fallback) {
  if (value === false) return null; // Explicitly return null when value is false
  if (value === true) return fallback; // Return fallback when value is true
  // More explicit if statement, avoiding inline if
  if (value && value[key] !== undefined) {
    return value[key]; // Return value[key] if it's explicitly defined
  }
  return fallback; // Return fallback when no value is found
}