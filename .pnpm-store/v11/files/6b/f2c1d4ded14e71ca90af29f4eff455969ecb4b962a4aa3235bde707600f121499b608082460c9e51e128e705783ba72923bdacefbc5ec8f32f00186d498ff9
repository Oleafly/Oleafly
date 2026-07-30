import * as React from 'react';
import { DialogStore } from "../store/DialogStore.js";
export interface DialogRootContext<Payload = unknown> {
  store: DialogStore<Payload>;
}
export declare const IsDrawerContext: React.Context<boolean>;
export declare const DialogRootContext: React.Context<DialogRootContext<unknown> | undefined>;
export declare function useDialogRootContext(optional?: false): DialogRootContext;
export declare function useDialogRootContext(optional: true): DialogRootContext | undefined;