import Anthropic from '@anthropic-ai/sdk'
import { keccak256, toHex, encodePacked } from 'viem'
import type { ProtocolData } from '../oracle/index.js'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Historical APY tracking for trend analysis
const apyHistory: { timestamp: number; usdcApy: number; wethApy: number; lendleUtil: number }[] = []

export function trackApyHistory(data: ProtocolData) {
  apyHistory.push({
    timestamp: Date.now(),
    usdcApy: data.vaults.usdc.apy,
    wethApy: data.vaults.weth.apy,
    lendleUtil: data.protocols.lendle.usdcUtilization,
  })
  // Keep last 100 entries (about 8 hours at 5 min intervals)
  if (apyHistory.length > 100) apyHistory.shift()
}

export function getApyTrend() {
  if (apyHistory.length < 2) return { usdcTrend: 0, wethTrend: 0, avgUsdcApy: 0, avgWethApy: 0 }

  const recent = apyHistory.slice(-10)
  const older = apyHistory.slice(0, Math.min(10, apyHistory.length - 10))

  const recentUsdcAvg = recent.reduce((a, b) => a + b.usdcApy, 0) / recent.length
  const recentWethAvg = recent.reduce((a, b) => a + b.wethApy, 0) / recent.length
  const olderUsdcAvg = older.length ? older.reduce((a, b) => a + b.usdcApy, 0) / older.length : recentUsdcAvg
  const olderWethAvg = older.length ? older.reduce((a, b) => a + b.wethApy, 0) / older.length : recentWethAvg

  return {
    usdcTrend: recentUsdcAvg - olderUsdcAvg,
    wethTrend: recentWethAvg - olderWethAvg,
    avgUsdcApy: recentUsdcAvg,
    avgWethApy: recentWethAvg,
  }
}

export interface AIRecommendation {
  action: 'HOLD' | 'REBALANCE' | 'HARVEST'
  confidence: number // 0-100
  reasoning: string
  details: {
    usdcVault: VaultRecommendation
    wethVault: VaultRecommendation
  }
  marketAnalysis: string
  riskAssessment: string
  timestamp: number
  commitmentHash?: string // Verifiable hash of this recommendation
}

// Generate a commitment hash for verifiable AI recommendations
export function generateCommitmentHash(rec: AIRecommendation): string {
  // Create deterministic hash of the recommendation
  const data = encodePacked(
    ['string', 'uint8', 'uint256'],
    [
      rec.action,
      rec.confidence,
      BigInt(rec.timestamp)
    ]
  )
  return keccak256(data)
}

// Store commitment hashes with their recommendations
const commitmentRegistry: Map<string, { recommendation: AIRecommendation; blockNumber?: number }> = new Map()

export function registerCommitment(rec: AIRecommendation): string {
  const hash = generateCommitmentHash(rec)
  rec.commitmentHash = hash
  commitmentRegistry.set(hash, { recommendation: rec })
  return hash
}

export function verifyCommitment(hash: string): { valid: boolean; recommendation?: AIRecommendation } {
  const entry = commitmentRegistry.get(hash)
  if (!entry) return { valid: false }

  // Verify the hash matches
  const computedHash = generateCommitmentHash(entry.recommendation)
  return {
    valid: computedHash === hash,
    recommendation: entry.recommendation
  }
}

export function getCommitmentRegistry(): { hash: string; timestamp: number; action: string; confidence: number }[] {
  return Array.from(commitmentRegistry.entries()).map(([hash, entry]) => ({
    hash,
    timestamp: entry.recommendation.timestamp,
    action: entry.recommendation.action,
    confidence: entry.recommendation.confidence,
  }))
}

export interface VaultRecommendation {
  currentAPY: number
  suggestedAction: string
  allocationAnalysis: string
}

const SYSTEM_PROMPT = `You are mBrain, an AI yield optimization agent for mYield vaults on Mantle blockchain.

Your role is to analyze DeFi protocol data and provide actionable recommendations for yield optimization.

You have access to:
1. mYield vault data (TVL, APY, adapter allocations)
2. Lendle lending protocol data (supply/borrow APYs, utilization)
3. mETH liquid staking data (staking yield)

When analyzing, consider:
- Current APY vs historical averages
- Protocol utilization rates (high utilization = higher yield but more risk)
- Gas costs vs potential gains from rebalancing
- Risk factors (smart contract risk, liquidity risk, depeg risk)

Provide clear, actionable recommendations with confidence levels.

You MUST respond with ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "action": "HOLD" | "REBALANCE" | "HARVEST",
  "confidence": 0-100,
  "reasoning": "Brief explanation",
  "details": {
    "usdcVault": {
      "suggestedAction": "...",
      "allocationAnalysis": "..."
    },
    "wethVault": {
      "suggestedAction": "...",
      "allocationAnalysis": "..."
    }
  },
  "marketAnalysis": "Current market conditions...",
  "riskAssessment": "Risk factors to consider..."
}`

export async function getAIRecommendation(data: ProtocolData): Promise<AIRecommendation> {
  // Track APY history for trend analysis
  trackApyHistory(data)
  const trends = getApyTrend()

  const userPrompt = `
Analyze the following DeFi protocol data and provide yield optimization recommendations:

## mYield Vaults

### USDC Vault
- TVL: ${data.vaults.usdc.tvl} USDC
- Current APY: ${data.vaults.usdc.apy.toFixed(2)}%
- Needs Rebalance: ${data.vaults.usdc.needsRebalance}
- Adapters:
${data.vaults.usdc.adapters.map((a, i) => `  ${i + 1}. ${a.address.slice(0, 10)}... - Allocation: ${a.allocation}%, APY: ${a.apy.toFixed(2)}%, Deposited: ${a.deposited}`).join('\n')}

### WETH Vault
- TVL: ${data.vaults.weth.tvl} WETH
- Current APY: ${data.vaults.weth.apy.toFixed(2)}%
- Needs Rebalance: ${data.vaults.weth.needsRebalance}
- Adapters:
${data.vaults.weth.adapters.map((a, i) => `  ${i + 1}. ${a.address.slice(0, 10)}... - Allocation: ${a.allocation}%, APY: ${a.apy.toFixed(2)}%, Deposited: ${a.deposited}`).join('\n')}

## Protocol Data

### Lendle (Aave V2 Fork)
- USDC Supply APY: ${data.protocols.lendle.usdcSupplyAPY.toFixed(2)}%
- USDC Borrow APY: ${data.protocols.lendle.usdcBorrowAPY.toFixed(2)}%
- USDC Utilization: ${data.protocols.lendle.usdcUtilization.toFixed(2)}%
- WETH Supply APY: ${data.protocols.lendle.wethSupplyAPY.toFixed(2)}%
- WETH Borrow APY: ${data.protocols.lendle.wethBorrowAPY.toFixed(2)}%
- WETH Utilization: ${data.protocols.lendle.wethUtilization.toFixed(2)}%

### mETH Liquid Staking
- Staking APY: ${data.protocols.meth.stakingAPY.toFixed(2)}%
- Exchange Rate: ${data.protocols.meth.exchangeRate}

## Historical Trend Analysis
- USDC APY Trend: ${trends.usdcTrend > 0 ? '+' : ''}${trends.usdcTrend.toFixed(2)}% (recent vs older)
- WETH APY Trend: ${trends.wethTrend > 0 ? '+' : ''}${trends.wethTrend.toFixed(2)}% (recent vs older)
- Average USDC APY (recent): ${trends.avgUsdcApy.toFixed(2)}%
- Average WETH APY (recent): ${trends.avgWethApy.toFixed(2)}%
- Data Points: ${apyHistory.length}

Provide your analysis and recommendations as a JSON object.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      system: SYSTEM_PROMPT,
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      throw new Error('No text response from Claude')
    }

    // Parse the JSON response
    const parsed = JSON.parse(content.text)

    const recommendation: AIRecommendation = {
      action: parsed.action || 'HOLD',
      confidence: parsed.confidence || 50,
      reasoning: parsed.reasoning || 'Unable to generate recommendation',
      details: {
        usdcVault: {
          currentAPY: data.vaults.usdc.apy,
          suggestedAction: parsed.details?.usdcVault?.suggestedAction || 'Hold',
          allocationAnalysis: parsed.details?.usdcVault?.allocationAnalysis || 'N/A',
        },
        wethVault: {
          currentAPY: data.vaults.weth.apy,
          suggestedAction: parsed.details?.wethVault?.suggestedAction || 'Hold',
          allocationAnalysis: parsed.details?.wethVault?.allocationAnalysis || 'N/A',
        },
      },
      marketAnalysis: parsed.marketAnalysis || 'N/A',
      riskAssessment: parsed.riskAssessment || 'N/A',
      timestamp: Date.now(),
    }

    // Register commitment hash for verifiability
    registerCommitment(recommendation)

    return recommendation
  } catch (error) {
    console.error('Claude recommendation error:', error)

    // Fallback to rule-based recommendation
    return getFallbackRecommendation(data)
  }
}

function getFallbackRecommendation(data: ProtocolData): AIRecommendation {
  const needsRebalance = data.vaults.usdc.needsRebalance || data.vaults.weth.needsRebalance

  return {
    action: needsRebalance ? 'REBALANCE' : 'HOLD',
    confidence: 70,
    reasoning: needsRebalance
      ? 'Vault allocation has drifted from target. Rebalance recommended to optimize yield.'
      : 'Current allocation is within acceptable range. No action needed.',
    details: {
      usdcVault: {
        currentAPY: data.vaults.usdc.apy,
        suggestedAction: data.vaults.usdc.needsRebalance ? 'Rebalance' : 'Hold',
        allocationAnalysis: `Single adapter strategy at ${data.vaults.usdc.adapters[0]?.allocation || 100}% allocation.`,
      },
      wethVault: {
        currentAPY: data.vaults.weth.apy,
        suggestedAction: data.vaults.weth.needsRebalance ? 'Rebalance' : 'Hold',
        allocationAnalysis: `Multi-strategy with ${data.vaults.weth.adapters.length} adapters.`,
      },
    },
    marketAnalysis: `Lendle USDC utilization at ${data.protocols.lendle.usdcUtilization.toFixed(1)}%. ${data.protocols.lendle.usdcUtilization > 80 ? 'High utilization may indicate increased demand.' : 'Healthy utilization levels.'}`,
    riskAssessment: 'Standard DeFi risks apply: smart contract risk, oracle risk, liquidity risk.',
    timestamp: Date.now(),
  }
}

// Store recommendation history
const recommendationHistory: AIRecommendation[] = []

export function addToHistory(recommendation: AIRecommendation) {
  recommendationHistory.unshift(recommendation)
  if (recommendationHistory.length > 100) {
    recommendationHistory.pop()
  }
}

export function getHistory(): AIRecommendation[] {
  return recommendationHistory
}
