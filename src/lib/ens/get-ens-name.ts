import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { RedisClientType } from 'redis';
import { cacheResult } from '../cache/cacheResult';

const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(
    `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_ID}`
  ),
  batch: { multicall: true },
});

export const getEnsName = async (
  address: string,
  redisClient: RedisClientType
) => {
  try {
    return await cacheResult(redisClient, address, 'ens:', async () => {
      const ensName = await mainnetClient.getEnsName({
        address: address as `0x${string}`,
      });
      return ensName;
    });
  } catch (error) {
    console.error('Error getting ENS name:', error);
    return null;
  }
};
