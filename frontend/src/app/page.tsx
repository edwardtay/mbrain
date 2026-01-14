'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

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

interface UserPortfolio {
  usdc: { shares: string; value: string }
  weth: { shares: string; value: string }
}

export default function Home() {
  const [data, setData] = useState<ProtocolData | null>(null)
  const [rec, setRec] = useState<AIRecommendation | null>(null)
  const [keeper, setKeeper] = useState<KeeperStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [wallet, setWallet] = useState<string | null>(null)
  const [walletMenuOpen, setWalletMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [portfolio, setPortfolio] = useState<UserPortfolio | null>(null)
  const walletMenuRef = useRef<HTMLDivElement>(null)

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
          try {
            await (window as any).ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x1388' }],
            })
          } catch (switchError: any) {
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

  const fetchPortfolio = useCallback(async () => {
    if (!wallet || typeof window === 'undefined') return
    try {
      const ethereum = (window as any).ethereum
      const usdcSharesHex = await ethereum.request({
        method: 'eth_call',
        params: [{ to: VAULT_ADDRESSES.usdc, data: '0x70a08231000000000000000000000000' + wallet.slice(2).toLowerCase() }, 'latest'],
      })
      const wethSharesHex = await ethereum.request({
        method: 'eth_call',
        params: [{ to: VAULT_ADDRESSES.weth, data: '0x70a08231000000000000000000000000' + wallet.slice(2).toLowerCase() }, 'latest'],
      })
      const usdcShares = BigInt(usdcSharesHex || '0x0')
      const wethShares = BigInt(wethSharesHex || '0x0')
      setPortfolio({
        usdc: { shares: (Number(usdcShares) / 1e6).toFixed(2), value: (Number(usdcShares) / 1e6).toFixed(2) },
        weth: { shares: (Number(wethShares) / 1e18).toFixed(6), value: (Number(wethShares) / 1e18).toFixed(6) },
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
      const [d, k] = await Promise.all([
        fetch(`${API_URL}/api/data`).then(r => r.ok ? r.json() : null),
        fetch(`${API_URL}/api/keeper/status`).then(r => r.ok ? r.json() : null),
      ])
      if (d) setData(d)
      if (k) setKeeper(k)
    } catch {} finally { setLoading(false) }
  }

  const analyze = async () => {
    setAnalyzing(true)
    try {
      const res = await fetch(`${API_URL}/api/analyze`, { method: 'POST' })
      if (res.ok) {
        const result = await res.json()
        setData(result.data)
        setRec(result.recommendation)
      }
    } catch {} finally { setAnalyzing(false) }
  }

  useEffect(() => {
    fetchData()
    const i = setInterval(fetchData, 30000)
    return () => clearInterval(i)
  }, [])

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    return `${Math.floor(seconds / 3600)}h ago`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="w-10 h-10" />
            <span className="text-lg font-bold">Mantle Maven</span>
          </div>

          <div className="relative" ref={walletMenuRef}>
            <button
              onClick={() => wallet ? setWalletMenuOpen(!walletMenuOpen) : connectWallet()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg text-sm font-semibold transition-all"
            >
              {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : 'Connect Wallet'}
            </button>

            {walletMenuOpen && wallet && (
              <div className="absolute right-0 mt-2 w-48 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl z-50">
                <div className="p-3 border-b border-white/10">
                  <div className="text-xs text-white/50">Connected</div>
                  <div className="text-sm font-mono mt-1">{wallet.slice(0, 8)}...{wallet.slice(-6)}</div>
                </div>
                <button onClick={copyAddress} className="w-full px-3 py-2 text-left text-sm hover:bg-white/5">
                  {copied ? 'Copied!' : 'Copy Address'}
                </button>
                <a href={`https://explorer.mantle.xyz/address/${wallet}`} target="_blank" rel="noopener noreferrer" className="block px-3 py-2 text-sm hover:bg-white/5">
                  View on Explorer
                </a>
                <button onClick={disconnectWallet} className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-white/5">
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Hero - Vault Performance */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="p-6 bg-gradient-to-br from-blue-900/30 to-blue-900/10 border border-blue-500/20 rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-white/60">USDC Vault</span>
              <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-300 rounded">Stablecoin</span>
            </div>
            <div className="text-4xl font-bold text-blue-400">{data?.vaults?.usdc?.apy?.toFixed(1) || '0'}%</div>
            <div className="text-sm text-white/50 mt-1">APY</div>
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-xs text-white/40">TVL</div>
              <div className="text-lg font-semibold">${parseFloat(data?.vaults?.usdc?.tvl || '0').toFixed(0)}</div>
            </div>
          </div>

          <div className="p-6 bg-gradient-to-br from-purple-900/30 to-purple-900/10 border border-purple-500/20 rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-white/60">WETH Vault</span>
              <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-300 rounded">ETH Yield</span>
            </div>
            <div className="text-4xl font-bold text-purple-400">{data?.vaults?.weth?.apy?.toFixed(1) || '0'}%</div>
            <div className="text-sm text-white/50 mt-1">APY</div>
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-xs text-white/40">TVL</div>
              <div className="text-lg font-semibold">{parseFloat(data?.vaults?.weth?.tvl || '0').toFixed(4)} WETH</div>
            </div>
          </div>
        </div>

        {/* Your Portfolio */}
        {wallet && portfolio && (
          <div className="p-5 bg-white/[0.03] border border-white/10 rounded-2xl">
            <h2 className="text-sm font-semibold text-white/60 mb-4">Your Deposits</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                <div>
                  <div className="text-xs text-white/50">USDC Vault</div>
                  <div className="text-xl font-bold">${portfolio.usdc.value}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-white/50">Earning</div>
                  <div className="text-sm text-emerald-400">{data?.vaults?.usdc?.apy?.toFixed(1)}% APY</div>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                <div>
                  <div className="text-xs text-white/50">WETH Vault</div>
                  <div className="text-xl font-bold">{portfolio.weth.value}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-white/50">Earning</div>
                  <div className="text-sm text-emerald-400">{data?.vaults?.weth?.apy?.toFixed(1)}% APY</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI Analysis Section */}
        <div className="p-6 bg-white/[0.02] border border-white/10 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">AI Analysis</h2>
              <p className="text-sm text-white/50">Powered by Claude</p>
            </div>
            <button
              onClick={analyze}
              disabled={analyzing}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/50 text-black rounded-lg text-sm font-semibold transition-all"
            >
              {analyzing ? 'Analyzing...' : 'Analyze Vaults'}
            </button>
          </div>

          {!rec && !analyzing && (
            <div className="text-center py-8 text-white/40">
              Click "Analyze Vaults" to get AI-powered yield insights
            </div>
          )}

          {analyzing && (
            <div className="flex items-center justify-center gap-3 py-8">
              <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-white/60">Analyzing market conditions...</span>
            </div>
          )}

          {rec && !analyzing && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className={`text-2xl font-bold ${rec.action === 'HOLD' ? 'text-emerald-400' : rec.action === 'REBALANCE' ? 'text-amber-400' : 'text-blue-400'}`}>
                  {rec.action}
                </span>
                <span className="text-sm text-white/50">{rec.confidence}% confidence</span>
                <span className="text-xs text-white/30">{formatTimeAgo(rec.timestamp)}</span>
              </div>

              <p className="text-white/80 leading-relaxed">{rec.reasoning}</p>

              <div className="grid sm:grid-cols-2 gap-3 mt-4">
                <div className="p-4 bg-black/30 rounded-lg">
                  <div className="text-sm font-semibold text-blue-400 mb-2">USDC Vault</div>
                  <p className="text-sm text-white/70">{rec.details?.usdcVault?.suggestedAction || 'No action needed'}</p>
                </div>
                <div className="p-4 bg-black/30 rounded-lg">
                  <div className="text-sm font-semibold text-purple-400 mb-2">WETH Vault</div>
                  <p className="text-sm text-white/70">{rec.details?.wethVault?.suggestedAction || 'No action needed'}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Allocation Breakdown */}
        {data && (
          <div className="grid sm:grid-cols-2 gap-4">
            {(['usdc', 'weth'] as const).map((vault) => {
              const v = vault === 'usdc' ? data.vaults.usdc : data.vaults.weth
              return (
                <div key={vault} className="p-5 bg-white/[0.02] border border-white/10 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-semibold">{vault.toUpperCase()} Allocation</span>
                    {v.needsRebalance && (
                      <span className="text-xs px-2 py-1 bg-amber-500/20 text-amber-400 rounded">Drift Detected</span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {v.adapters.map((a, i) => (
                      <div key={i}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-white/60">{i === 0 ? 'Lendle' : 'mETH Staking'}</span>
                          <span className="text-emerald-400">{a.apy.toFixed(1)}% APY</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${vault === 'usdc' ? 'bg-blue-500' : 'bg-purple-500'}`}
                              style={{ width: `${a.allocation}%` }}
                            />
                          </div>
                          <span className="text-sm text-white/70 w-12 text-right">{a.allocation}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Protocol Rates */}
        {data && (
          <div className="p-5 bg-white/[0.02] border border-white/10 rounded-2xl">
            <h3 className="text-sm font-semibold text-white/60 mb-4">Underlying Protocol Rates</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-white/40">Lendle USDC</div>
                <div className="text-lg font-semibold">{data.protocols?.lendle?.usdcSupplyAPY?.toFixed(1) || '0'}%</div>
                <div className="text-xs text-white/30">{data.protocols?.lendle?.usdcUtilization?.toFixed(0)}% util</div>
              </div>
              <div>
                <div className="text-xs text-white/40">Lendle WETH</div>
                <div className="text-lg font-semibold">{data.protocols?.lendle?.wethSupplyAPY?.toFixed(1) || '0'}%</div>
                <div className="text-xs text-white/30">{data.protocols?.lendle?.wethUtilization?.toFixed(0)}% util</div>
              </div>
              <div>
                <div className="text-xs text-white/40">mETH Staking</div>
                <div className="text-lg font-semibold">{data.protocols?.meth?.stakingAPY?.toFixed(1) || '0'}%</div>
                <div className="text-xs text-white/30">{data.protocols?.meth?.exchangeRate?.toFixed(3)} rate</div>
              </div>
              <div>
                <div className="text-xs text-white/40">Keeper</div>
                <div className="text-lg font-semibold">{keeper?.address ? 'Active' : 'Inactive'}</div>
                <div className="text-xs text-white/30">{parseFloat(keeper?.balance || '0').toFixed(2)} MNT</div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-12">
        <div className="max-w-4xl mx-auto px-4 py-6 text-center">
          <p className="text-sm text-white/40">
            Mantle Maven - AI-Powered Yield Optimization for mYield Vaults
          </p>
          <p className="text-xs text-white/30 mt-2">
            Not financial advice. Smart contracts are unaudited.
          </p>
        </div>
      </footer>
    </div>
  )
}
