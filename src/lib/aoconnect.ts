import "./polyfill";
import {
  connect,
  createDataItemSigner as createDataItemSignerNode,
} from "@permaweb/aoconnect/node";

export const aoInstance = connect({ MODE: "legacy" });

export const createDataItemSigner = createDataItemSignerNode;
