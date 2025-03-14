if (typeof global.self === "undefined") {
  // @ts-expect-error
  global.self = global;
}

export {};
