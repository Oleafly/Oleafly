import { getTokenStyleObject } from '@shikijs/core';
import { createSignal, createEffect, on, onCleanup, For } from 'solid-js';

function ShikiStreamRenderer(props) {
  const [tokens, setTokens] = createSignal([]);
  createEffect(on(
    () => props.stream,
    (stream) => {
      if (!stream) {
        setTokens(() => []);
        return;
      }
      let started = false;
      const abortController = new AbortController();
      const { signal } = abortController;
      setTokens(() => []);
      const controller = stream.pipeTo(
        new WritableStream({
          write(token) {
            if (signal.aborted)
              return;
            if (!started) {
              started = true;
              props.onStreamStart?.();
            }
            if ("recall" in token)
              setTokens((ts) => ts.slice(0, -token.recall));
            else
              setTokens((ts) => [...ts, token]);
          },
          close: () => {
            if (!signal.aborted)
              props.onStreamEnd?.();
          },
          abort: () => {
            if (!signal.aborted)
              props.onStreamEnd?.();
          }
        }),
        { signal }
      );
      onCleanup(() => {
        abortController.abort();
        controller.catch(() => {
        });
      });
    }
  ));
  return /* @__PURE__ */ React.createElement("pre", { class: `shiki shiki-stream${props.class ? ` ${props.class}` : ""}` }, /* @__PURE__ */ React.createElement("code", null, /* @__PURE__ */ React.createElement(For, { each: tokens() }, (token) => /* @__PURE__ */ React.createElement("span", { style: token.htmlStyle ?? getTokenStyleObject(token) }, token.content))));
}

export { ShikiStreamRenderer };
