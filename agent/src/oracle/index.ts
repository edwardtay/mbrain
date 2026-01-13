import { createPublicClient, http, formatUnits } from 'viem'
import { mantle } from 'viem/chains'

// Mantle mainnet client
const client = createPublicClient({
  chain: mantle,
  transport: http('https://rpc.mantle.xyz'),
})

// Contract addresses
const ADDRESSES = {
  // mYield contracts
  USDC_VAULT: '0xcfF09905F8f18B35F5A1Ba6d2822D62B3d8c48bE',
  WETH_VAULT: '0x073b61f5Ed26d802b05301e0E019f78Ac1A41D23',
  USDC_LENDLE_ADAPTER: '0xf98a4A0482d534c004cdB9A3358fd71347c4395B',
  WETH_LENDLE_ADAPTER: '0x8F878deCd44f7Cf547D559a6e6D0577E370fa0Db',
  WETH_METH_ADAPTER: '0xEff2eC240CEB2Ddf582Df0e42fc66a6910D3Fe3f',

  // Protocol contracts
  LENDLE_POOL: '0xCFa5aE7c2CE8Fadc6426C1ff872cA45378Fb7cF3',
  LENDLE_DATA_PROVIDER: '0x552b9e4bae485C4B7F540777d7D25614CdB84773',
  METH: '0xcDA86A272531e8640cD7F1a92c01839911B90bb0',
  USDC: '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9',
  WETH: '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111',
}

// ABIs
const VAULT_ABI = [
  { name: 'totalAssets', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'getWeightedAPY', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'getAdapterInfo', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }], stateMutability: 'view' },
  { name: 'getAdaptersCount', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'needsRebalance', type: 'function', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
] as const

const ADAPTER_ABI = [
  { name: 'getAPY', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'getTotalValue', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

const LENDLE_DATA_PROVIDER_ABI = [
  { name: 'getReserveData', type: 'function', inputs: [{ type: 'address' }], outputs: [
    { type: 'uint256' }, // availableLiquidity
    { type: 'uint256' }, // totalStableDebt
    { type: 'uint256' }, // totalVariableDebt
    { type: 'uint256' }, // liquidityRate
    { type: 'uint256' }, // variableBorrowRate
    { type: 'uint256' }, // stableBorrowRate
    { type: 'uint256' }, // averageStableBorrowRate
    { type: 'uint256' }, // liquidityIndex
    { type: 'uint256' }, // variableBorrowIndex
    { type: 'uint40' },  // lastUpdateTimestamp
  ], stateMutability: 'view' },
] as const

export interface ProtocolData {
  timestamp: number
  vaults: {
    usdc: VaultData
    weth: VaultData
  }
  protocols: {
    lendle: LendleData
    meth: MethData
  }
  recommendations: {
    shouldRebalance: boolean
    reason: string
  }
}

export interface VaultData {
  address: string
  tvl: string
  tvlRaw: bigint
  apy: number
  adapters: AdapterData[]
  needsRebalance: boolean
}

export interface AdapterData {
  address: string
  allocation: number
  deposited: string
  depositedRaw: bigint
  apy: number
  active: boolean
}

export interface LendleData {
  usdcSupplyAPY: number
  usdcBorrowAPY: number
  usdcUtilization: number
  wethSupplyAPY: number
  wethBorrowAPY: number
  wethUtilization: number
}

export interface MethData {
  stakingAPY: number
  exchangeRate: number
}

// RAY = 10^27 for Aave/Lendle
const RAY = 10n ** 27n

function rayToPercent(ray: bigint): number {
  // Convert ray to percentage (ray / 10^27 * 100)
  return Number(ray * 10000n / RAY) / 100
}

export async function fetchProtocolData(): Promise<ProtocolData> {
  const timestamp = Date.now()

  // Fetch vault data in parallel
  const [usdcVault, wethVault, lendleData] = await Promise.all([
    fetchVaultData(ADDRESSES.USDC_VAULT, 6),
    fetchVaultData(ADDRESSES.WETH_VAULT, 18),
    fetchLendleData(),
  ])

  // Check if rebalance is needed
  const shouldRebalance = usdcVault.needsRebalance || wethVault.needsRebalance

  return {
    timestamp,
    vaults: {
      usdc: usdcVault,
      weth: wethVault,
    },
    protocols: {
      lendle: lendleData,
      meth: {
        stakingAPY: 3.5, // Approximate mETH staking yield
        exchangeRate: 1.02, // mETH/ETH rate
      },
    },
    recommendations: {
      shouldRebalance,
      reason: shouldRebalance
        ? 'Allocation has drifted from target. Rebalance recommended.'
        : 'Allocation within acceptable range.',
    },
  }
}

async function fetchVaultData(vaultAddress: string, decimals: number): Promise<VaultData> {
  const [totalAssets, weightedAPY, adaptersCount, needsRebalance] = await Promise.all([
    client.readContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'totalAssets',
    }),
    client.readContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'getWeightedAPY',
    }),
    client.readContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'getAdaptersCount',
    }),
    client.readContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'needsRebalance',
    }),
  ])

  // Fetch adapter info
  const adapters: AdapterData[] = []
  for (let i = 0; i < Number(adaptersCount); i++) {
    const [adapterAddress, allocation, deposited, active] = await client.readContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'getAdapterInfo',
      args: [BigInt(i)],
    })

    let adapterAPY = 0
    try {
      adapterAPY = Number(await client.readContract({
        address: adapterAddress,
        abi: ADAPTER_ABI,
        functionName: 'getAPY',
      })) / 100
    } catch {}

    adapters.push({
      address: adapterAddress,
      allocation: Number(allocation) / 100, // bps to percent
      deposited: formatUnits(deposited, decimals),
      depositedRaw: deposited,
      apy: adapterAPY,
      active,
    })
  }

  return {
    address: vaultAddress,
    tvl: formatUnits(totalAssets, decimals),
    tvlRaw: totalAssets,
    apy: Number(weightedAPY) / 100,
    adapters,
    needsRebalance,
  }
}

async function fetchLendleData(): Promise<LendleData> {
  const [usdcReserve, wethReserve] = await Promise.all([
    client.readContract({
      address: ADDRESSES.LENDLE_DATA_PROVIDER as `0x${string}`,
      abi: LENDLE_DATA_PROVIDER_ABI,
      functionName: 'getReserveData',
      args: [ADDRESSES.USDC as `0x${string}`],
    }),
    client.readContract({
      address: ADDRESSES.LENDLE_DATA_PROVIDER as `0x${string}`,
      abi: LENDLE_DATA_PROVIDER_ABI,
      functionName: 'getReserveData',
      args: [ADDRESSES.WETH as `0x${string}`],
    }),
  ])

  // Calculate utilization
  const usdcTotal = usdcReserve[0] + usdcReserve[1] + usdcReserve[2]
  const usdcUtilization = usdcTotal > 0n ? Number((usdcReserve[1] + usdcReserve[2]) * 10000n / usdcTotal) / 100 : 0

  const wethTotal = wethReserve[0] + wethReserve[1] + wethReserve[2]
  const wethUtilization = wethTotal > 0n ? Number((wethReserve[1] + wethReserve[2]) * 10000n / wethTotal) / 100 : 0

  return {
    usdcSupplyAPY: rayToPercent(usdcReserve[3]),
    usdcBorrowAPY: rayToPercent(usdcReserve[4]),
    usdcUtilization,
    wethSupplyAPY: rayToPercent(wethReserve[3]),
    wethBorrowAPY: rayToPercent(wethReserve[4]),
    wethUtilization,
  }
}

export { ADDRESSES }
