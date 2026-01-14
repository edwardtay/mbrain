import Anthropic from '@anthropic-ai/sdk'
import type { ProtocolData } from '../oracle/index.js'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

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

    return {
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
