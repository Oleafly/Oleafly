let set;
if (process.env.NODE_ENV !== 'production') {
  set = new Set();
}
export function error(...messages) {
  if (process.env.NODE_ENV !== 'production') {
    const messageKey = messages.join(' ');
    if (!set.has(messageKey)) {
      set.add(messageKey);
      console.error(`Base UI: ${messageKey}`);
    }
  }
}
export function reset() {
  set?.clear();
}