'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

// Vault contract addresses on Mantle
const VAULT_ADDRESSES = {
  usdc: '0xcfF09905F8f18B35F5A1Ba6d2822D62B3d8c48bE',
  weth: '0x073b61f5Ed26d802b05301e0E019f78Ac1A41D23',
}

interface ProtocolData {
  timestamp: number
  vaults: { usdc: VaultData; weth: VaultData }
  protocols: { lendle: LendleData; meth: MethData }
}

interface VaultData {
  address: string
  tvl: string
  apy: number
  needsRebalance: boolean
  adapters: { address: string; allocation: number; deposited: string; apy: number; active: boolean }[]
}

interface LendleData {
  usdcSupplyAPY: number
  usdcUtilization: number
  wethSupplyAPY: number
  wethUtilization: number
}

interface MethData {
  stakingAPY: number
  exchangeRate: number
}

interface AIRecommendation {
  action: 'HOLD' | 'REBALANCE' | 'HARVEST'
  confidence: number
  reasoning: string
  details: {
    usdcVault: { suggestedAction: string; allocationAnalysis: string }
    wethVault: { suggestedAction: string; allocationAnalysis: string }
  }
  marketAnalysis: string
  riskAssessment: string
  timestamp: number
}

interface KeeperStatus {
  address: string | null
  balance: string
  isAuthorized: { usdcVault: boolean; wethVault: boolean }
}

interface AgentConfig {
  enabled: boolean
  threshold: number
}

interface ExecutionRecord {
  timestamp: number
  action: string
  vault: string
  txHash?: string
  status: 'success' | 'failed'
  gasUsed?: string
}

interface UserPortfolio {
  usdc: { shares: string; value: string }
  weth: { shares: string; value: string }
}

// ERC20 balanceOf ABI
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ type: 'address', name: 'account' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'convertToAssets',
    type: 'function',
    inputs: [{ type: 'uint256', name: 'shares' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
]

export default function Home() {
  const [data, setData] = useState<ProtocolData | null>(null)
  const [rec, setRec] = useState<AIRecommendation | null>(null)
  const [keeper, setKeeper] = useState<KeeperStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [agent, setAgent] = useState<AgentConfig>({ enabled: false, threshold: 80 })
  const [thinking, setThinking] = useState<string | null>(null)
  const [wallet, setWallet] = useState<string | null>(null)
  const [walletMenuOpen, setWalletMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [portfolio, setPortfolio] = useState<UserPortfolio | null>(null)
  const [history, setHistory] = useState<ExecutionRecord[]>([])
  const [apyHistory, setApyHistory] = useState<{ timestamp: number; usdcApy: number; wethApy: number }[]>([])
  const walletMenuRef = useRef<HTMLDivElement>(null)

  // Close wallet menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (walletMenuRef.current && !walletMenuRef.current.contains(e.target as Node)) {
        setWalletMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const connectWallet = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' })
        if (accounts[0]) {
          setWallet(accounts[0])
          // Switch to Mantle network
          try {
            await (window as any).ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x1388' }], // 5000 in hex
            })
          } catch (switchError: any) {
            // Chain not added, add it
            if (switchError.code === 4902) {
              await (window as any).ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: '0x1388',
                  chainName: 'Mantle',
                  nativeCurrency: { name: 'MNT', symbol: 'MNT', decimals: 18 },
                  rpcUrls: ['https://rpc.mantle.xyz'],
                  blockExplorerUrls: ['https://explorer.mantle.xyz'],
                }],
              })
            }
          }
        }
      } catch {}
    } else {
      alert('Please install MetaMask')
    }
  }

  const disconnectWallet = () => {
    setWallet(null)
    setPortfolio(null)
    setWalletMenuOpen(false)
  }

  const copyAddress = async () => {
    if (wallet) {
      await navigator.clipboard.writeText(wallet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Fetch user portfolio when wallet connected
  const fetchPortfolio = useCallback(async () => {
    if (!wallet || typeof window === 'undefined') return

    try {
      const ethereum = (window as any).ethereum

      // Fetch USDC vault balance
      const usdcSharesHex = await ethereum.request({
        method: 'eth_call',
        params: [{
          to: VAULT_ADDRESSES.usdc,
          data: '0x70a08231000000000000000000000000' + wallet.slice(2).toLowerCase(),
        }, 'latest'],
      })

      // Fetch WETH vault balance
      const wethSharesHex = await ethereum.request({
        method: 'eth_call',
        params: [{
          to: VAULT_ADDRESSES.weth,
          data: '0x70a08231000000000000000000000000' + wallet.slice(2).toLowerCase(),
        }, 'latest'],
      })

      const usdcShares = BigInt(usdcSharesHex || '0x0')
      const wethShares = BigInt(wethSharesHex || '0x0')

      // Convert to assets (simplified - assumes 1:1 for display)
      setPortfolio({
        usdc: {
          shares: (Number(usdcShares) / 1e6).toFixed(2),
          value: (Number(usdcShares) / 1e6).toFixed(2)
        },
        weth: {
          shares: (Number(wethShares) / 1e18).toFixed(6),
          value: (Number(wethShares) / 1e18).toFixed(6)
        },
      })
    } catch (e) {
      console.error('Failed to fetch portfolio:', e)
    }
  }, [wallet])

  useEffect(() => {
    if (wallet) {
      fetchPortfolio()
      const interval = setInterval(fetchPortfolio, 30000)
      return () => clearInterval(interval)
    }
  }, [wallet, fetchPortfolio])

  const fetchData = async () => {
    try {
      // Only fetch data and keeper status on initial load (not recommendation)
      const [d, k, h] = await Promise.all([
        fetch(`${API_URL}/api/data`).then(r => r.ok ? r.json() : null),
        fetch(`${API_URL}/api/keeper/status`).then(r => r.ok ? r.json() : null),
        fetch(`${API_URL}/api/keeper/history`).then(r => r.ok ? r.json() : []),
      ])
      if (d) {
        setData(d)
        // Track APY history
        setApyHistory(prev => {
          const newEntry = {
            timestamp: Date.now(),
            usdcApy: d.vaults.usdc.apy,
            wethApy: d.vaults.weth.apy
          }
          const updated = [...prev, newEntry].slice(-20) // Keep last 20 entries
          return updated
        })
      }
      if (k) setKeeper(k)
      if (h) setHistory(h)
    } catch {} finally { setLoading(false) }
  }

  const analyze = async () => {
    setAnalyzing(true)
    setThinking('Analyzing market conditions...')
    try {
      const res = await fetch(`${API_URL}/api/analyze`, { method: 'POST' })
      if (res.ok) {
        const result = await res.json()
        setData(result.data)
        setRec(result.recommendation)
      }
    } catch {} finally { setAnalyzing(false); setThinking(null) }
  }

  const execute = useCallback(async (action: string, vault: string) => {
    setThinking(`Executing ${action} on ${vault.toUpperCase()}...`)
    try {
      const res = await fetch(`${API_URL}/api/keeper/${action}/${vault}`, { method: 'POST' })
      if (res.ok) {
        const result = await res.json()
        // Show result feedback
        if (result.success) {
          setThinking(`${action} successful! Tx: ${result.txHash?.slice(0, 10)}...`)
        } else if (result.error) {
          setThinking(`${action} skipped: ${result.error}`)
        }
        // Add to local history immediately
        setHistory(prev => [{
          timestamp: Date.now(),
          action,
          vault,
          txHash: result.txHash,
          status: (result.success ? 'success' : 'failed') as 'success' | 'failed',
          gasUsed: result.gasUsed,
          error: result.error,
        }, ...prev].slice(0, 10))
        // Clear thinking after 3 seconds
        setTimeout(() => setThinking(null), 3000)
      }
      setTimeout(fetchData, 2000)
    } catch {} finally {
      setTimeout(() => setThinking(null), 3000)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const i = setInterval(fetchData, 30000)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    if (!agent.enabled || !rec || !keeper || !data) return
    if (rec.confidence >= agent.threshold && rec.action === 'REBALANCE') {
      if (data.vaults.weth.needsRebalance && keeper.isAuthorized.wethVault) {
        execute('rebalance', 'weth')
      }
    }
  }, [agent, rec, keeper, data, execute])

  // Check if on-chain rebalance is actually needed (not just AI recommendation)
  const canRebalance = (vault: 'usdc' | 'weth') => {
    const vaultData = vault === 'usdc' ? data?.vaults?.usdc : data?.vaults?.weth
    return vaultData?.needsRebalance === true
  }

  // Check if AI recommends action
  const aiRecommends = (vault: 'usdc' | 'weth') => {
    if (!rec?.details) return false
    const vaultRec = vault === 'usdc' ? rec.details.usdcVault : rec.details.wethVault
    const suggestion = vaultRec?.suggestedAction || ''
    return suggestion.toUpperCase().includes('REBALANCE')
  }

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090909] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#090909] text-white selection:bg-amber-500/20">
      {/* Header */}
      <header className="border-b border-white/[0.08]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="w-12 h-12 sm:w-16 sm:h-16" />
            <span className="text-lg sm:text-xl font-bold tracking-[-0.02em]">Mantle Maven</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={analyze}
              disabled={analyzing}
              className="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded-full text-sm font-medium transition-all disabled:opacity-40"
            >
              {analyzing ? 'Analyzing...' : 'Analyze'}
            </button>

            {/* Wallet Button with Dropdown */}
            <div className="relative" ref={walletMenuRef}>
              <button
                onClick={() => wallet ? setWalletMenuOpen(!walletMenuOpen) : connectWallet()}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-full text-sm font-semibold transition-all"
              >
                {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : 'Connect'}
              </button>

              {/* Wallet Dropdown Menu */}
              {walletMenuOpen && wallet && (
                <div className="absolute right-0 mt-2 w-48 bg-[#1a1a1a] border border-white/[0.1] rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="p-3 border-b border-white/[0.08]">
                    <div className="text-xs text-white/50 mb-1">Connected</div>
                    <div className="text-sm font-mono">{wallet.slice(0, 10)}...{wallet.slice(-8)}</div>
                  </div>
                  <button
                    onClick={copyAddress}
                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-white/[0.05] transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {copied ? 'Copied!' : 'Copy Address'}
                  </button>
                  <a
                    href={`https://explorer.mantle.xyz/address/${wallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-white/[0.05] transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    View on Explorer
                  </a>
                  <button
                    onClick={disconnectWallet}
                    className="w-full px-3 py-2.5 text-left text-sm text-red-400 hover:bg-white/[0.05] transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        {/* Thinking Banner */}
        {thinking && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            <span className="text-sm text-amber-200">{thinking}</span>
          </div>
        )}

        {/* User Portfolio - Only shown when connected */}
        {wallet && portfolio && (
          <div className="p-5 bg-gradient-to-r from-purple-900/20 to-pink-900/20 border border-purple-500/20 rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Your Portfolio</h2>
              <span className="text-xs text-white/50">On Mantle Maven</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="p-4 bg-black/30 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-white/70">USDC Vault</span>
                  <span className="text-xs text-emerald-400">{data?.vaults.usdc.apy.toFixed(1)}% APY</span>
                </div>
                <div className="text-2xl font-bold">${portfolio.usdc.value}</div>
                <div className="text-xs text-white/50 mt-1">{portfolio.usdc.shares} shares</div>
              </div>
              <div className="p-4 bg-black/30 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-white/70">WETH Vault</span>
                  <span className="text-xs text-emerald-400">{data?.vaults.weth.apy.toFixed(1)}% APY</span>
                </div>
                <div className="text-2xl font-bold">{portfolio.weth.value} WETH</div>
                <div className="text-xs text-white/50 mt-1">{portfolio.weth.shares} shares</div>
              </div>
            </div>
          </div>
        )}

        {/* Connect Prompt when disconnected */}
        {!wallet && (
          <div className="p-5 bg-white/[0.02] border border-white/[0.08] border-dashed rounded-2xl text-center">
            <div className="text-white/50 mb-3">Connect your wallet to view your portfolio</div>
            <button
              onClick={connectWallet}
              className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-full text-sm font-semibold transition-all"
            >
              Connect Wallet
            </button>
          </div>
        )}

        {/* Agent Toggle */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full transition-colors ${agent.enabled ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-white/30'}`} />
            <div>
              <div className="text-sm font-semibold">Autonomous Mode</div>
              <div className="text-xs text-white/70">Execute at {agent.threshold}% confidence</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="50"
              max="95"
              value={agent.threshold}
              onChange={(e) => setAgent(a => ({ ...a, threshold: +e.target.value }))}
              className="w-24 accent-amber-500 h-1.5"
            />
            <button
              onClick={() => setAgent(a => ({ ...a, enabled: !a.enabled }))}
              className={`w-14 h-7 rounded-full transition-all relative ${
                agent.enabled ? 'bg-emerald-500/30' : 'bg-white/10'
              }`}
            >
              <div className={`absolute top-1 w-5 h-5 rounded-full transition-all ${
                agent.enabled ? 'left-8 bg-emerald-400' : 'left-1 bg-white/50'
              }`} />
            </button>
          </div>
        </div>

        {/* AI Recommendation - Only show after clicking Analyze */}
        {!rec && !analyzing && (
          <div className="p-6 bg-white/[0.02] border border-white/[0.08] border-dashed rounded-2xl text-center">
            <div className="text-white/50 mb-3">Click "Analyze" to get AI-powered yield recommendations</div>
            <button
              onClick={analyze}
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-full text-sm font-semibold transition-all"
            >
              Analyze Now
            </button>
          </div>
        )}

        {rec && (
          <div className="p-5 sm:p-6 bg-gradient-to-b from-amber-950/30 to-amber-950/10 border border-amber-500/20 rounded-2xl">
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-amber-400">{rec.action}</div>
                <div className="text-white/80 text-sm mt-1">{rec.confidence}% confidence</div>
              </div>
              <div className="flex items-center gap-2">
                {rec.timestamp && (
                  <span className="text-xs text-white/40">{formatTimeAgo(rec.timestamp)}</span>
                )}
                <div className="text-xs text-white/60 font-medium px-2 py-1 bg-white/5 rounded">Claude AI</div>
              </div>
            </div>

            <p className="text-white/90 text-sm sm:text-base leading-relaxed mb-6">{rec.reasoning}</p>

            <div className="grid sm:grid-cols-2 gap-4">
              {(['usdc', 'weth'] as const).map((vault) => {
                const v = vault === 'usdc' ? rec.details?.usdcVault : rec.details?.wethVault
                const vaultData = vault === 'usdc' ? data?.vaults?.usdc : data?.vaults?.weth
                const readyToExecute = canRebalance(vault)
                const aiSuggests = aiRecommends(vault)

                return (
                  <div
                    key={vault}
                    className={`p-5 rounded-xl transition-all ${
                      readyToExecute
                        ? 'bg-amber-500/10 border-2 border-amber-500/40 shadow-[0_0_24px_rgba(245,158,11,0.15)]'
                        : aiSuggests
                        ? 'bg-purple-500/10 border border-purple-500/30'
                        : 'bg-black/30 border border-white/[0.08]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold">{vault.toUpperCase()}</span>
                        {readyToExecute && (
                          <span className="px-2 py-0.5 text-xs font-bold bg-amber-500/20 text-amber-400 rounded uppercase tracking-wide">
                            Ready
                          </span>
                        )}
                        {!readyToExecute && aiSuggests && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-purple-500/20 text-purple-300 rounded uppercase tracking-wide">
                            AI Suggests
                          </span>
                        )}
                      </div>
                      <span className={`text-base font-semibold ${readyToExecute ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {vaultData?.apy?.toFixed(1) || '0'}% APY
                      </span>
                    </div>

                    <p className="text-sm text-white/80 leading-relaxed mb-4">{v?.suggestedAction || 'Analyzing...'}</p>

                    <div className="flex gap-3">
                      {readyToExecute ? (
                        <>
                          <button
                            onClick={() => execute('rebalance', vault)}
                            className="flex-1 px-5 py-3 text-sm font-bold bg-amber-500 hover:bg-amber-400 text-black rounded-lg transition-all shadow-[0_0_24px_rgba(245,158,11,0.4)]"
                          >
                            Execute Rebalance
                          </button>
                          <button
                            onClick={() => execute('harvest', vault)}
                            className="px-4 py-3 text-sm font-medium bg-white/[0.08] hover:bg-white/[0.12] text-white/80 rounded-lg transition-all"
                          >
                            Harvest
                          </button>
                        </>
                      ) : (
                        <div className="flex items-center gap-3 text-sm text-white/50">
                          <span>Allocation within threshold</span>
                          <button
                            onClick={() => execute('harvest', vault)}
                            className="px-4 py-2 text-sm font-medium bg-white/[0.06] hover:bg-white/[0.1] text-white/70 rounded-lg transition-all"
                          >
                            Harvest
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Metrics Grid */}
        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'USDC Vault', value: data.vaults?.usdc?.apy?.toFixed(1) || '0', sub: `$${parseFloat(data.vaults?.usdc?.tvl || '0').toFixed(0)} TVL` },
              { label: 'WETH Vault', value: data.vaults?.weth?.apy?.toFixed(1) || '0', sub: `${parseFloat(data.vaults?.weth?.tvl || '0').toFixed(4)} TVL` },
              { label: 'Lendle', value: data.protocols?.lendle?.usdcSupplyAPY?.toFixed(1) || '0', sub: `${data.protocols?.lendle?.usdcUtilization?.toFixed(0) || '0'}% utilization` },
              { label: 'mETH Staking', value: data.protocols?.meth?.stakingAPY?.toFixed(1) || '0', sub: `${data.protocols?.meth?.exchangeRate || '1.0'} rate` },
            ].map((item, i) => (
              <div key={i} className="p-4 bg-white/[0.03] border border-white/[0.08] rounded-xl">
                <div className="text-xs text-white/60 mb-1 font-medium">{item.label}</div>
                <div className="text-2xl font-bold tracking-[-0.02em]">{item.value}%</div>
                <div className="text-xs text-white/50 mt-1">{item.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Execution History - Only show real transactions with txHash */}
        {history.filter(r => r?.txHash).length > 0 && (
          <div className="p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl">
            <h3 className="text-sm font-semibold mb-4">Execution History</h3>
            <div className="space-y-2">
              {history.filter(r => r?.txHash).slice(0, 5).map((record, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${record?.status === 'success' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-sm font-medium capitalize">{record?.action}</span>
                    <span className="text-xs text-white/50">{(record?.vault || '').toUpperCase()}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <a
                      href={`https://explorer.mantle.xyz/tx/${record.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-amber-400 hover:underline font-mono"
                    >
                      {record.txHash?.slice(0, 10)}...
                    </a>
                    <span className="text-xs text-white/40">{formatTimeAgo(record?.timestamp || Date.now())}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Keeper Status */}
        {keeper && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-white/[0.03] border border-white/[0.08] rounded-xl">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${keeper.address ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <div>
                <span className="text-sm font-mono text-white/80 whitespace-nowrap">
                  {keeper.address ? `${keeper.address.slice(0, 6)}...${keeper.address.slice(-4)}` : 'Not initialized'}
                </span>
                <span className="text-xs text-white/40 ml-2">Keeper Bot</span>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm text-white/60">
              <span>{parseFloat(keeper.balance || '0').toFixed(2)} MNT</span>
              <span className={keeper.isAuthorized?.usdcVault ? 'text-emerald-400' : ''}>
                USDC {keeper.isAuthorized?.usdcVault ? '✓' : '–'}
              </span>
              <span className={keeper.isAuthorized?.wethVault ? 'text-emerald-400' : ''}>
                WETH {keeper.isAuthorized?.wethVault ? '✓' : '–'}
              </span>
            </div>
          </div>
        )}

        {/* Allocations */}
        {data && (
          <div className="grid sm:grid-cols-2 gap-4">
            {(['usdc', 'weth'] as const).map((vault) => {
              const v = vault === 'usdc' ? data.vaults.usdc : data.vaults.weth
              const readyToExecute = canRebalance(vault)
              return (
                <div key={vault} className={`p-5 border rounded-xl ${readyToExecute ? 'bg-amber-500/5 border-amber-500/20' : 'bg-white/[0.03] border-white/[0.08]'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-semibold">{vault.toUpperCase()} Allocation</span>
                    {v.needsRebalance && <span className="text-xs text-amber-400 font-medium">Drift Detected</span>}
                  </div>
                  <div className="space-y-3">
                    {v.adapters.map((a, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="flex-1 h-2 bg-white/[0.08] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${readyToExecute ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-purple-500 to-pink-500'}`}
                            style={{ width: `${a.allocation}%` }}
                          />
                        </div>
                        <span className="text-sm text-white/70 w-10 text-right font-medium">{a.allocation}%</span>
                        <span className="text-sm text-emerald-400 w-14 text-right font-medium">{a.apy.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* APY Trend (Simple visualization) */}
        {apyHistory.length > 3 && (
          <div className="p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl">
            <h3 className="text-sm font-semibold mb-4">APY Trend (Session)</h3>
            <div className="flex items-end gap-1 h-16">
              {apyHistory.slice(-15).map((entry, i) => (
                <div key={i} className="flex-1 flex flex-col gap-1">
                  <div
                    className="bg-purple-500 rounded-sm"
                    style={{ height: `${Math.max(4, entry.usdcApy * 4)}px` }}
                    title={`USDC: ${entry.usdcApy.toFixed(1)}%`}
                  />
                  <div
                    className="bg-amber-500 rounded-sm"
                    style={{ height: `${Math.max(4, entry.wethApy * 8)}px` }}
                    title={`WETH: ${entry.wethApy.toFixed(1)}%`}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-white/50">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-purple-500 rounded-sm" />
                <span>USDC</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-amber-500 rounded-sm" />
                <span>WETH</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.08] mt-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-white/60 mb-3">
            <span className="font-semibold">Mantle Maven</span>
            <span>AI-Powered Yield Optimization on Mantle</span>
          </div>
          <p className="text-xs text-white/40 text-center">
            Not financial advice. Use at your own risk. Unaudited contracts.
          </p>
        </div>
      </footer>
    </div>
  )
}
