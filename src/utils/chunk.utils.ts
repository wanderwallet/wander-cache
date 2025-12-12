const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fast hash function using the FNV-1a algorithm
 * @param str - The string to hash
 * @returns The hash of the string
 */
function fastHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash =
      (hash +
        (hash << 1) +
        (hash << 4) +
        (hash << 7) +
        (hash << 8) +
        (hash << 24)) >>>
      0;
  }
  // Final avalanche
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * Get the chunk for a token ID
 * @param tokenId - The token ID to get the chunk for
 * @param numChunks - The number of chunks to divide the token IDs into
 * @returns The chunk for the token ID
 */
export function getTokenChunk(tokenId: string, numChunks: number): number {
  return fastHash(tokenId) % numChunks;
}

/**
 * Get the chunk for the current day
 * @param numChunks - The number of chunks to divide the token IDs into
 * @returns The chunk for the current day
 */
export function getTodayChunk(numChunks: number): number {
  const today = Math.floor(Date.now() / ONE_DAY_MS);
  return today % numChunks;
}
