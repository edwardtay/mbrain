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
        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white/90 text-sm">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/icon.svg" alt="" className="w-8 h-8" />
            <span className="font-semibold">Mantle Maven</span>
          </div>
          <div className="relative" ref={walletMenuRef}>
            <button
              onClick={() => wallet ? setWalletMenuOpen(!walletMenuOpen) : connectWallet()}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded text-xs font-medium transition-all"
            >
              {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : 'Connect'}
            </button>
            {walletMenuOpen && wallet && (
              <div className="absolute right-0 mt-1 w-44 bg-[#141414] border border-white/10 rounded shadow-xl z-50 text-xs">
                <div className="p-2 border-b border-white/10">
                  <div className="text-white/40">Connected</div>
                  <div className="font-mono mt-0.5">{wallet.slice(0, 8)}...{wallet.slice(-6)}</div>
                </div>
                <button onClick={copyAddress} className="w-full px-2 py-1.5 text-left hover:bg-white/5">
                  {copied ? 'Copied!' : 'Copy Address'}
                </button>
                <a href={`https://explorer.mantle.xyz/address/${wallet}`} target="_blank" rel="noopener noreferrer" className="block px-2 py-1.5 hover:bg-white/5">
                  View on Explorer
                </a>
                <button onClick={disconnectWallet} className="w-full px-2 py-1.5 text-left text-red-400 hover:bg-white/5">
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-4 space-y-4">

        {/* Vault Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/50 text-xs">USDC Vault</span>
              <a href={`https://explorer.mantle.xyz/address/${VAULT_ADDRESSES.usdc}`} target="_blank" rel="noopener noreferrer" className="text-white/30 hover:text-white/50 text-xs">
                Verify ↗
              </a>
            </div>
            <div className="text-2xl font-bold">{data?.vaults?.usdc?.apy?.toFixed(1) || '0'}%</div>
            <div className="text-white/40 text-xs mt-1">${parseFloat(data?.vaults?.usdc?.tvl || '0').toFixed(0)} TVL</div>
          </div>
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/50 text-xs">WETH Vault</span>
              <a href={`https://explorer.mantle.xyz/address/${VAULT_ADDRESSES.weth}`} target="_blank" rel="noopener noreferrer" className="text-white/30 hover:text-white/50 text-xs">
                Verify ↗
              </a>
            </div>
            <div className="text-2xl font-bold">{data?.vaults?.weth?.apy?.toFixed(1) || '0'}%</div>
            <div className="text-white/40 text-xs mt-1">{parseFloat(data?.vaults?.weth?.tvl || '0').toFixed(4)} WETH TVL</div>
          </div>
        </div>

        {/* Portfolio */}
        {wallet && portfolio && (
          <div className="p-3 bg-white/[0.02] border border-white/10 rounded-lg">
            <div className="text-white/40 text-xs mb-2">Your Deposits</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex justify-between">
                <span className="text-white/60">USDC</span>
                <span className="font-medium">${portfolio.usdc.value}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">WETH</span>
                <span className="font-medium">{portfolio.weth.value}</span>
              </div>
            </div>
          </div>
        )}

        {/* AI Analysis */}
        <div className="p-4 bg-white/[0.02] border border-white/10 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-white/40">AI Analysis • Claude</div>
            <button
              onClick={analyze}
              disabled={analyzing}
              className="px-3 py-1 bg-white/10 hover:bg-white/15 disabled:opacity-50 rounded text-xs font-medium transition-all"
            >
              {analyzing ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>

          {!rec && !analyzing && (
            <div className="text-center py-6 text-white/30">
              Click Analyze for AI recommendations
            </div>
          )}

          {analyzing && (
            <div className="flex items-center justify-center gap-2 py-6">
              <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              <span className="text-white/40">Analyzing...</span>
            </div>
          )}

          {rec && !analyzing && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold ${rec.action === 'HOLD' ? 'text-green-400' : rec.action === 'REBALANCE' ? 'text-yellow-400' : 'text-white'}`}>
                  {rec.action}
                </span>
                <span className="text-white/40">{rec.confidence}%</span>
                <span className="text-white/20">{formatTimeAgo(rec.timestamp)}</span>
              </div>
              <p className="text-white/60 leading-relaxed">{rec.reasoning}</p>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <div className="p-2 bg-black/30 rounded text-xs">
                  <div className="text-white/40 mb-1">USDC</div>
                  <div className="text-white/70">{rec.details?.usdcVault?.suggestedAction || 'Hold'}</div>
                </div>
                <div className="p-2 bg-black/30 rounded text-xs">
                  <div className="text-white/40 mb-1">WETH</div>
                  <div className="text-white/70">{rec.details?.wethVault?.suggestedAction || 'Hold'}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Keeper Agent */}
        <div className="p-4 bg-white/[0.02] border border-white/10 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-2 h-2 rounded-full ${keeper?.address ? 'bg-green-400' : 'bg-white/20'}`} />
            <span className="text-xs text-white/40">AI Keeper Agent</span>
            <span className="text-xs text-white/20">{keeper?.address ? 'Active' : 'Inactive'}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs mb-3">
            <div>
              <div className="text-white/30">Wallet</div>
              <div className="font-mono text-white/60">
                {keeper?.address ? (
                  <a href={`https://explorer.mantle.xyz/address/${keeper.address}`} target="_blank" rel="noopener noreferrer" className="hover:text-white/80">
                    {keeper.address.slice(0, 8)}...{keeper.address.slice(-6)} ↗
                  </a>
                ) : 'Not configured'}
              </div>
            </div>
            <div>
              <div className="text-white/30">Authorization</div>
              <div className="flex gap-2 text-white/60">
                <span className={keeper?.isAuthorized?.usdcVault ? 'text-green-400' : ''}>
                  USDC {keeper?.isAuthorized?.usdcVault ? '✓' : '✗'}
                </span>
                <span className={keeper?.isAuthorized?.wethVault ? 'text-green-400' : ''}>
                  WETH {keeper?.isAuthorized?.wethVault ? '✓' : '✗'}
                </span>
              </div>
            </div>
          </div>

          {rec && rec.action === 'REBALANCE' && (
            <div className="p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs">
              <div className="text-yellow-400 font-medium mb-1">Planned Action</div>
              <div className="text-white/60">
                Will execute <span className="font-mono text-yellow-300">rebalance()</span> when drift threshold exceeded
              </div>
              <div className="text-white/40 mt-1">
                Status: {data?.vaults?.weth?.needsRebalance || data?.vaults?.usdc?.needsRebalance
                  ? 'Ready to execute' : 'Waiting for drift'}
              </div>
            </div>
          )}
        </div>

        {/* Allocations */}
        {data && (
          <div className="grid grid-cols-2 gap-3">
            {(['usdc', 'weth'] as const).map((vault) => {
              const v = vault === 'usdc' ? data.vaults.usdc : data.vaults.weth
              return (
                <div key={vault} className="p-3 bg-white/[0.02] border border-white/10 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-white/40">{vault.toUpperCase()} Allocation</span>
                    {v.needsRebalance && <span className="text-xs text-yellow-400">Drift</span>}
                  </div>
                  <div className="space-y-2">
                    {v.adapters.map((a, i) => (
                      <div key={i} className="text-xs">
                        <div className="flex justify-between text-white/50 mb-1">
                          <span>{i === 0 ? 'Lendle' : 'mETH'}</span>
                          <span>{a.apy.toFixed(1)}% • {a.allocation}%</span>
                        </div>
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-white/30 rounded-full" style={{ width: `${a.allocation}%` }} />
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
          <div className="p-3 bg-white/[0.02] border border-white/10 rounded-lg">
            <div className="text-xs text-white/40 mb-2">Protocol Rates</div>
            <div className="grid grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-white/30">Lendle USDC</div>
                <div className="font-medium">{data.protocols?.lendle?.usdcSupplyAPY?.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-white/30">Lendle WETH</div>
                <div className="font-medium">{data.protocols?.lendle?.wethSupplyAPY?.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-white/30">mETH Staking</div>
                <div className="font-medium">{data.protocols?.meth?.stakingAPY?.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-white/30">Gas Balance</div>
                <div className="font-medium">{parseFloat(keeper?.balance || '0').toFixed(2)} MNT</div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-8">
        <div className="max-w-4xl mx-auto px-4 py-4 text-center text-xs text-white/30">
          <div>Mantle Maven • AI Yield Optimization</div>
          <div className="mt-1">Contracts unaudited. Not financial advice.</div>
        </div>
      </footer>
    </div>
  )
}
