import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

export function allowRadixSelect(): void {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
}

export async function chooseOption(user: UserEvent, label: string, option: string): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}
