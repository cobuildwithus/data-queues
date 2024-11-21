import ogs from 'open-graph-scraper';
import { Job } from 'bullmq';
import { log } from '../helpers';
import { retryWithExponentialBackoff } from '../retry/retry-fetch';

export interface OpenGraphData {
  ogTitle?: string;
  ogType?: string;
  ogUrl?: string;
  ogDescription?: string;
  ogImage?: {
    url: string;
    width?: string;
    height?: string;
    type?: string;
  }[];
  success: boolean;
}

/**
 * Fetches Open Graph data from a URL with retry logic
 */
export async function getOpenGraphData(
  url: string,
  job: Job
): Promise<OpenGraphData | null> {
  try {
    const userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3';

    const options = {
      url,
      fetchOptions: {
        headers: {
          'user-agent': userAgent,
        },
      },
      timeout: 10000,
    };

    const data = await retryWithExponentialBackoff(
      async () => ogs(options),
      job,
      3,
      1000
    );

    if (data.error) {
      log(
        `Error fetching Open Graph data: ${JSON.stringify(data.result)}`,
        job
      );
      return null;
    }

    return data.result as OpenGraphData;
  } catch (error: any) {
    log(`Failed to fetch Open Graph data: ${error.message}`, job);
    return null;
  }
}
