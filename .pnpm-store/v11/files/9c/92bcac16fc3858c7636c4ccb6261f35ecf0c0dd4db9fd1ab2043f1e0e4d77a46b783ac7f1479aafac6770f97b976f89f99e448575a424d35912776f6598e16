import { expectTypeOf } from 'expect-type';

import { GenericFunction, PlainObject, VoidFunction } from './aliases';

describe('GenericFunction', () => {
  it('should match any function', () => {
    expectTypeOf(() => undefined).toMatchTypeOf<GenericFunction>();
    expectTypeOf((a: number) => a).toMatchTypeOf<GenericFunction>();
    expectTypeOf((a: number, b: string) => a + b).toMatchTypeOf<GenericFunction>();
  });
});

describe('PlainObject', () => {
  it('should match plain objects', () => {
    expectTypeOf({}).toMatchTypeOf<PlainObject>();
    expectTypeOf({ a: 1 }).toMatchTypeOf<PlainObject>();
  });

  it('should NOT match built-in objects', () => {
    expectTypeOf(() => undefined).not.toMatchTypeOf<PlainObject>();
    expectTypeOf([]).not.toMatchTypeOf<PlainObject>();
    expectTypeOf([1, 2, 3]).not.toMatchTypeOf<PlainObject>();
  });

  it('should NOT match primitive values', () => {
    expectTypeOf('test').not.toMatchTypeOf<PlainObject>();
    expectTypeOf(1).not.toMatchTypeOf<PlainObject>();
    expectTypeOf(BigInt(12345678)).not.toMatchTypeOf<PlainObject>();
    expectTypeOf(Symbol('test')).not.toMatchTypeOf<PlainObject>();
    expectTypeOf(undefined).not.toMatchTypeOf<PlainObject>();
    expectTypeOf(null).not.toMatchTypeOf<PlainObject>();
  });
});

describe('VoidFunction', () => {
  it('should match void functions', () => {
    expectTypeOf(() => undefined).toMatchTypeOf<VoidFunction>();
    expectTypeOf(() => null).toMatchTypeOf<VoidFunction>();
    expectTypeOf(() => {}).toMatchTypeOf<VoidFunction>();
  });

  it('should NOT match functions that return value', () => {
    expectTypeOf((a: number) => a).not.toMatchTypeOf<VoidFunction>();
    expectTypeOf((a: number, b: string) => a + b).not.toMatchTypeOf<VoidFunction>();
  });
});
