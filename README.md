# mBrain

AI-powered yield optimizer for mYield vaults on Mantle. Uses LLM analysis and oracle data to automate yield strategy decisions.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         mBrain                               │
├─────────────────────────────────────────────────────────────┤
│  Oracle Layer                                                │
│  ├─ Lendle APY/Utilization (on-chain query)                 │
│  ├─ mETH staking rate                                        │
│  └─ mYield vault state (TVL, allocations, needsRebalance)   │
├─────────────────────────────────────────────────────────────┤
│  AI Layer (GPT-4)                                            │
│  ├─ Analyzes protocol data                                   │
│  ├─ Risk-adjusted recommendations                            │
│  └─ Confidence scoring                                       │
├─────────────────────────────────────────────────────────────┤
│  Keeper Layer                                                │
│  ├─ Auto-execute rebalance() when confidence > 80%          │
│  ├─ Auto-execute harvest() for reward compounding           │
│  └─ Transaction history logging                              │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Agent (Backend)

Node.js service that:
- Fetches live protocol data every 5 minutes
- Sends data to GPT-4 for analysis
- Returns actionable recommendations (HOLD/REBALANCE/HARVEST)
- Can auto-execute keeper functions when authorized

### Dashboard (Frontend)

Next.js app showing:
- Real-time protocol data
- AI recommendations with confidence scores
- Vault status and allocation breakdowns
- Execution history

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/data` | GET | Current protocol data |
| `/api/recommendation` | GET | Latest AI recommendation |
| `/api/analyze` | POST | Force new analysis |
| `/api/history` | GET | Recommendation history |
| `/api/keeper/status` | GET | Keeper wallet status |
| `/api/keeper/rebalance/:vault` | POST | Execute rebalance |
| `/api/keeper/harvest/:vault` | POST | Execute harvest |

## Run

```bash
# Agent
cd agent
cp .env.example .env  # Add OPENAI_API_KEY
npm install
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

## Environment Variables

```
OPENAI_API_KEY=sk-...          # Required for AI recommendations
KEEPER_PRIVATE_KEY=0x...       # Optional - for auto-execution
PORT=3001                      # Agent port
```

## How It Works

1. **Data Collection**: Oracle service queries on-chain data from Lendle, mETH, and mYield contracts
2. **AI Analysis**: GPT-4 analyzes yields, utilization, risk factors
3. **Recommendation**: Returns HOLD/REBALANCE/HARVEST with confidence %
4. **Execution**: If confidence > 80% and keeper is authorized, auto-executes

## Integration with mYield

mBrain reads from and can execute on mYield vaults:

```
mYield Vaults (ERC4626)
├─ USDC Vault: 0xcfF09905F8f18B35F5A1Ba6d2822D62B3d8c48bE
└─ WETH Vault: 0x073b61f5Ed26d802b05301e0E019f78Ac1A41D23

Keeper Functions:
├─ rebalance() - Redistribute funds to target allocations
└─ harvest()   - Claim and compound rewards
```

## License

MIT
