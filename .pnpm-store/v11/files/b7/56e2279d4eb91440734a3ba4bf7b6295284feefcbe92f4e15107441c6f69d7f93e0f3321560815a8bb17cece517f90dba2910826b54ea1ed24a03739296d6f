let set;
if (process.env.NODE_ENV !== 'production') {
  set = new Set();
}
export function warn(...messages) {
  if (process.env.NODE_ENV !== 'production') {
    const messageKey = messages.join(' ');
    if (!set.has(messageKey)) {
      set.add(messageKey);
      console.warn(`Base UI: ${messageKey}`);
    }
  }
}