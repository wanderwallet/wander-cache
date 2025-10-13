import "./polyfill";
import {
  connect,
  createDataItemSigner as createDataItemSignerNode,
} from "@permaweb/aoconnect/node";

const OUR_CU_URL = "https://gateway.ar";

export const aoInstance = connect({ MODE: "legacy" });
export const ourAoInstance = connect({ MODE: "legacy", CU_URL: OUR_CU_URL });

export const createDataItemSigner = createDataItemSignerNode;
