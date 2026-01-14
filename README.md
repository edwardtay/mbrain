# Mantle Maven

AI-powered yield optimization agent for mYield vaults on Mantle. Uses Claude AI for intelligent analysis and an autonomous keeper for on-chain execution.

**Live Demo**: https://mantle-maven.vercel.app
**API**: https://mantle-maven-api-660587902574.us-central1.run.app
**GitHub**: https://github.com/edwardtay/mbrain

## What It Does

Mantle Maven is an autonomous AI agent that:
1. **Monitors** mYield vault performance and underlying protocol rates in real-time
2. **Analyzes** yield opportunities using Claude AI
3. **Recommends** optimal allocation strategies (HOLD/REBALANCE/HARVEST)
4. **Executes** rebalancing automatically when conditions are met

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Mantle Maven                               │
├─────────────────────────────────────────────────────────────────┤
│  Data Layer (Oracle)                                             │
│  ├─ Lendle: Supply APY, utilization rates                       │
│  ├─ mETH: Staking APY, exchange rate                            │
│  └─ mYield: TVL, allocations, drift status                      │
├─────────────────────────────────────────────────────────────────┤
│  AI Layer (Claude)                                               │
│  ├─ Analyzes yield spreads and risk factors                     │
│  ├─ Generates actionable recommendations                         │
│  └─ Confidence scoring (0-100%)                                  │
├─────────────────────────────────────────────────────────────────┤
│  Keeper Layer (Autonomous Agent)                                 │
│  ├─ Watches for drift threshold triggers                        │
│  ├─ Auto-executes rebalance() when conditions met               │
│  └─ Logs all executions with tx hashes                          │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### Dashboard
- **Vault Performance**: Real-time APY and TVL for USDC and WETH vaults
- **Portfolio View**: Your deposits and earnings (connect wallet)
- **AI Analysis**: On-demand Claude-powered yield analysis
- **Keeper Agent**: Live status of autonomous execution agent
- **Allocation Breakdown**: Current adapter allocations with APY

### AI Agent
- Powered by Claude (Anthropic)
- Analyzes yield opportunities across Lendle and mETH
- Provides confidence-scored recommendations
- Shows planned autonomous actions before execution

### Autonomous Keeper
- Monitors vault drift thresholds
- Executes rebalancing when conditions are met
- Authorized on both USDC and WETH vaults
- Funded with MNT for gas

## Tech Stack

- **Frontend**: Next.js 16, TailwindCSS, TypeScript
- **Backend**: Node.js, Express, TypeScript
- **AI**: Claude API (Anthropic)
- **Blockchain**: Viem, Mantle RPC
- **Hosting**: Vercel (frontend), Google Cloud Run (backend)

## mYield Integration

```
mYield Vaults (ERC4626 Tokenized Vaults)
├─ USDC Vault: 0xcfF09905F8f18B35F5A1Ba6d2822D62B3d8c48bE
│  └─ Adapter: Lendle USDC (100% allocation)
└─ WETH Vault: 0x073b61f5Ed26d802b05301e0E019f78Ac1A41D23
   ├─ Adapter 1: Lendle WETH (60% allocation)
   └─ Adapter 2: mETH Staking (40% allocation)

Keeper Functions:
├─ rebalance() - Redistribute to target allocations
└─ harvest()   - Claim and compound rewards
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/data` | GET | Current vault and protocol data |
| `/api/analyze` | POST | Trigger new AI analysis |
| `/api/recommendation` | GET | Latest AI recommendation |
| `/api/keeper/status` | GET | Keeper wallet and authorization |
| `/api/keeper/rebalance/:vault` | POST | Execute rebalance |
| `/api/keeper/harvest/:vault` | POST | Execute harvest |

## Local Development

```bash
# Backend
cd agent
npm install
cp .env.example .env  # Add ANTHROPIC_API_KEY
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

## Environment Variables

### Backend (agent/.env)
```
ANTHROPIC_API_KEY=sk-ant-...    # Required for Claude AI
KEEPER_PRIVATE_KEY=0x...         # For autonomous execution
```

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## How Autonomous Execution Works

1. **Analysis**: Claude analyzes vault data every 5 minutes
2. **Recommendation**: If REBALANCE recommended with >80% confidence
3. **Threshold Check**: Vault's `needsRebalance()` must return true
4. **Execution**: Keeper calls `rebalance()` on the vault
5. **Logging**: Transaction hash recorded in execution history

The drift threshold is enforced by the smart contract itself, ensuring rebalancing only happens when allocations have drifted beyond acceptable limits.

## Hackathon Submission

Built for the Mantle Hackathon demonstrating:
- AI-powered DeFi yield optimization
- Autonomous on-chain agent execution
- Integration with mYield ERC4626 vaults
- Real-time protocol data aggregation

## License

MIT
