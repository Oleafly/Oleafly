export function isDevelopmentBuild(): boolean {
  return import.meta.env?.DEV === true;
}
