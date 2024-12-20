import { createPublicClient, http, PublicClient } from 'viem';
import { base, optimism, zora } from 'viem/chains';

export type SupportedNetwork = (typeof SUPPORTED_NETWORKS)[number];

export const SUPPORTED_NETWORKS = ['base', 'zora', 'oeth'] as const;

const baseClient = createPublicClient({
  chain: base,
  transport: http(
    `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_ID}`
  ),
  batch: { multicall: true },
});

const zoraClient = createPublicClient({
  chain: zora,
  transport: http(
    `https://zora-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_ID}`
  ),
  batch: { multicall: true },
});

const opMainnetClient = createPublicClient({
  chain: optimism,
  transport: http(
    `https://opt-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_ID}`
  ),
});

export const getClient = (network: SupportedNetwork): PublicClient => {
  switch (network) {
    case 'base':
      return baseClient as PublicClient;
    case 'oeth':
      return opMainnetClient as PublicClient;
    case 'zora':
      return zoraClient as PublicClient;
    default:
      throw new Error(`Unsupported network: ${network}`);
  }
};
