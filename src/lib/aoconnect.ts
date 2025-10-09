import "./polyfill";
import {
  dryrun,
  message,
  //   connect,
  createDataItemSigner as createDataItemSignerNode,
} from "@permaweb/aoconnect/node";

export const aoInstance = { dryrun, message };
export const aoInstanceWithCustomCu = aoInstance;

export const createDataItemSigner = createDataItemSignerNode;
