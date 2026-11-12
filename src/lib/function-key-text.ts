const FUNCTION_KEY_TEXT = /^[-]+$/u;

function refuseFunctionKeyText(event: Event): void {
  const { data, inputType } = event as InputEvent;
  if (inputType && !inputType.startsWith("insert")) return;
  if (data && FUNCTION_KEY_TEXT.test(data)) event.preventDefault();
}

export function installFunctionKeyTextGuard(windowObject: Window = window): () => void {
  windowObject.addEventListener("beforeinput", refuseFunctionKeyText, true);
  windowObject.addEventListener("textInput", refuseFunctionKeyText, true);
  return () => {
    windowObject.removeEventListener("beforeinput", refuseFunctionKeyText, true);
    windowObject.removeEventListener("textInput", refuseFunctionKeyText, true);
  };
}
