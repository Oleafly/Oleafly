import { expectTypeOf } from 'expect-type';

import { NarrowPlainObject, RemoveType, StrictObject } from './utilities';

describe('NarrowPlainObject', () => {
  interface User {
    id: number;
    name: string;
  }

  const getUser = <T extends Record<string, any>>(data: NarrowPlainObject<T>): User => {
    const { id, name } = data;

    return { id, name };
  };

  it('should match a plain object', () => {
    expectTypeOf({ id: 1, name: 'John' }).toEqualTypeOf<NarrowPlainObject<User>>();
  });

  it('should narrow down a Record to a plain object', () => {
    expectTypeOf(getUser({ id: 1, name: 'John', age: 30 })).toMatchTypeOf<User>();
  });
});

describe('RemoveType', () => {
  type Test = { a: number; b: undefined; c: null; d: string };

  it('should remove undefined', () => {
    type Expected = RemoveType<Test>;

    expectTypeOf({ a: 1, c: null, d: 'test' }).toEqualTypeOf<Expected>();
  });

  it('should remove multiple types', () => {
    type Expected = RemoveType<Test, string | undefined | null>;

    expectTypeOf({ a: 1 }).toEqualTypeOf<Expected>();
  });
});

describe('StrictObject', () => {
  interface User {
    id: number;
    name: string;
  }

  const user = {
    id: 1,
    name: 'John',
  };

  it('should return an object with the same keys and values', () => {
    const fn = <T extends object>(callback: () => StrictObject<T, User>) => {
      return callback();
    };

    const result = fn(() => user);

    expectTypeOf(result).toMatchTypeOf<User>();
  });
});
