'use client'

import { useState, useEffect, useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

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

export default function Home() {
  const [data, setData] = useState<ProtocolData | null>(null)
  const [rec, setRec] = useState<AIRecommendation | null>(null)
  const [keeper, setKeeper] = useState<KeeperStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [agent, setAgent] = useState<AgentConfig>({ enabled: false, threshold: 80 })
  const [thinking, setThinking] = useState<string | null>(null)

  const fetchData = async () => {
    try {
      const [d, r, k] = await Promise.all([
        fetch(`${API_URL}/api/data`).then(r => r.ok ? r.json() : null),
        fetch(`${API_URL}/api/recommendation`).then(r => r.ok ? r.json() : null),
        fetch(`${API_URL}/api/keeper/status`).then(r => r.ok ? r.json() : null),
      ])
      if (d) setData(d)
      if (r) setRec(r)
      if (k) setKeeper(k)
    } catch {} finally { setLoading(false) }
  }

  const analyze = async () => {
    setAnalyzing(true)
    setThinking('Analyzing...')
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
    setThinking(`Executing ${action}...`)
    try {
      await fetch(`${API_URL}/api/keeper/${action}/${vault}`, { method: 'POST' })
      setTimeout(fetchData, 2000)
    } catch {} finally { setThinking(null) }
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

  const actionStyles = {
    HOLD: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-400',
    REBALANCE: 'from-amber-500/20 to-amber-600/10 border-amber-500/30 text-amber-400',
    HARVEST: 'from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-400',
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="w-9 h-9" />
            <span className="text-lg font-semibold tracking-tight">mBrain</span>
          </div>
          <button
            onClick={analyze}
            disabled={analyzing}
            className="px-5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-sm font-medium transition-all disabled:opacity-50"
          >
            {analyzing ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {/* Thinking Banner */}
        {thinking && (
          <div className="flex items-center gap-3 px-4 py-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
            <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
            <span className="text-sm text-purple-300">{thinking}</span>
          </div>
        )}

        {/* Agent Toggle */}
        <div className="flex items-center justify-between p-5 bg-gradient-to-r from-white/[0.03] to-transparent border border-white/5 rounded-2xl">
          <div className="flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full transition-colors ${agent.enabled ? 'bg-emerald-400' : 'bg-white/20'}`} />
            <div>
              <div className="font-medium">Autonomous Mode</div>
              <div className="text-xs text-white/40 mt-0.5">Auto-execute at {agent.threshold}% confidence</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="50"
              max="95"
              value={agent.threshold}
              onChange={(e) => setAgent(a => ({ ...a, threshold: +e.target.value }))}
              className="w-24 accent-purple-500"
            />
            <button
              onClick={() => setAgent(a => ({ ...a, enabled: !a.enabled }))}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                agent.enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-white/50 border border-white/10'
              }`}
            >
              {agent.enabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* AI Recommendation */}
        {rec && (
          <div className={`p-6 bg-gradient-to-br ${actionStyles[rec.action]} border rounded-2xl`}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="text-2xl font-bold">{rec.action}</div>
                <div className="text-white/40 text-sm mt-1">{rec.confidence}% confidence</div>
              </div>
              <div className="text-xs text-white/30">Claude</div>
            </div>

            <p className="text-white/70 text-sm leading-relaxed mb-6">{rec.reasoning}</p>

            <div className="grid md:grid-cols-2 gap-4">
              {['usdc', 'weth'].map((vault) => {
                const v = vault === 'usdc' ? rec.details.usdcVault : rec.details.wethVault
                const vaultData = vault === 'usdc' ? data?.vaults.usdc : data?.vaults.weth
                return (
                  <div key={vault} className="p-4 bg-black/20 rounded-xl">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium">{vault.toUpperCase()}</span>
                      <span className="text-emerald-400 text-sm">{vaultData?.apy.toFixed(1)}%</span>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed">{v.suggestedAction}</p>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => execute('rebalance', vault)}
                        className="px-3 py-1 text-xs bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                      >
                        Rebalance
                      </button>
                      <button
                        onClick={() => execute('harvest', vault)}
                        className="px-3 py-1 text-xs bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                      >
                        Harvest
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid md:grid-cols-4 gap-4">
          {/* USDC Vault */}
          {data?.vaults.usdc && (
            <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
              <div className="text-xs text-white/40 mb-1">USDC Vault</div>
              <div className="text-2xl font-semibold">{data.vaults.usdc.apy.toFixed(1)}%</div>
              <div className="text-xs text-white/30 mt-2">${parseFloat(data.vaults.usdc.tvl).toFixed(0)} TVL</div>
            </div>
          )}

          {/* WETH Vault */}
          {data?.vaults.weth && (
            <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
              <div className="text-xs text-white/40 mb-1">WETH Vault</div>
              <div className="text-2xl font-semibold">{data.vaults.weth.apy.toFixed(1)}%</div>
              <div className="text-xs text-white/30 mt-2">{parseFloat(data.vaults.weth.tvl).toFixed(4)} TVL</div>
            </div>
          )}

          {/* Lendle */}
          {data?.protocols.lendle && (
            <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
              <div className="text-xs text-white/40 mb-1">Lendle USDC</div>
              <div className="text-2xl font-semibold">{data.protocols.lendle.usdcSupplyAPY.toFixed(1)}%</div>
              <div className="text-xs text-white/30 mt-2">{data.protocols.lendle.usdcUtilization.toFixed(0)}% utilized</div>
            </div>
          )}

          {/* mETH */}
          {data?.protocols.meth && (
            <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
              <div className="text-xs text-white/40 mb-1">mETH Staking</div>
              <div className="text-2xl font-semibold">{data.protocols.meth.stakingAPY.toFixed(1)}%</div>
              <div className="text-xs text-white/30 mt-2">{data.protocols.meth.exchangeRate} rate</div>
            </div>
          )}
        </div>

        {/* Keeper Status */}
        {keeper && (
          <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-xl text-sm">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${keeper.address ? 'bg-emerald-400' : 'bg-white/20'}`} />
              <span className="font-mono text-white/50">
                {keeper.address ? `${keeper.address.slice(0, 6)}...${keeper.address.slice(-4)}` : 'Keeper not configured'}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-white/40">
              <span>{parseFloat(keeper.balance || '0').toFixed(2)} MNT</span>
              <span className={keeper.isAuthorized?.usdcVault ? 'text-emerald-400' : ''}>USDC {keeper.isAuthorized?.usdcVault ? '✓' : '✗'}</span>
              <span className={keeper.isAuthorized?.wethVault ? 'text-emerald-400' : ''}>WETH {keeper.isAuthorized?.wethVault ? '✓' : '✗'}</span>
            </div>
          </div>
        )}

        {/* Allocation Breakdown */}
        {data && (
          <div className="grid md:grid-cols-2 gap-4">
            {['usdc', 'weth'].map((vault) => {
              const v = vault === 'usdc' ? data.vaults.usdc : data.vaults.weth
              return (
                <div key={vault} className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium">{vault.toUpperCase()} Allocation</span>
                    {v.needsRebalance && <span className="text-xs text-amber-400">Drift detected</span>}
                  </div>
                  <div className="space-y-2">
                    {v.adapters.map((a, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                            style={{ width: `${a.allocation}%` }}
                          />
                        </div>
                        <span className="text-xs text-white/50 w-12 text-right">{a.allocation}%</span>
                        <span className="text-xs text-emerald-400 w-12 text-right">{a.apy.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-16">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between text-xs text-white/30 mb-3">
            <span>mBrain</span>
            <span>Autonomous yield optimization</span>
          </div>
          <p className="text-[10px] text-white/20 text-center">
            Not financial advice. Use at your own risk. Smart contracts are unaudited.
          </p>
        </div>
      </footer>
    </div>
  )
}
