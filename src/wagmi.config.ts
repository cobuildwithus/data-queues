import { defineConfig, loadEnv } from '@wagmi/cli';
import { etherscan } from '@wagmi/cli/plugins';

const baseContracts = [
  {
    name: 'zoraCreator1155Impl',
    address: '0x02be886a3b2802177181f4734380cb1f4bac4bfb' as `0x${string}`,
  },
];

export default defineConfig(() => {
  const env = loadEnv({ mode: process.env.NODE_ENV, envDir: process.cwd() });

  return {
    out: 'src/generated.ts',
    contracts: [],
    plugins: [
      etherscan({
        apiKey: env.BASESCAN_API_KEY,
        chainId: 8453,
        contracts: baseContracts,
      }),
    ],
  };
});
