import "@testing-library/jest-dom/vitest";

// Node 22+ defines localStorage and sessionStorage on globalThis as accessors
// that return undefined unless --localstorage-file is set. Vitest copies jsdom
// globals only for names the global does not already have, so the jsdom
// storage never lands. Take it from the environment's own JSDOM instance.
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow) {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    if (globalThis[name] === undefined) {
      Object.defineProperty(globalThis, name, {
        value: jsdomWindow[name],
        configurable: true,
        writable: true,
      });
    }
  }
}
