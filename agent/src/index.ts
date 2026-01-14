import express from 'express'
import cors from 'cors'
import { CronJob } from 'cron'
import { fetchProtocolData, type ProtocolData } from './oracle/index.js'
import {
  getAIRecommendation,
  addToHistory,
  getHistory,
  getCommitmentRegistry,
  verifyCommitment,
  getApyTrend,
  type AIRecommendation
} from './ai/index.js'
import {
  initializeKeeper,
  getKeeperStatus,
  executeRebalance,
  executeHarvest,
  addExecutionToHistory,
  getExecutionHistory
} from './keeper/index.js'

const app = express()
app.use(cors())
app.use(express.json())

// Helper to serialize BigInt to string for JSON
function serializeData(data: any): any {
  return JSON.parse(JSON.stringify(data, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ))
}

// State
let latestData: ProtocolData | null = null
let latestRecommendation: AIRecommendation | null = null
let isRunning = false

// Initialize keeper if private key is provided
if (process.env.KEEPER_PRIVATE_KEY) {
  initializeKeeper(process.env.KEEPER_PRIVATE_KEY)
}

// ========== API Routes ==========

// Get current protocol data
app.get('/api/data', async (req, res) => {
  try {
    if (!latestData) {
      latestData = await fetchProtocolData()
    }
    res.json(serializeData(latestData))
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Get latest AI recommendation
app.get('/api/recommendation', async (req, res) => {
  try {
    if (!latestRecommendation) {
      if (!latestData) {
        latestData = await fetchProtocolData()
      }
      latestRecommendation = await getAIRecommendation(latestData)
      addToHistory(latestRecommendation)
    }
    res.json(latestRecommendation)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Force refresh data and get new recommendation
app.post('/api/analyze', async (req, res) => {
  try {
    console.log('Running analysis...')
    latestData = await fetchProtocolData()
    latestRecommendation = await getAIRecommendation(latestData)
    addToHistory(latestRecommendation)
    console.log(`Analysis complete: ${latestRecommendation.action} (${latestRecommendation.confidence}% confidence)`)
    res.json(serializeData({
      data: latestData,
      recommendation: latestRecommendation,
    }))
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Get recommendation history
app.get('/api/history', (req, res) => {
  res.json(getHistory())
})

// Get APY trend data
app.get('/api/trends', (req, res) => {
  res.json(getApyTrend())
})

// ========== Verifiable AI Commitment Routes ==========

// Get all commitment hashes (verifiable AI decisions)
app.get('/api/commitments', (req, res) => {
  res.json(getCommitmentRegistry())
})

// Verify a specific commitment hash
app.get('/api/commitments/:hash', (req, res) => {
  const result = verifyCommitment(req.params.hash)
  if (!result.valid) {
    return res.status(404).json({ error: 'Commitment not found or invalid' })
  }
  res.json({
    valid: result.valid,
    recommendation: result.recommendation,
  })
})

// Get keeper status
app.get('/api/keeper/status', async (req, res) => {
  try {
    const status = await getKeeperStatus()
    res.json(status)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Execute rebalance
app.post('/api/keeper/rebalance/:vault', async (req, res) => {
  const vault = req.params.vault as 'usdc' | 'weth'
  if (vault !== 'usdc' && vault !== 'weth') {
    return res.status(400).json({ error: 'Invalid vault' })
  }

  try {
    console.log(`Executing rebalance on ${vault} vault...`)
    const result = await executeRebalance(vault)
    addExecutionToHistory(result)
    console.log(`Rebalance result: ${result.success ? 'Success' : 'Failed'}`)
    res.json(result)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Execute harvest
app.post('/api/keeper/harvest/:vault', async (req, res) => {
  const vault = req.params.vault as 'usdc' | 'weth'
  if (vault !== 'usdc' && vault !== 'weth') {
    return res.status(400).json({ error: 'Invalid vault' })
  }

  try {
    console.log(`Executing harvest on ${vault} vault...`)
    const result = await executeHarvest(vault)
    addExecutionToHistory(result)
    console.log(`Harvest result: ${result.success ? 'Success' : 'Failed'}`)
    res.json(result)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Get execution history
app.get('/api/keeper/history', (req, res) => {
  res.json(getExecutionHistory())
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    isRunning,
    lastUpdate: latestData?.timestamp || null,
    lastRecommendation: latestRecommendation?.timestamp || null,
  })
})

// ========== Cron Jobs ==========

// Run analysis every 5 minutes
const analysisCron = new CronJob('*/5 * * * *', async () => {
  if (isRunning) return
  isRunning = true

  try {
    console.log(`[${new Date().toISOString()}] Running scheduled analysis...`)
    latestData = await fetchProtocolData()
    latestRecommendation = await getAIRecommendation(latestData)
    addToHistory(latestRecommendation)

    console.log(`Analysis complete: ${latestRecommendation.action} (${latestRecommendation.confidence}%)`)

    // Auto-execute if confidence is high and action is recommended
    if (latestRecommendation.action === 'REBALANCE' && latestRecommendation.confidence >= 80) {
      console.log('High confidence rebalance recommendation - checking authorization...')
      const status = await getKeeperStatus()

      if (latestData.vaults.usdc.needsRebalance && status.isAuthorized.usdcVault) {
        console.log('Executing USDC vault rebalance...')
        const result = await executeRebalance('usdc')
        addExecutionToHistory(result)
      }

      if (latestData.vaults.weth.needsRebalance && status.isAuthorized.wethVault) {
        console.log('Executing WETH vault rebalance...')
        const result = await executeRebalance('weth')
        addExecutionToHistory(result)
      }
    }
  } catch (error) {
    console.error('Analysis error:', error)
  } finally {
    isRunning = false
  }
})

// ========== Start Server ==========

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ███╗   ███╗ █████╗ ██╗   ██╗███████╗███╗   ██╗            ║
║   ████╗ ████║██╔══██╗██║   ██║██╔════╝████╗  ██║            ║
║   ██╔████╔██║███████║██║   ██║█████╗  ██╔██╗ ██║            ║
║   ██║╚██╔╝██║██╔══██║╚██╗ ██╔╝██╔══╝  ██║╚██╗██║            ║
║   ██║ ╚═╝ ██║██║  ██║ ╚████╔╝ ███████╗██║ ╚████║            ║
║   ╚═╝     ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═══╝            ║
║                                                              ║
║   Mantle Maven - AI Yield Expert for mYield                  ║
║   Verifiable AI • Autonomous Execution • Real-time Analysis  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

Server running on http://localhost:${PORT}

Endpoints:
  GET  /api/data           - Current protocol data
  GET  /api/recommendation - Latest AI recommendation
  POST /api/analyze        - Force new analysis
  GET  /api/history        - Recommendation history
  GET  /api/trends         - APY trend analysis
  GET  /api/commitments    - Verifiable AI commitment hashes
  GET  /api/commitments/:hash - Verify specific commitment
  GET  /api/keeper/status  - Keeper wallet status
  POST /api/keeper/rebalance/:vault - Execute rebalance
  POST /api/keeper/harvest/:vault   - Execute harvest
  GET  /api/keeper/history - Execution history
  GET  /api/health         - Health check
`)

  // Start cron job
  analysisCron.start()
  console.log('Cron job started: Analysis runs every 5 minutes')

  // Run initial analysis
  setTimeout(async () => {
    console.log('Running initial analysis...')
    try {
      latestData = await fetchProtocolData()
      console.log('Protocol data fetched successfully')

      if (process.env.ANTHROPIC_API_KEY) {
        latestRecommendation = await getAIRecommendation(latestData)
        addToHistory(latestRecommendation)
        console.log(`Initial recommendation: ${latestRecommendation.action}`)
      } else {
        console.log('ANTHROPIC_API_KEY not set - AI recommendations disabled')
      }
    } catch (error) {
      console.error('Initial analysis error:', error)
    }
  }, 1000)
})
