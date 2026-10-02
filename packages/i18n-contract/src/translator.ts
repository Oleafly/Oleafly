export type MessageParams = Record<string, string | number>;

export type Translator<K extends string = string> = (key: K, params?: MessageParams) => string;

export function echoKey(key: string): string {
  return key;
}

export interface TranslatorSlot<K extends string> {
  install: (next: Translator<K> | null) => void;
  translate: Translator<K>;
}

export function createTranslatorSlot<K extends string>(): TranslatorSlot<K> {
  let installed: Translator<K> = echoKey;
  return {
    install: (next) => {
      installed = next ?? echoKey;
    },
    translate: (key, params) => installed(key, params),
  };
}
