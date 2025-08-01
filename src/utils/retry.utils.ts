/**
 * Pauses execution for a given number of milliseconds.
 *
 * @param {number} ms - Duration to sleep in milliseconds.
 * @returns {Promise<void>} Resolves after the specified delay.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a given function up to a maximum number of attempts.
 * @param fn - The asynchronous function to retry, which should return a Promise.
 * @param maxAttempts - The maximum number of attempts to make.
 * @param initialDelay - The delay between attempts in milliseconds.
 * @param getDelay - A function that returns the delay for a given attempt.
 * @return A Promise that resolves with the result of the function or rejects after all attempts fail.
 */
export async function retryWithDelay<T>(
  fn: (attempt: number) => Promise<T>,
  maxAttempts: number = 3,
  initialDelay: number = 1000,
  getDelay: (attempt: number) => number = () => initialDelay
): Promise<T> {
  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    try {
      return await fn(attempts);
    } catch (error) {
      if (attempts === maxAttempts - 1) {
        throw error;
      }
      await sleep(getDelay(attempts));
    }
  }

  // This should never be reached due to throw in catch block
  throw new Error("Max attempts reached");
}
