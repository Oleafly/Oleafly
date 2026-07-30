import { root } from 'getroot';

/**
 * Naïvely check if current runtime supports native web assembly.
 */
export const isWasmEnabled = () => !!root.WebAssembly && !!root.WebAssembly.compile && !!root.WebAssembly.instantiate;
