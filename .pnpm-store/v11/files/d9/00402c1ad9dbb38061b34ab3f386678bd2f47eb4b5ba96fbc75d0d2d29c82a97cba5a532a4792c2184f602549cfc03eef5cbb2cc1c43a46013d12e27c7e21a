import * as vue from 'vue';
import { PropType } from 'vue';
import { HighlighterCore, ThemedToken } from '@shikijs/core';
import { R as RecallToken } from './shared/stream.v8L1RTbz.mjs';

/**
 * A simple wrapper around `ShikiStreamRenderer` that caches the code and only re-renders when the code changes.
 *
 * This component expects `code` prop to only be incrementally updated, and not set to a new value.
 * If you need to set the `code` prop to a new value, set a different `key` prop when it happens.
 */
declare const ShikiCachedRenderer: vue.DefineComponent<vue.ExtractPropTypes<{
    code: {
        type: StringConstructor;
        required: true;
    };
    lang: {
        type: StringConstructor;
        required: true;
    };
    theme: {
        type: StringConstructor;
        required: true;
    };
    highlighter: {
        type: PropType<HighlighterCore>;
        required: true;
    };
}>, () => vue.VNode<vue.RendererNode, vue.RendererElement, {
    [key: string]: any;
}>, {}, {}, {}, vue.ComponentOptionsMixin, vue.ComponentOptionsMixin, ("stream-start" | "stream-end")[], "stream-start" | "stream-end", vue.PublicProps, Readonly<vue.ExtractPropTypes<{
    code: {
        type: StringConstructor;
        required: true;
    };
    lang: {
        type: StringConstructor;
        required: true;
    };
    theme: {
        type: StringConstructor;
        required: true;
    };
    highlighter: {
        type: PropType<HighlighterCore>;
        required: true;
    };
}>> & Readonly<{
    "onStream-start"?: ((...args: any[]) => any) | undefined;
    "onStream-end"?: ((...args: any[]) => any) | undefined;
}>, {}, {}, {}, {}, string, vue.ComponentProvideOptions, true, {}, any>;

declare const ShikiStreamRenderer: vue.DefineComponent<vue.ExtractPropTypes<{
    stream: {
        type: PropType<ReadableStream<ThemedToken | RecallToken>>;
        required: true;
    };
}>, () => vue.VNode<vue.RendererNode, vue.RendererElement, {
    [key: string]: any;
}>, {}, {}, {}, vue.ComponentOptionsMixin, vue.ComponentOptionsMixin, ("stream-start" | "stream-end")[], "stream-start" | "stream-end", vue.PublicProps, Readonly<vue.ExtractPropTypes<{
    stream: {
        type: PropType<ReadableStream<ThemedToken | RecallToken>>;
        required: true;
    };
}>> & Readonly<{
    "onStream-start"?: ((...args: any[]) => any) | undefined;
    "onStream-end"?: ((...args: any[]) => any) | undefined;
}>, {}, {}, {}, {}, string, vue.ComponentProvideOptions, true, {}, any>;

export { ShikiCachedRenderer, ShikiStreamRenderer };
