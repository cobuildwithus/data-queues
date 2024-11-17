import { Job } from 'bullmq';
import { log } from '../queueLib';

export async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  job: Job,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const transientErrorCodes = [
      'ENOTFOUND',
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      // Add other transient error codes as needed
    ];
    const isTransientError =
      transientErrorCodes.includes(error.code) || error.status >= 500;
    const status = error?.status || error?.code || 'Unknown';
    log(
      `Error during operation: ${error.message}. Status: ${status}. Retries left: ${retries}`,
      job
    );
    if (retries > 0 && isTransientError) {
      log(`Retrying after ${delay} ms...`, job);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryWithExponentialBackoff(fn, job, retries - 1, delay * 2);
    } else {
      throw error;
    }
  }
}
