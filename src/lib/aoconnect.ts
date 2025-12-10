import { DryrunInput, DryRunResult } from "@/types/types";
import "./polyfill";
import {
  connect,
  createDataItemSigner as createDataItemSignerNode,
} from "@permaweb/aoconnect/node";

export const DEFAULT_CU_URL = "https://cu.ao-testnet.xyz";
const CU_URL = process.env.CU_URL || DEFAULT_CU_URL;
export const OUR_CU_URL = "https://gateway.ar";
export const DATAOS_CU_URL = "https://cu-af.dataos.so";

export const aoInstance = connect({ MODE: "legacy" });
export const customAoInstance = connect({ MODE: "legacy", CU_URL });
export const ourAoInstance = connect({ MODE: "legacy", CU_URL: OUR_CU_URL });
export const dataosAoInstance = connect({
  MODE: "legacy",
  CU_URL: DATAOS_CU_URL,
});

export const createDataItemSigner = createDataItemSignerNode;

const baseTags = [
  { name: "Data-Protocol", value: "ao" },
  { name: "Type", value: "Message" },
  { name: "Variant", value: "ao.TN.1" },
];

export async function fetchDryrun({
  process,
  tags,
  data,
  anchor,
  Id,
  Owner,
  cuUrl = DEFAULT_CU_URL,
}: DryrunInput): Promise<DryRunResult> {
  const body = {
    Id: Id || "1234",
    Target: process,
    Owner: Owner || "1234",
    Anchor: anchor || "0",
    Data: data || "1234",
    Tags: [...baseTags, ...tags],
  };
  const response = await fetch(`${cuUrl}/dry-run?process-id=${process}`, {
    headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.5",
      "content-type": "application/json",
      "User-Agent": "Bun/1.3.4",
    },
    body: JSON.stringify(body),
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return result;
}
