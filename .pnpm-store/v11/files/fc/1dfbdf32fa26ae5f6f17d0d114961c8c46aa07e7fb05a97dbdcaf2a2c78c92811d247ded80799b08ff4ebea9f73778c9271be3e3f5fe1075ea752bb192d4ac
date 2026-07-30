import { expectTypeOf } from 'expect-type';

import {
  AsyncFlow,
  AsyncFlowWithCache,
  AsyncFlowWithData,
  AsyncFlowWithDataAndCache,
  IdName,
  LabelValue,
} from './common';

describe('AsyncFlow', () => {
  it('should match properly', () => {
    expectTypeOf({
      message: 'test',
      status: 'IDLE' as const,
    }).toMatchTypeOf<AsyncFlow>();
  });
});

describe('AsyncFlowWithData', () => {
  it('should match properly', () => {
    expectTypeOf({
      data: { a: 1 },
      message: 'test',
      status: 'IDLE' as const,
    }).toMatchTypeOf<AsyncFlowWithData>();
  });
});

describe('AsyncFlowWithCache', () => {
  it('should match properly', () => {
    expectTypeOf({
      message: 'test',
      status: 'IDLE' as const,
      updatedAt: 123456789,
    }).toMatchTypeOf<AsyncFlowWithCache>();
  });
});

describe('AsyncFlowWithDataAndCache', () => {
  it('should match properly', () => {
    expectTypeOf({
      data: { a: 1 },
      message: 'test',
      status: 'IDLE' as const,
      updatedAt: 123456789,
    }).toMatchTypeOf<AsyncFlowWithDataAndCache>();
  });
});

describe('IdName', () => {
  it('should match properly', () => {
    expectTypeOf({
      id: 'test',
      name: 'test',
    }).toMatchTypeOf<IdName>();
  });
});

describe('LabelValue', () => {
  it('should match properly', () => {
    expectTypeOf({
      label: 'Test',
      value: 'test',
    }).toMatchTypeOf<LabelValue>();
  });
});
