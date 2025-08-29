import "./polyfill";
import {
  connect,
  createDataItemSigner as createDataItemSignerNode,
} from "@permaweb/aoconnect/node";

const CU_URL = process.env.CU_URL || "https://cu.ao-testnet.xyz";

export const aoInstance = connect({ MODE: "legacy" });
export const aoInstanceWithCustomCu = connect({
  MODE: "legacy",
  CU_URL,
});

export const createDataItemSigner = createDataItemSignerNode;
