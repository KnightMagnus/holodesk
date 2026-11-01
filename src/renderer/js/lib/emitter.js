export function createEmitter() {
  const subs = new Map();
  return {
    on(event, fn) {
      if (!subs.has(event)) subs.set(event, new Set());
      subs.get(event).add(fn);
      return () => subs.get(event)?.delete(fn);
    },
    emit(event, payload) {
      for (const fn of subs.get(event) ?? []) fn(payload);
    }
  };
}
