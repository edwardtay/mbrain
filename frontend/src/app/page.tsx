'use client'

import { useState, useEffect, useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface ProtocolData {
  timestamp: number
  vaults: {
    usdc: VaultData
    weth: VaultData
  }
  protocols: {
    lendle: LendleData
    meth: MethData
  }
}

interface VaultData {
  address: string
  tvl: string
  apy: number
  needsRebalance: boolean
  adapters: AdapterData[]
}

interface AdapterData {
  address: string
  allocation: number
  deposited: string
  apy: number
  active: boolean
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
  isAuthorized: {
    usdcVault: boolean
    wethVault: boolean
  }
}

interface AgentConfig {
  enabled: boolean
  confidenceThreshold: number
  autoRebalance: boolean
  autoHarvest: boolean
}

interface ExecutionLog {
  timestamp: number
  action: string
  vault: string
  success: boolean
  txHash?: string
  error?: string
  triggeredBy: 'agent' | 'manual'
}

interface ExecuteModalProps {
  isOpen: boolean
  onClose: () => void
  action: 'rebalance' | 'harvest'
  vault: 'usdc' | 'weth'
  onConfirm: () => void
  executing: boolean
}

function ExecuteModal({ isOpen, onClose, action, vault, onConfirm, executing }: ExecuteModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative bg-gray-900 rounded-2xl border border-gray-700 p-6 max-w-md w-full mx-4">
        <h3 className="text-xl font-bold mb-2">Confirm {action === 'rebalance' ? 'Rebalance' : 'Harvest'}</h3>
        <p className="text-gray-400 mb-4">
          You are about to execute <span className="text-purple-400 font-medium">{action}()</span> on the{' '}
          <span className="text-white font-medium">{vault.toUpperCase()} Vault</span>.
        </p>
        <div className="p-3 bg-yellow-900/20 border border-yellow-700/30 rounded-lg mb-4">
          <p className="text-yellow-400 text-sm">
            This will send a transaction to the blockchain. Make sure you understand the implications.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={executing}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={executing}
            className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg font-medium transition-colors"
          >
            {executing ? 'Executing...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [data, setData] = useState<ProtocolData | null>(null)
  const [recommendation, setRecommendation] = useState<AIRecommendation | null>(null)
  const [keeperStatus, setKeeperStatus] = useState<KeeperStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Agent mode state
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({
    enabled: false,
    confidenceThreshold: 80,
    autoRebalance: true,
    autoHarvest: false,
  })
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([])
  const [agentThinking, setAgentThinking] = useState<string | null>(null)

  // Execute modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalAction, setModalAction] = useState<'rebalance' | 'harvest'>('rebalance')
  const [modalVault, setModalVault] = useState<'usdc' | 'weth'>('usdc')
  const [executing, setExecuting] = useState(false)
  const [executionResult, setExecutionResult] = useState<{ success: boolean; message: string } | null>(null)

  const addExecutionLog = (log: Omit<ExecutionLog, 'timestamp'>) => {
    setExecutionLogs(prev => [{ ...log, timestamp: Date.now() }, ...prev].slice(0, 50))
  }

  const fetchData = async () => {
    try {
      const [dataRes, recRes, keeperRes] = await Promise.all([
        fetch(`${API_URL}/api/data`),
        fetch(`${API_URL}/api/recommendation`),
        fetch(`${API_URL}/api/keeper/status`),
      ])

      if (dataRes.ok) {
        setData(await dataRes.json())
      }
      if (recRes.ok) {
        setRecommendation(await recRes.json())
      }
      if (keeperRes.ok) {
        setKeeperStatus(await keeperRes.json())
      }
      setError(null)
    } catch (err) {
      setError('Failed to connect to mBrain agent. Is it running?')
    } finally {
      setLoading(false)
    }
  }

  const runAnalysis = async () => {
    setAnalyzing(true)
    setAgentThinking('Fetching latest protocol data...')
    try {
      const res = await fetch(`${API_URL}/api/analyze`, { method: 'POST' })
      if (res.ok) {
        setAgentThinking('Analyzing with GPT-4...')
        const result = await res.json()
        setData(result.data)
        setRecommendation(result.recommendation)
        setAgentThinking(null)
      }
    } catch (err) {
      setError('Analysis failed')
      setAgentThinking(null)
    } finally {
      setAnalyzing(false)
    }
  }

  const executeAgentAction = useCallback(async (action: 'rebalance' | 'harvest', vault: 'usdc' | 'weth') => {
    setAgentThinking(`Executing ${action} on ${vault.toUpperCase()} vault...`)
    try {
      const res = await fetch(`${API_URL}/api/keeper/${action}/${vault}`, { method: 'POST' })
      const result = await res.json()

      addExecutionLog({
        action,
        vault,
        success: result.success,
        txHash: result.txHash,
        error: result.error,
        triggeredBy: 'agent',
      })

      if (result.success) {
        setExecutionResult({ success: true, message: `Agent executed ${action} on ${vault.toUpperCase()}! TX: ${result.txHash?.slice(0, 10)}...` })
        setTimeout(fetchData, 2000)
      } else {
        setExecutionResult({ success: false, message: result.error || 'Agent execution failed' })
      }
    } catch (err) {
      addExecutionLog({
        action,
        vault,
        success: false,
        error: 'Network error',
        triggeredBy: 'agent',
      })
      setExecutionResult({ success: false, message: 'Agent failed to execute transaction' })
    } finally {
      setAgentThinking(null)
    }
  }, [])

  // Agent autonomous loop
  useEffect(() => {
    if (!agentConfig.enabled || !recommendation || !keeperStatus) return

    const shouldAct = recommendation.confidence >= agentConfig.confidenceThreshold

    if (shouldAct && recommendation.action === 'REBALANCE' && agentConfig.autoRebalance) {
      // Check which vaults need rebalancing
      if (data?.vaults.usdc.needsRebalance && keeperStatus.isAuthorized.usdcVault) {
        setAgentThinking('Agent detected USDC vault needs rebalancing...')
        setTimeout(() => executeAgentAction('rebalance', 'usdc'), 2000)
      } else if (data?.vaults.weth.needsRebalance && keeperStatus.isAuthorized.wethVault) {
        setAgentThinking('Agent detected WETH vault needs rebalancing...')
        setTimeout(() => executeAgentAction('rebalance', 'weth'), 2000)
      }
    }

    if (shouldAct && recommendation.action === 'HARVEST' && agentConfig.autoHarvest) {
      if (keeperStatus.isAuthorized.usdcVault) {
        setAgentThinking('Agent initiating harvest...')
        setTimeout(() => executeAgentAction('harvest', 'usdc'), 2000)
      }
    }
  }, [agentConfig, recommendation, keeperStatus, data, executeAgentAction])

  const openExecuteModal = (action: 'rebalance' | 'harvest', vault: 'usdc' | 'weth') => {
    setModalAction(action)
    setModalVault(vault)
    setModalOpen(true)
    setExecutionResult(null)
  }

  const executeAction = async () => {
    setExecuting(true)
    try {
      const res = await fetch(`${API_URL}/api/keeper/${modalAction}/${modalVault}`, { method: 'POST' })
      const result = await res.json()

      addExecutionLog({
        action: modalAction,
        vault: modalVault,
        success: result.success,
        txHash: result.txHash,
        error: result.error,
        triggeredBy: 'manual',
      })

      if (result.success) {
        setExecutionResult({ success: true, message: `${modalAction} executed successfully! TX: ${result.txHash?.slice(0, 10)}...` })
        setTimeout(fetchData, 2000)
      } else {
        setExecutionResult({ success: false, message: result.error || 'Execution failed' })
      }
    } catch (err) {
      setExecutionResult({ success: false, message: 'Failed to execute transaction' })
    } finally {
      setExecuting(false)
      setModalOpen(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  const actionColor = {
    HOLD: 'text-green-400 bg-green-400/10 border-green-400/20',
    REBALANCE: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
    HARVEST: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Execute Modal */}
      <ExecuteModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        action={modalAction}
        vault={modalVault}
        onConfirm={executeAction}
        executing={executing}
      />

      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="mBrain" className="w-10 h-10 rounded-xl" />
            <div>
              <h1 className="text-xl font-bold">mBrain</h1>
              <p className="text-xs text-gray-500">AI Yield Optimizer</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-gray-500">
              {data ? `Last update: ${new Date(data.timestamp).toLocaleTimeString()}` : ''}
            </div>
            <button
              onClick={runAnalysis}
              disabled={analyzing}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
            >
              {analyzing ? 'Analyzing...' : 'Run Analysis'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-xl text-red-400">
            {error}
            <p className="text-xs mt-1 text-red-500">Run: cd mBrain/agent && npm run dev</p>
          </div>
        )}

        {/* Agent Thinking Banner */}
        {agentThinking && (
          <div className="mb-6 p-4 bg-purple-900/30 border border-purple-700/50 rounded-xl flex items-center gap-3">
            <div className="animate-pulse w-3 h-3 bg-purple-500 rounded-full" />
            <span className="text-purple-300">{agentThinking}</span>
          </div>
        )}

        {/* Execution Result Toast */}
        {executionResult && (
          <div className={`mb-6 p-4 rounded-xl border ${executionResult.success ? 'bg-green-900/20 border-green-800 text-green-400' : 'bg-red-900/20 border-red-800 text-red-400'}`}>
            {executionResult.message}
            <button onClick={() => setExecutionResult(null)} className="ml-4 text-xs opacity-70 hover:opacity-100">Dismiss</button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {/* Agent Mode Control Panel */}
            <div className="mb-6 p-6 bg-gradient-to-r from-cyan-900/20 to-purple-900/20 rounded-2xl border border-cyan-800/30">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full ${agentConfig.enabled ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
                  <div>
                    <h2 className="text-lg font-bold">Agent Mode</h2>
                    <p className="text-xs text-gray-400">Autonomous execution when confidence threshold is met</p>
                  </div>
                </div>
                <button
                  onClick={() => setAgentConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                  className={`px-6 py-2 rounded-lg font-medium transition-all ${
                    agentConfig.enabled
                      ? 'bg-green-600 hover:bg-green-500 text-white'
                      : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                  }`}
                >
                  {agentConfig.enabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                {/* Confidence Threshold */}
                <div className="p-4 bg-black/30 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">Confidence Threshold</span>
                    <span className="text-lg font-bold text-cyan-400">{agentConfig.confidenceThreshold}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="95"
                    value={agentConfig.confidenceThreshold}
                    onChange={(e) => setAgentConfig(prev => ({ ...prev, confidenceThreshold: parseInt(e.target.value) }))}
                    className="w-full accent-cyan-500"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>50%</span>
                    <span>95%</span>
                  </div>
                </div>

                {/* Auto Actions */}
                <div className="p-4 bg-black/30 rounded-xl">
                  <span className="text-sm text-gray-400 block mb-3">Autonomous Actions</span>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agentConfig.autoRebalance}
                        onChange={(e) => setAgentConfig(prev => ({ ...prev, autoRebalance: e.target.checked }))}
                        className="accent-yellow-500"
                      />
                      <span className="text-sm">Auto Rebalance</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agentConfig.autoHarvest}
                        onChange={(e) => setAgentConfig(prev => ({ ...prev, autoHarvest: e.target.checked }))}
                        className="accent-blue-500"
                      />
                      <span className="text-sm">Auto Harvest</span>
                    </label>
                  </div>
                </div>

                {/* Agent Status */}
                <div className="p-4 bg-black/30 rounded-xl">
                  <span className="text-sm text-gray-400 block mb-3">Agent Status</span>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Current Confidence</span>
                      <span className={recommendation && recommendation.confidence >= agentConfig.confidenceThreshold ? 'text-green-400' : 'text-gray-400'}>
                        {recommendation?.confidence || 0}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Would Execute</span>
                      <span className={recommendation && recommendation.confidence >= agentConfig.confidenceThreshold && recommendation.action !== 'HOLD' ? 'text-green-400' : 'text-gray-400'}>
                        {recommendation && recommendation.confidence >= agentConfig.confidenceThreshold && recommendation.action !== 'HOLD' ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Executions</span>
                      <span>{executionLogs.filter(l => l.triggeredBy === 'agent').length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Keeper Status Card */}
            {keeperStatus && (
              <div className="mb-6 p-4 bg-gray-900 rounded-xl border border-gray-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${keeperStatus.address ? 'bg-green-500' : 'bg-gray-500'}`} />
                    <div>
                      <div className="text-sm font-medium">Keeper Wallet</div>
                      <div className="text-xs text-gray-500 font-mono">
                        {keeperStatus.address ? `${keeperStatus.address.slice(0, 6)}...${keeperStatus.address.slice(-4)}` : 'Not configured'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-xs text-gray-500">Balance</div>
                      <div className="text-sm">{parseFloat(keeperStatus.balance).toFixed(4)} MNT</div>
                    </div>
                    <div className="flex gap-2">
                      <div className={`px-2 py-1 rounded text-xs ${keeperStatus.isAuthorized.usdcVault ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                        USDC {keeperStatus.isAuthorized.usdcVault ? 'Auth' : 'Not Auth'}
                      </div>
                      <div className={`px-2 py-1 rounded text-xs ${keeperStatus.isAuthorized.wethVault ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                        WETH {keeperStatus.isAuthorized.wethVault ? 'Auth' : 'Not Auth'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* AI Recommendation Card */}
            {recommendation && (
              <div className="mb-8 p-6 bg-gradient-to-r from-purple-900/20 to-pink-900/20 rounded-2xl border border-purple-800/30">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-bold mb-1">AI Recommendation</h2>
                    <p className="text-sm text-gray-400">Powered by GPT-4</p>
                  </div>
                  <div className={`px-4 py-2 rounded-lg border ${actionColor[recommendation.action]}`}>
                    <div className="text-lg font-bold">{recommendation.action}</div>
                    <div className="text-xs opacity-70">{recommendation.confidence}% confidence</div>
                  </div>
                </div>

                <div className="p-4 bg-black/30 rounded-xl mb-4">
                  <p className="text-sm text-gray-300">{recommendation.reasoning}</p>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div className="p-4 bg-gray-900/50 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium">USDC Vault</h3>
                      <div className="flex gap-2">
                        <button
                          onClick={() => openExecuteModal('rebalance', 'usdc')}
                          className="px-2 py-1 text-xs bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 rounded transition-colors"
                        >
                          Rebalance
                        </button>
                        <button
                          onClick={() => openExecuteModal('harvest', 'usdc')}
                          className="px-2 py-1 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded transition-colors"
                        >
                          Harvest
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-purple-400 mb-1">{recommendation.details.usdcVault.suggestedAction}</p>
                    <p className="text-xs text-gray-500">{recommendation.details.usdcVault.allocationAnalysis}</p>
                  </div>
                  <div className="p-4 bg-gray-900/50 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium">WETH Vault</h3>
                      <div className="flex gap-2">
                        <button
                          onClick={() => openExecuteModal('rebalance', 'weth')}
                          className="px-2 py-1 text-xs bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 rounded transition-colors"
                        >
                          Rebalance
                        </button>
                        <button
                          onClick={() => openExecuteModal('harvest', 'weth')}
                          className="px-2 py-1 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded transition-colors"
                        >
                          Harvest
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-purple-400 mb-1">{recommendation.details.wethVault.suggestedAction}</p>
                    <p className="text-xs text-gray-500">{recommendation.details.wethVault.allocationAnalysis}</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-xs text-gray-500 mb-1">Market Analysis</h4>
                    <p className="text-sm text-gray-400">{recommendation.marketAnalysis}</p>
                  </div>
                  <div>
                    <h4 className="text-xs text-gray-500 mb-1">Risk Assessment</h4>
                    <p className="text-sm text-gray-400">{recommendation.riskAssessment}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Execution History */}
            {executionLogs.length > 0 && (
              <div className="mb-8 p-6 bg-gray-900 rounded-2xl border border-gray-800">
                <h2 className="text-lg font-bold mb-4">Execution History</h2>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {executionLogs.map((log, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-black/30 rounded-lg text-sm">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${log.success ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className={`px-2 py-0.5 rounded text-xs ${log.triggeredBy === 'agent' ? 'bg-cyan-900/30 text-cyan-400' : 'bg-gray-800 text-gray-400'}`}>
                          {log.triggeredBy === 'agent' ? 'AGENT' : 'MANUAL'}
                        </span>
                        <span className="text-gray-300">{log.action.toUpperCase()}</span>
                        <span className="text-gray-500">{log.vault.toUpperCase()} Vault</span>
                      </div>
                      <div className="flex items-center gap-4">
                        {log.txHash && (
                          <span className="text-xs text-gray-500 font-mono">{log.txHash.slice(0, 10)}...</span>
                        )}
                        {log.error && (
                          <span className="text-xs text-red-400">{log.error}</span>
                        )}
                        <span className="text-xs text-gray-500">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Protocol Data Grid */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* USDC Vault */}
              {data?.vaults.usdc && (
                <div className="p-6 bg-gray-900 rounded-2xl border border-gray-800">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold">USDC Vault</h3>
                    <span className="text-green-400 font-bold">{data.vaults.usdc.apy.toFixed(2)}% APY</span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">TVL</span>
                      <span>{parseFloat(data.vaults.usdc.tvl).toFixed(2)} USDC</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Needs Rebalance</span>
                      <span className={data.vaults.usdc.needsRebalance ? 'text-yellow-400' : 'text-green-400'}>
                        {data.vaults.usdc.needsRebalance ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-gray-800">
                      <div className="text-xs text-gray-500 mb-2">Adapters</div>
                      {data.vaults.usdc.adapters.map((adapter, i) => (
                        <div key={i} className="flex justify-between text-xs py-1">
                          <span className="text-gray-400 font-mono">{adapter.address.slice(0, 10)}...</span>
                          <span>{adapter.allocation}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* WETH Vault */}
              {data?.vaults.weth && (
                <div className="p-6 bg-gray-900 rounded-2xl border border-gray-800">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold">WETH Vault</h3>
                    <span className="text-green-400 font-bold">{data.vaults.weth.apy.toFixed(2)}% APY</span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">TVL</span>
                      <span>{parseFloat(data.vaults.weth.tvl).toFixed(6)} WETH</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Needs Rebalance</span>
                      <span className={data.vaults.weth.needsRebalance ? 'text-yellow-400' : 'text-green-400'}>
                        {data.vaults.weth.needsRebalance ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-gray-800">
                      <div className="text-xs text-gray-500 mb-2">Adapters</div>
                      {data.vaults.weth.adapters.map((adapter, i) => (
                        <div key={i} className="flex justify-between text-xs py-1">
                          <span className="text-gray-400 font-mono">{adapter.address.slice(0, 10)}...</span>
                          <span>{adapter.allocation}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Lendle Protocol */}
              {data?.protocols.lendle && (
                <div className="p-6 bg-gray-900 rounded-2xl border border-gray-800">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold">Lendle Protocol</h3>
                    <span className="text-xs text-gray-500">Aave V2 Fork</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">USDC Market</div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Supply APY</span>
                        <span className="text-green-400">{data.protocols.lendle.usdcSupplyAPY.toFixed(2)}%</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Utilization</span>
                        <span>{data.protocols.lendle.usdcUtilization.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-gray-800">
                      <div className="text-xs text-gray-500 mb-1">WETH Market</div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Supply APY</span>
                        <span className="text-green-400">{data.protocols.lendle.wethSupplyAPY.toFixed(2)}%</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Utilization</span>
                        <span>{data.protocols.lendle.wethUtilization.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* mETH Protocol */}
              {data?.protocols.meth && (
                <div className="p-6 bg-gray-900 rounded-2xl border border-gray-800">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold">mETH Staking</h3>
                    <span className="text-xs text-gray-500">Mantle LST</span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Staking APY</span>
                      <span className="text-green-400">{data.protocols.meth.stakingAPY.toFixed(2)}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Exchange Rate</span>
                      <span>{data.protocols.meth.exchangeRate} mETH/ETH</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* How It Works */}
            <div className="mt-8 p-6 bg-gray-900/50 rounded-2xl border border-gray-800">
              <h2 className="text-lg font-bold mb-4">How mBrain Works</h2>
              <div className="grid md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center text-xl">
                    1
                  </div>
                  <h3 className="font-medium mb-1">Oracle Data</h3>
                  <p className="text-sm text-gray-500">Fetches live APY, TVL, and utilization from protocols</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center text-xl">
                    2
                  </div>
                  <h3 className="font-medium mb-1">AI Analysis</h3>
                  <p className="text-sm text-gray-500">GPT-4 analyzes data and generates recommendations</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-cyan-600/20 text-cyan-400 flex items-center justify-center text-xl">
                    3
                  </div>
                  <h3 className="font-medium mb-1">Agent Decision</h3>
                  <p className="text-sm text-gray-500">Agent checks confidence threshold and authorization</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-pink-600/20 text-pink-400 flex items-center justify-center text-xl">
                    4
                  </div>
                  <h3 className="font-medium mb-1">Auto Execute</h3>
                  <p className="text-sm text-gray-500">Autonomously executes rebalance or harvest</p>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-gray-500 text-sm">
          mBrain - Autonomous AI yield optimizer for mYield on Mantle
        </div>
      </footer>
    </div>
  )
}
