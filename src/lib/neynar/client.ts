import { NeynarAPIClient } from '@neynar/nodejs-sdk';
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;

if (!NEYNAR_API_KEY) {
  throw new Error('NEYNAR_API_KEY is not set');
}

const neynarClient = new NeynarAPIClient({
  apiKey: NEYNAR_API_KEY,
});

export default neynarClient;
