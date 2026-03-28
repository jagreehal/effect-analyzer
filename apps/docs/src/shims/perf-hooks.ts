export const performance =
  globalThis.performance ?? {
    now: () => Date.now(),
    timeOrigin: Date.now(),
    mark: () => {},
    measure: () => {},
    clearMarks: () => {},
    clearMeasures: () => {},
  };
