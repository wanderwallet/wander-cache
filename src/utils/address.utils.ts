export const isArweaveAddress = (addr: string) =>
  typeof addr === "string" && /^[a-z0-9_-]{43}$/i.test(addr);
