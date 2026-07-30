export type AsyncStatus = 'IDLE' | 'PENDING' | 'SUCCESS' | 'ERROR';

export interface AsyncFlow {
  message: string;
  status: AsyncStatus;
}

export interface AsyncFlowWithCache extends AsyncFlow {
  updatedAt: number;
}

export interface AsyncFlowWithData<T = any> extends AsyncFlow {
  data: T;
}

export interface AsyncFlowWithDataAndCache<T = any> extends AsyncFlowWithData<T> {
  updatedAt: number;
}

export type HttpMethods =
  | 'CONNECT'
  | 'DELETE'
  | 'GET'
  | 'HEAD'
  | 'OPTIONS'
  | 'PATCH'
  | 'POST'
  | 'PUT';

export interface IdName {
  id: string;
  name: string;
}

export interface LabelValue {
  label: string;
  value: string;
}
