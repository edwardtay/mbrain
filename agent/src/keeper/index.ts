import { createWalletClient, createPublicClient, http, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mantle } from 'viem/chains'
import { ADDRESSES } from '../oracle/index.js'

// Vault ABI for keeper functions
const VAULT_ABI = [
  { name: 'rebalance', type: 'function', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { name: 'harvest', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' },
  { name: 'needsRebalance', type: 'function', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { name: 'keeper', type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'owner', type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

export interface ExecutionResult {
  success: boolean
  txHash?: string
  error?: string
  gasUsed?: string
  timestamp: number
}

export interface KeeperStatus {
  address: string
  balance: string
  isAuthorized: {
    usdcVault: boolean
    wethVault: boolean
  }
}

// Create clients
const publicClient = createPublicClient({
  chain: mantle,
  transport: http('https://rpc.mantle.xyz'),
})

let walletClient: ReturnType<typeof createWalletClient> | null = null
let account: ReturnType<typeof privateKeyToAccount> | null = null

export function initializeKeeper(privateKey: string) {
  account = privateKeyToAccount(privateKey as `0x${string}`)
  walletClient = createWalletClient({
    account,
    chain: mantle,
    transport: http('https://rpc.mantle.xyz'),
  })
  console.log(`Keeper initialized: ${account.address}`)
}

export async function getKeeperStatus(): Promise<KeeperStatus> {
  if (!account) {
    return {
      address: 'Not initialized',
      balance: '0',
      isAuthorized: { usdcVault: false, wethVault: false },
    }
  }

  const [balance, usdcKeeper, wethKeeper, usdcOwner, wethOwner] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: ADDRESSES.USDC_VAULT as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'keeper',
    }),
    publicClient.readContract({
      address: ADDRESSES.WETH_VAULT as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'keeper',
    }),
    publicClient.readContract({
      address: ADDRESSES.USDC_VAULT as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'owner',
    }),
    publicClient.readContract({
      address: ADDRESSES.WETH_VAULT as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'owner',
    }),
  ])

  return {
    address: account.address,
    balance: formatEther(balance),
    isAuthorized: {
      usdcVault: usdcKeeper.toLowerCase() === account.address.toLowerCase() ||
                  usdcOwner.toLowerCase() === account.address.toLowerCase(),
      wethVault: wethKeeper.toLowerCase() === account.address.toLowerCase() ||
                  wethOwner.toLowerCase() === account.address.toLowerCase(),
    },
  }
}

export async function executeRebalance(vault: 'usdc' | 'weth'): Promise<ExecutionResult> {
  if (!walletClient || !account) {
    return {
      success: false,
      error: 'Keeper not initialized',
      timestamp: Date.now(),
    }
  }

  const vaultAddress = vault === 'usdc' ? ADDRESSES.USDC_VAULT : ADDRESSES.WETH_VAULT

  try {
    // Check if rebalance is needed
    const needsRebalance = await publicClient.readContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'needsRebalance',
    })

    if (!needsRebalance) {
      return {
        success: false,
        error: 'Rebalance not needed',
        timestamp: Date.now(),
      }
    }

    // Simulate first
    const { request } = await publicClient.simulateContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'rebalance',
      account: account.address,
    })

    // Execute
    const hash = await walletClient.writeContract(request)

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    return {
      success: receipt.status === 'success',
      txHash: hash,
      gasUsed: receipt.gasUsed.toString(),
      timestamp: Date.now(),
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error',
      timestamp: Date.now(),
    }
  }
}

export async function executeHarvest(vault: 'usdc' | 'weth'): Promise<ExecutionResult> {
  if (!walletClient || !account) {
    return {
      success: false,
      error: 'Keeper not initialized',
      timestamp: Date.now(),
    }
  }

  const vaultAddress = vault === 'usdc' ? ADDRESSES.USDC_VAULT : ADDRESSES.WETH_VAULT

  try {
    // Simulate first
    const { request } = await publicClient.simulateContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'harvest',
      account: account.address,
    })

    // Execute
    const hash = await walletClient.writeContract(request)

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    return {
      success: receipt.status === 'success',
      txHash: hash,
      gasUsed: receipt.gasUsed.toString(),
      timestamp: Date.now(),
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error',
      timestamp: Date.now(),
    }
  }
}

// Execution history
const executionHistory: ExecutionResult[] = []

export function addExecutionToHistory(result: ExecutionResult) {
  executionHistory.unshift(result)
  if (executionHistory.length > 50) {
    executionHistory.pop()
  }
}

export function getExecutionHistory(): ExecutionResult[] {
  return executionHistory
}
