import { o as objectId } from './shared/stream.Nu8NYPji.mjs';
import { getTokenStyleObject } from '@shikijs/core';
import { useRef, useInsertionEffect, useCallback, useState, useEffect, createElement } from 'react';

function useEffectEvent(fn) {
  const ref = useRef(null);
  useInsertionEffect(() => {
    ref.current = fn;
  }, [fn]);
  return useCallback((...args) => {
    const latestFn = ref.current;
    return latestFn(...args);
  }, []);
}

function ShikiStreamRenderer({
  stream,
  onStreamStart,
  onStreamEnd
}) {
  const [tokens, setTokens] = useState([]);
  const _onStreamStart = useEffectEvent(() => onStreamStart?.());
  const _onStreamEnd = useEffectEvent(() => onStreamEnd?.());
  useEffect(() => {
    setTokens((prevTokens) => prevTokens.length ? [] : prevTokens);
    let started = false;
    stream.pipeTo(new WritableStream({
      write(token) {
        if (!started) {
          started = true;
          _onStreamStart();
        }
        if ("recall" in token)
          setTokens((tokens2) => tokens2.slice(0, -token.recall));
        else
          setTokens((tokens2) => [...tokens2, token]);
      },
      close: () => _onStreamEnd()
    }));
  }, [_onStreamEnd, _onStreamStart, stream]);
  return createElement(
    "pre",
    { className: "shiki shiki-stream" },
    createElement(
      "code",
      {},
      tokens.map((token) => createElement("span", { key: objectId(token), style: token.htmlStyle || getTokenStyleObject(token) }, token.content))
    )
  );
}

export { ShikiStreamRenderer };
