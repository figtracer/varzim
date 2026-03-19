# varzim

pay-per-query contract event scanner. think `eth_getLogs` as a paid service with a clean UI, ABI decoding, and live shadow event streaming.

no subscription, no API key. just connect wallet, pick a contract, and scan or watch events. payments handled by [MPP](https://mpp.dev) micropayments on [Tempo](https://tempo.xyz).

**live**: https://varzim.figtracer.com

## what it does

**scan** — one-shot historical event query across a block range. paste a contract address, pick an event from the auto-fetched ABI, set block range, pay, get decoded results.

**watch** — live shadow event streaming. like shadow.xyz observability but as an MPP service. pay per hour per contract, get an SSE stream of decoded events as they hit the chain. events persisted in sqlite, exportable as CSV. live stats (events/min, unique addresses).

## use it

### browser

go to https://varzim.figtracer.com, sign up with a passkey, fund your wallet, scan or watch.

### cli (recommended)

use your existing tempo wallet from the terminal. no separate wallet setup needed.

```bash
# install tempo cli
curl -fsSL https://tempo.xyz/install | bash
tempo wallet login

# start watching WETH transfers
tempo request -X POST \
  --json '{"contract_address":"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2","event_abi":"event Transfer(address indexed src, address indexed dst, uint256 wad)"}' \
  https://server-production-b06e.up.railway.app/api/watch

# stream the events (use watch_id from response above)
curl -sN "https://server-production-b06e.up.railway.app/api/watch/<watch_id>/stream?event_abi=event+Transfer(...)&contract_address=0xC02..."

# or do a one-shot scan
tempo request -X POST \
  --json '{"contract_address":"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2","event_abi":"event Transfer(address indexed src, address indexed dst, uint256 wad)","from_block":24690000,"to_block":24690100}' \
  https://server-production-b06e.up.railway.app/api/scan
```

payment happens automatically through the MPP 402 flow.

## stack

- **server**: bun + hono + mppx + viem + sqlite
- **frontend**: react 19 + vite + wagmi + framer motion
- **payments**: mppx (MPP 402 flow, USDC on Tempo)
- **wallet**: WebAuthn via tempo.ts (passkeys, no extensions)
- **rpc**: public ethereum RPC via alchemy (no synced node needed)
- **abi source**: etherscan API + sourcify fallback

## run locally

```bash
# server
cd server
bun install
bun run index.ts

# frontend (separate terminal)
cd web
npm install
npm run dev
```

### env vars (server/.env)

```
RECIPIENT_ADDRESS=0x...
ALCHEMY_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ETHERSCAN_API_KEY=...
MPP_SECRET_KEY=...
DB_PATH=./varzim.db
PORT=3002
```

## endpoints

| endpoint | auth | what |
|----------|------|------|
| `GET /api/abis/:address` | free | fetch + cache contract ABI |
| `POST /api/scan` | MPP | scan events in block range |
| `POST /api/watch` | MPP | start live watch session |
| `GET /api/watch/:id/stream` | free | SSE stream for active watch |
| `GET /api/watch/:id/export` | free | download watch session as CSV |
| `GET /api/history?address=` | free | past queries for wallet |
| `GET /api/popular` | free | most-queried contracts |

## pricing

scan: $0.01 base + $0.001 per 1000 blocks (capped at $0.10)
watch: $0.05/hr per contract

prices come from the server, not hardcoded in frontend. you only see what you paid after the tx.

## future

replace public RPC with a reth ExEx for instant queries and sub-millisecond event lookups. the ExEx would index all events into a local DB:

```
[Reth Node] -> [ExEx] -> [MDBX: contract_addr + topic0 + block_num -> decoded_args]
```

---

built for the [tempo hackathon](https://hackathon.tempo.xyz). named after [varzim](https://en.wikipedia.org/wiki/Varzim_SC) bcs why not.
