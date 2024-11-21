import axios from 'axios';
import { Job } from 'bullmq';
import { log } from '../../helpers';
import { retryWithExponentialBackoff } from '../../retry/retry-fetch';

const jwt = process.env.PINATA_JWT;

type PinJobStatus =
  | 'prechecking'
  | 'retrieving'
  | 'expired'
  | 'over_free_limit'
  | 'over_max_size'
  | 'invalid_object'
  | 'bad_host_node'
  | 'pinned'
  | 'pinning';

interface PinJobResponse {
  count: number;
  rows: Array<{
    id: string;
    ipfs_pin_hash: string;
    date_queued: string;
    name: string;
    status: PinJobStatus;
    keyvalues: any;
    host_nodes: string[];
    pin_policy: {
      regions: Array<{
        id: string;
        desiredReplicationCount: number;
      }>;
      version: number;
    };
  }>;
}

/**
 * Pins content to IPFS via Pinata using a CID/hash and monitors the pin status
 */
export async function pinByHash(
  hash: string,
  name: string,
  job: Job
): Promise<string | false> {
  try {
    // Start the pinning process
    await retryWithExponentialBackoff(
      async () => {
        const response = await axios.post(
          'https://api.pinata.cloud/pinning/pinByHash',
          {
            hashToPin: hash,
            pinataMetadata: {
              name,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${jwt}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );

        if (response.status !== 200) {
          throw new Error(`Failed to pin content: ${response.status}`);
        }

        return response.data;
      },
      job,
      3,
      1000
    );

    // Monitor pin status
    let attempts = 0;
    const maxAttempts = 30; // Increased from 10 to 30 attempts
    const delayMs = 5000; // Increased delay between checks to 5 seconds

    while (attempts < maxAttempts) {
      const statusResponse = await axios.get<PinJobResponse>(
        `https://api.pinata.cloud/pinning/pinJobs?ipfs_pin_hash=${hash}&limit=1`,
        {
          headers: {
            Authorization: `Bearer ${jwt}`,
          },
          timeout: 10000,
        }
      );

      if (statusResponse.data.rows.length > 0) {
        const pinStatus = statusResponse.data.rows[0].status;

        if (
          pinStatus === 'retrieving' ||
          pinStatus === 'prechecking' ||
          pinStatus === 'pinning'
        ) {
          log(`Pin status for ${hash}: ${pinStatus}`, job);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          attempts++;
          continue;
        }

        if (pinStatus === 'pinned') {
          log(`Successfully pinned content with hash ${hash}`, job);
          return `https://${process.env.PINATA_GATEWAY_URL}/ipfs/${hash}`;
        }

        if (
          pinStatus === 'expired' ||
          pinStatus === 'over_free_limit' ||
          pinStatus === 'over_max_size' ||
          pinStatus === 'invalid_object' ||
          pinStatus === 'bad_host_node'
        ) {
          log(`Pin failed with status: ${pinStatus}`, job);
          return false;
        }

        // If we get here, pinning was successful
        log(`Successfully pinned content with hash ${hash}`, job);
        return `https://${process.env.PINATA_GATEWAY_URL}/ipfs/${hash}`;
      }

      attempts++;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    log(`Timed out waiting for pin status for hash ${hash}`, job);
    return false;
  } catch (error: any) {
    log(`Error pinning content: ${error.message}`, job);
    return false;
  }
}
