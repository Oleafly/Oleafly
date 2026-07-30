import { DependencyList } from 'react';

import { PlainObject, Primitive, Target } from './types';

export function canUseDOM() {
  return !!(typeof window !== 'undefined' && window?.document?.createElement);
}

export function delay(delayMs: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, delayMs);
  });
}

export function getElement<T extends Element>(target: Target<T>) {
  if (!canUseDOM()) {
    return null;
  }

  let targetEl: Element | null;

  if (typeof target === 'string') {
    targetEl = document.querySelector(target);
  } else {
    targetEl = target && 'current' in target ? target.current : target;
  }

  return targetEl;
}

export function isPlainObject(value: unknown): value is PlainObject {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === null || prototype === Object.getPrototypeOf({});
}

export function isPrimitive(value: any): value is Primitive {
  return value !== Object(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isURL(value: unknown): value is string {
  if (!isString(value)) {
    return false;
  }

  try {
    new URL(value); // eslint-disable-line no-new

    return true;
  } catch {
    return false;
  }
}

export function noop() {
  return undefined;
}

/* eslint-disable @typescript-eslint/no-unsafe-function-type */
export function off<T extends Window | Document | HTMLElement | EventTarget>(
  target: T | null,
  ...rest: Parameters<T['removeEventListener']> | [string, Function | null, ...any]
): void {
  if (target && target.removeEventListener) {
    target.removeEventListener(...(rest as Parameters<HTMLElement['removeEventListener']>));
  }
}

export function on<T extends Window | Document | HTMLElement | EventTarget>(
  target: T | null,
  ...rest: Parameters<T['addEventListener']> | [string, Function | null, ...any]
): void {
  if (target && target.addEventListener) {
    target.addEventListener(...(rest as Parameters<HTMLElement['addEventListener']>));
  }
}
/* eslint-enable @typescript-eslint/no-unsafe-function-type */

export function validateDependencies(dependencies: DependencyList, name: string, fallback: string) {
  if (process.env.NODE_ENV !== 'production') {
    if (!(dependencies instanceof Array) || !dependencies.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `${name} should not be used with no dependencies. Use React.${fallback} instead.`,
      );
    }

    if (dependencies.length && dependencies.every(isPrimitive)) {
      // eslint-disable-next-line no-console
      console.warn(
        `${name} should not be used with dependencies that are all primitive values. Use React.${fallback} instead.`,
      );
    }
  }
}
