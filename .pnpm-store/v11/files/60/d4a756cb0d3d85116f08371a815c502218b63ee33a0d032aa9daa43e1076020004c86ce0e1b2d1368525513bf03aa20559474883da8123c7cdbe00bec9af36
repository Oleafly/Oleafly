import { defineComponent, reactive, watch, h, renderList, ref, watchEffect } from 'vue';
import { CodeToTokenTransformStream } from './index.mjs';
import { o as objectId } from './shared/stream.Nu8NYPji.mjs';
import { getTokenStyleObject } from '@shikijs/core';

const ShikiStreamRenderer = defineComponent({
  name: "ShikiStreamRenderer",
  props: {
    stream: {
      type: Object,
      required: true
    }
  },
  emits: ["stream-start", "stream-end"],
  setup(props, { emit }) {
    const tokens = reactive([]);
    let currentAbortController = null;
    watch(
      () => props.stream,
      (newStream) => {
        tokens.length = 0;
        if (currentAbortController) {
          currentAbortController.abort();
        }
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;
        let started = false;
        newStream.pipeTo(new WritableStream({
          write(token) {
            if (signal.aborted) {
              return;
            }
            if (!started) {
              started = true;
              emit("stream-start");
            }
            if ("recall" in token)
              tokens.length -= token.recall;
            else
              tokens.push(token);
          },
          close: () => {
            if (!signal.aborted) {
              emit("stream-end");
            }
          },
          abort: () => {
            if (!signal.aborted) {
              emit("stream-end");
            }
          }
        }), { signal }).catch((error) => {
          if (error.name !== "AbortError") {
            console.error("Stream error:", error);
          }
        });
      },
      { immediate: true }
    );
    return () => h(
      "pre",
      { class: "shiki shiki-stream" },
      h(
        "code",
        renderList(tokens, (token) => h("span", { key: objectId(token), style: token.htmlStyle || getTokenStyleObject(token) }, token.content))
      )
    );
  }
});

const ShikiCachedRenderer = defineComponent({
  name: "ShikiCachedRenderer",
  props: {
    code: {
      type: String,
      required: true
    },
    lang: {
      type: String,
      required: true
    },
    theme: {
      type: String,
      required: true
    },
    highlighter: {
      type: Object,
      required: true
    }
  },
  emits: ["stream-start", "stream-end"],
  setup(props, { emit }) {
    const index = ref(0);
    let controller = null;
    const textStream = new ReadableStream({
      start(_controller) {
        controller = _controller;
      }
    });
    watchEffect(() => {
      if (props.code.length > index.value) {
        controller?.enqueue(props.code.slice(index.value));
        index.value = props.code.length;
      }
    });
    const stream = textStream.pipeThrough(new CodeToTokenTransformStream({
      highlighter: props.highlighter,
      lang: props.lang,
      theme: props.theme,
      allowRecalls: true
    }));
    return () => h(
      ShikiStreamRenderer,
      {
        stream,
        onStreamStart: () => emit("stream-start"),
        onStreamEnd: () => emit("stream-end")
      }
    );
  }
});

export { ShikiCachedRenderer, ShikiStreamRenderer };
