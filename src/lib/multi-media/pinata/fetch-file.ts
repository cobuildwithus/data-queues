import axios from 'axios';
import { Job } from 'bullmq';
import https from 'https';
import { log } from '../../helpers';

/**
 * Helper function to fetch data from gateway URL
 */
export async function fetchFromGateway<T>(
  gatewayUrl: string,
  agent: https.Agent,
  job: Job
): Promise<T> {
  const res = await axios.get<T>(gatewayUrl, {
    httpsAgent: agent,
    headers: {
      'x-pinata-gateway-token': process.env.PINATA_GATEWAY_KEY,
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
    },
    timeout: 10000,
  });
  if (res.status !== 200) {
    log(`Failed to fetch data: ${res.status}`, job);
    throw new Error(`Failed to fetch data: ${res.status}`);
  }
  return res.data;
}
