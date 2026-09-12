export function scriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/[<>\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
