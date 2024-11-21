import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

export const baseClient = createPublicClient({
  chain: base,
  transport: http(
    `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_ID}`
  ),
  batch: { multicall: true },
});
