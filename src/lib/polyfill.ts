if (typeof global.self === "undefined") {
  // @ts-expect-error - Polyfill for browser's self object in Node environment
  global.self = global;
}

export {};
