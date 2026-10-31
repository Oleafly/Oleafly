import { vi } from "vitest";

export function installCanvas(colors: Readonly<Record<string, string>> | null): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
    if (!colors) return null;
    let style = "#000000";
    return {
      get fillStyle() {
        return style;
      },
      set fillStyle(value: string) {
        if (Object.hasOwn(colors, value)) style = colors[value];
      },
    };
  }) as unknown as HTMLCanvasElement["getContext"]);
}
