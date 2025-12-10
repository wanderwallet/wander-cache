export interface DryrunInput {
  process: string;
  tags: { name: string; value: string }[];
  data?: any;
  anchor?: string;
  Id?: string;
  Owner?: string;
  cuUrl?: string;
}

export interface DryRunResult {
  Output: any;
  Messages: any[];
  Spawns: any[];
  Error?: any;
}
