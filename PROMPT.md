# Varzim — Pay-Per-Query Contract Event Scanner

## What We're Building

A Shadow.xyz-style on-demand contract event scanner, powered by MPP micropayments. Users pay $0.01–0.05 per query to scan Ethereum contract events across block ranges — no subscription, no API key, just pay and get data.

Think of it as `eth_getLogs` as a paid service with a clean UI, ABI decoding, and persistent query history.

**Name**: Varzim
**Repo**: https://github.com/figtracer/varzim (private)
**Design reference**: Copy from `../blosom` — same white minimal aesthetic, same fonts, same wallet flow

---

## Architecture

```
[User Browser]
    ├── Wallet Connect (WebAuthn, Tempo chain — same as blosom)
    ├── Mppx Client (auto-handles 402 payment flow)
    └── Query UI (contract address + event sig + block range)
            │
            ▼
[Hono + Bun Server]
    ├── /keys/*           — tempo.ts WebAuthn key manager (from blosom)
    ├── GET  /api/abis/:address  — free, fetches ABI from Etherscan/Sourcify
    ├── POST /api/scan    — MPP-gated ($0.01-0.05), scans events via RPC
    ├── GET  /api/history — free, returns past queries for connected wallet
    └── GET  /api/popular — free, most-queried contracts
            │
            ▼
[Public Ethereum RPC]   (Alchemy/Infura free tier — no synced node needed)
    └── eth_getLogs(address, topics, fromBlock, toBlock)
```

### Why This Works Without a Synced Node

The entire scanning happens via `eth_getLogs` on a public RPC (Alchemy free tier: 300M compute units/month). The ExEx version is the production story — for the hackathon, a public RPC is more than enough. The server is just a paid proxy that:
1. Accepts payment via MPP
2. Calls `eth_getLogs` on the public RPC
3. Decodes events using the contract ABI
4. Returns clean, structured results
5. Persists query history

### Future: ExEx Version

A Reth ExEx could index all events into a local DB for instant queries:
```
[Reth Node] → [ExEx] → [MDBX: contract_addr + topic0 + block_num → decoded_args]
```
This removes RPC dependency and enables sub-millisecond queries. But for hackathon: public RPC.

---

## Stack

| Layer | Tech | Why |
|-------|------|-----|
| **Server** | Bun + Hono | Same as blosom, fast, mppx native support |
| **Payments** | mppx server | MPP 402 flow, USDC on Tempo |
| **Wallet** | wagmi + viem + tempo.ts | WebAuthn, same as blosom |
| **Frontend** | React 19 + Vite | Same as blosom |
| **Animations** | Framer Motion | Minimal, tasteful |
| **RPC** | viem (public client) | `eth_getLogs`, ABI decoding |
| **DB** | bun:sqlite | Query history, cached ABIs |
| **ABI Source** | Etherscan API + Sourcify | Auto-fetch contract ABIs |

---

## Design System (COPY FROM BLOSOM)

Import the exact same design system from `../blosom/web/src/index.css`. Same fonts, same colors, same spacing.

| Property | Value |
|----------|-------|
| **Background** | `#ffffff` primary, `#f8f9fa` secondary |
| **Text** | `#111` primary, `#666` secondary, `#999` tertiary |
| **Accent** | `#6366f1` (indigo), `#3b82f6` (blue), `#22d3ee` (cyan) |
| **Font body** | Inter (Google Fonts) |
| **Font mono** | IBM Plex Mono |
| **Border radius** | 4px default, 2px small |
| **Borders** | `#eee` |

### Layout

Ultra-minimal. No header. No navigation. Just:

```
┌─────────────────────────────────────────────────┐
│                                                 │
│  [Wallet Connect]                    top-right  │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │  Contract: [0x__________________________]│    │
│  │  Event:    [Transfer(address,address,...]│    │
│  │  Blocks:   [from] — [to]                │    │
│  │                                         │    │
│  │  [Scan · $0.02]                         │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  ┌─ Results ───────────────────────────────┐    │
│  │ Block    Tx Hash     Args...            │    │
│  │ 19841023 0xab12...  from: 0x7a.. to:..  │    │
│  │ 19841019 0xcd34...  from: 0x3b.. to:..  │    │
│  │ ...                                     │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  ┌─ Recent Queries ───────────────────────┐     │
│  │  USDC · Transfer · 19840000-19841000   │     │
│  │  Uniswap V3 · Swap · 19839000-19840k  │     │
│  └────────────────────────────────────────┘     │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Animations

Keep it minimal and functional:
- Query input card: subtle shadow on focus
- "Scan" button: loading spinner during scan, success checkmark after
- Results: rows fade in one by one (staggered 30ms)
- New result rows: slide in from top with spring physics
- Cost badge on button: subtle pulse when price changes based on block range

---

## Server Implementation

### Dependencies

```json
{
  "dependencies": {
    "hono": "^4",
    "mppx": "^0.4.7",
    "tempo.ts": "latest",
    "viem": "^2.47",
    "better-sqlite3": "^11"
  }
}
```

Or use `bun:sqlite` directly since we're on Bun.

### Database Schema

```sql
CREATE TABLE queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_address TEXT NOT NULL,
  event_signature TEXT NOT NULL,
  from_block INTEGER NOT NULL,
  to_block INTEGER NOT NULL,
  result_count INTEGER NOT NULL,
  payer_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  cost_usd TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cached_abis (
  address TEXT PRIMARY KEY,
  abi_json TEXT NOT NULL,
  name TEXT,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_queries_payer ON queries(payer_address);
CREATE INDEX idx_queries_contract ON queries(contract_address);
```

### Endpoints

#### `GET /api/abis/:address` (Free)

Fetches and caches the contract ABI. Tries Etherscan first, falls back to Sourcify.

```typescript
app.get('/api/abis/:address', async (c) => {
  const address = c.req.param('address')

  // Check cache
  const cached = db.prepare('SELECT abi_json, name FROM cached_abis WHERE address = ?').get(address)
  if (cached) return c.json({ abi: JSON.parse(cached.abi_json), name: cached.name })

  // Fetch from Etherscan
  const etherscanUrl = `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_KEY}`
  const res = await fetch(etherscanUrl)
  const data = await res.json()

  if (data.status === '1') {
    const abi = JSON.parse(data.result)
    // Also fetch contract name
    const nameRes = await fetch(`https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${ETHERSCAN_KEY}`)
    const nameData = await nameRes.json()
    const name = nameData.result?.[0]?.ContractName || null

    db.prepare('INSERT OR REPLACE INTO cached_abis (address, abi_json, name) VALUES (?, ?, ?)').run(address, JSON.stringify(abi), name)
    return c.json({ abi, name })
  }

  // Fallback: Sourcify
  const sourcifyUrl = `https://sourcify.dev/server/files/any/1/${address}`
  // ... similar flow

  return c.json({ error: 'ABI not found' }, 404)
})
```

**Extract events from ABI for the frontend dropdown:**
```typescript
// Frontend helper: extract event signatures from ABI
function extractEvents(abi) {
  return abi
    .filter(item => item.type === 'event')
    .map(event => ({
      name: event.name,
      signature: `${event.name}(${event.inputs.map(i => i.type).join(',')})`,
      inputs: event.inputs,
      topic0: keccak256(toBytes(`${event.name}(${event.inputs.map(i => i.type).join(',')})`))
    }))
}
```

#### `POST /api/scan` (MPP-Gated)

The core endpoint. Scans events and returns decoded results.

```typescript
app.post('/api/scan', async (c) => {
  const body = await c.req.json()
  const { contract_address, event_abi, from_block, to_block } = body

  // Calculate cost based on block range
  const blockSpan = to_block - from_block
  const cost = calculateCost(blockSpan) // see pricing below

  // MPP charge
  const response = await mppx.charge({ amount: cost.toString() })(c.req.raw)
  if (response.status === 402) return response.challenge

  // Parse event ABI to get topic0
  const eventAbi = parseAbiItem(event_abi) // viem helper
  const topic0 = encodeEventTopics({ abi: [eventAbi] })[0]

  // Call eth_getLogs via public RPC
  const logs = await publicClient.getLogs({
    address: contract_address,
    topics: [topic0],
    fromBlock: BigInt(from_block),
    toBlock: BigInt(to_block),
  })

  // Decode each log
  const decoded = logs.map(log => {
    const decoded = decodeEventLog({ abi: [eventAbi], data: log.data, topics: log.topics })
    return {
      block_number: Number(log.blockNumber),
      tx_hash: log.transactionHash,
      log_index: log.logIndex,
      args: Object.fromEntries(
        decoded.args.map((val, i) => [eventAbi.inputs[i].name, formatArg(val)])
      ),
    }
  })

  // Persist query
  const payerAddress = response.receipt?.source || 'unknown'
  const txHash = response.receipt?.txHash || ''
  db.prepare(`
    INSERT INTO queries (contract_address, event_signature, from_block, to_block, result_count, payer_address, tx_hash, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(contract_address, event_abi, from_block, to_block, decoded.length, payerAddress, txHash, cost.toString())

  return response.withReceipt(Response.json({
    events: decoded,
    count: decoded.length,
    block_range: { from: from_block, to: to_block },
    cost_usd: cost,
    tx_hash: txHash,
  }))
})
```

#### Pricing Function

```typescript
function calculateCost(blockSpan: number): number {
  // $0.01 base + $0.001 per 1000 blocks
  // Min: $0.01, Max: $0.10
  const base = 0.01
  const perThousand = 0.001
  const variable = Math.ceil(blockSpan / 1000) * perThousand
  return Math.min(Math.max(base + variable, 0.01), 0.10)
}
```

| Block Range | Cost |
|-------------|------|
| 1-1000 | $0.011 |
| 1000-10000 | $0.02 |
| 10000-50000 | $0.06 |
| 50000+ | $0.10 (capped) |

#### `GET /api/history?address=0x...` (Free)

```typescript
app.get('/api/history', (c) => {
  const address = c.req.query('address')
  if (!address) return c.json({ queries: [] })

  const queries = db.prepare(`
    SELECT * FROM queries WHERE payer_address = ? ORDER BY created_at DESC LIMIT 50
  `).all(address)

  return c.json({ queries })
})
```

#### `GET /api/popular` (Free)

```typescript
app.get('/api/popular', (c) => {
  const popular = db.prepare(`
    SELECT contract_address, COUNT(*) as query_count,
           (SELECT name FROM cached_abis WHERE address = contract_address) as name
    FROM queries
    GROUP BY contract_address
    ORDER BY query_count DESC
    LIMIT 20
  `).all()

  return c.json({ contracts: popular })
})
```

### Server Environment Variables

```bash
RECIPIENT_ADDRESS=0x...           # Tempo wallet receiving payments
ALCHEMY_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ETHERSCAN_API_KEY=...             # For ABI fetching
DB_PATH=./varzim.db               # SQLite path
PORT=3002                          # Different port from blosom (3001)
```

### Viem Public Client Setup

```typescript
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ALCHEMY_RPC_URL),
})
```

---

## Frontend Implementation

### Project Setup

```bash
cd web
npm create vite@latest . -- --template react
npm install wagmi viem @tanstack/react-query mppx framer-motion
```

### Copy from blosom

Copy these files directly from `../blosom/web/src/`:
- `lib/wagmi.js` — wagmi config (WebAuthn + Tempo chain). Change `keyManager` URL to point to port 3002
- `lib/mppx-client.js` — Mppx client init (identical)
- `components/WalletConnect.jsx` — wallet UI (identical)
- `index.css` — full design system (copy, then add scan-specific styles below)

### `index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>varzim</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

### `main.jsx`

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config } from './lib/wagmi'
import App from './App'
import './index.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
)
```

### `App.jsx`

```jsx
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { WalletConnect } from './components/WalletConnect'
import { ScanForm } from './components/ScanForm'
import { Results } from './components/Results'
import { QueryHistory } from './components/QueryHistory'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002'

export default function App() {
  const { address, isConnected } = useAccount()
  const [results, setResults] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)
  const [lastQuery, setLastQuery] = useState(null)

  const handleScan = async (query) => {
    setScanning(true)
    setError(null)
    setResults(null)
    setLastQuery(query)

    try {
      const res = await fetch(`${API}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      })
      if (!res.ok) throw new Error(`Scan failed: ${res.status}`)
      const data = await res.json()
      setResults(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="page">
      <WalletConnect />
      <ScanForm
        onScan={handleScan}
        scanning={scanning}
        isConnected={isConnected}
      />
      {error && <div className="error-toast">{error}</div>}
      {results && <Results data={results} query={lastQuery} />}
      {isConnected && <QueryHistory address={address} api={API} />}
    </div>
  )
}
```

### `components/ScanForm.jsx`

```jsx
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002'

// Pricing: $0.01 base + $0.001 per 1000 blocks, max $0.10
function calculateCost(fromBlock, toBlock) {
  if (!fromBlock || !toBlock || toBlock <= fromBlock) return null
  const span = toBlock - fromBlock
  const base = 0.01
  const variable = Math.ceil(span / 1000) * 0.001
  return Math.min(Math.max(base + variable, 0.01), 0.10)
}

export function ScanForm({ onScan, scanning, isConnected }) {
  const [contractAddress, setContractAddress] = useState('')
  const [events, setEvents] = useState([])       // parsed from ABI
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [fromBlock, setFromBlock] = useState('')
  const [toBlock, setToBlock] = useState('')
  const [loadingAbi, setLoadingAbi] = useState(false)
  const [contractName, setContractName] = useState(null)

  // Auto-fetch ABI when address is valid (42 chars)
  useEffect(() => {
    if (contractAddress.length !== 42) {
      setEvents([])
      setContractName(null)
      return
    }
    setLoadingAbi(true)
    fetch(`${API}/api/abis/${contractAddress}`)
      .then(r => r.json())
      .then(data => {
        if (data.abi) {
          const eventItems = data.abi
            .filter(item => item.type === 'event')
            .map(event => ({
              name: event.name,
              signature: `${event.name}(${event.inputs.map(i => `${i.type}${i.indexed ? ' indexed' : ''} ${i.name}`).join(', ')})`,
              abiItem: `event ${event.name}(${event.inputs.map(i => `${i.type}${i.indexed ? ' indexed' : ''} ${i.name}`).join(', ')})`,
              inputs: event.inputs,
            }))
          setEvents(eventItems)
          setContractName(data.name)
          if (eventItems.length > 0) setSelectedEvent(eventItems[0])
        }
      })
      .catch(() => setEvents([]))
      .finally(() => setLoadingAbi(false))
  }, [contractAddress])

  const cost = calculateCost(Number(fromBlock), Number(toBlock))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!selectedEvent || !fromBlock || !toBlock) return
    onScan({
      contract_address: contractAddress,
      event_abi: selectedEvent.abiItem,
      from_block: Number(fromBlock),
      to_block: Number(toBlock),
    })
  }

  return (
    <motion.form
      className="scan-form"
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Contract address input */}
      <div className="field">
        <label>Contract</label>
        <input
          type="text"
          placeholder="0x..."
          value={contractAddress}
          onChange={e => setContractAddress(e.target.value)}
          className="mono"
        />
        {contractName && <span className="contract-name">{contractName}</span>}
        {loadingAbi && <span className="loading-dot" />}
      </div>

      {/* Event selector dropdown (populated from ABI) */}
      {events.length > 0 && (
        <div className="field">
          <label>Event</label>
          <select
            value={selectedEvent?.name || ''}
            onChange={e => setSelectedEvent(events.find(ev => ev.name === e.target.value))}
          >
            {events.map(ev => (
              <option key={ev.name} value={ev.name}>{ev.signature}</option>
            ))}
          </select>
        </div>
      )}

      {/* Block range */}
      <div className="field-row">
        <div className="field">
          <label>From Block</label>
          <input type="number" value={fromBlock} onChange={e => setFromBlock(e.target.value)} placeholder="19840000" className="mono" />
        </div>
        <span className="range-dash">—</span>
        <div className="field">
          <label>To Block</label>
          <input type="number" value={toBlock} onChange={e => setToBlock(e.target.value)} placeholder="19841000" className="mono" />
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={!isConnected || !selectedEvent || !cost || scanning}
        className="scan-button"
      >
        {scanning ? (
          <span className="spinner" />
        ) : (
          <>Scan {cost ? `· $${cost.toFixed(3)}` : ''}</>
        )}
      </button>
    </motion.form>
  )
}
```

### `components/Results.jsx`

```jsx
import { motion, AnimatePresence } from 'framer-motion'

export function Results({ data, query }) {
  if (!data || !data.events) return null

  return (
    <motion.div
      className="results"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="results-header">
        <span className="results-count">{data.count} events</span>
        <span className="results-meta mono">
          blocks {data.block_range.from}–{data.block_range.to} · ${data.cost_usd}
        </span>
      </div>

      <div className="results-table">
        <div className="results-row results-row-header">
          <span>Block</span>
          <span>Tx</span>
          {/* Dynamic columns from event args */}
          {data.events[0] && Object.keys(data.events[0].args).map(key => (
            <span key={key}>{key}</span>
          ))}
        </div>

        <AnimatePresence>
          {data.events.map((event, i) => (
            <motion.div
              key={`${event.tx_hash}-${event.log_index}`}
              className="results-row"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <span className="mono">{event.block_number}</span>
              <span className="mono truncate">
                <a href={`https://etherscan.io/tx/${event.tx_hash}`} target="_blank" rel="noopener">
                  {event.tx_hash.slice(0, 10)}...
                </a>
              </span>
              {Object.values(event.args).map((val, j) => (
                <span key={j} className="mono truncate">{String(val)}</span>
              ))}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {data.tx_hash && (
        <div className="results-footer mono">
          Paid via Tempo · <a href={`https://explorer.tempo.xyz/tx/${data.tx_hash}`} target="_blank">{data.tx_hash.slice(0, 14)}...</a>
        </div>
      )}
    </motion.div>
  )
}
```

### `components/QueryHistory.jsx`

```jsx
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

export function QueryHistory({ address, api }) {
  const [queries, setQueries] = useState([])

  useEffect(() => {
    if (!address) return
    fetch(`${api}/api/history?address=${address}`)
      .then(r => r.json())
      .then(data => setQueries(data.queries || []))
      .catch(() => {})
  }, [address, api])

  if (queries.length === 0) return null

  return (
    <motion.div
      className="history"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <h3>Recent Queries</h3>
      {queries.map((q, i) => (
        <div key={q.id || i} className="history-row">
          <span className="mono truncate">{q.contract_address.slice(0, 10)}...</span>
          <span>{q.event_signature.split('(')[0]}</span>
          <span className="mono">{q.from_block}–{q.to_block}</span>
          <span className="results-count-small">{q.result_count} events</span>
          <span className="mono">${q.cost_usd}</span>
        </div>
      ))}
    </motion.div>
  )
}
```

### Additional CSS (append to copied index.css)

```css
/* === Varzim-specific styles === */

.page {
  max-width: 800px;
  margin: 0 auto;
  padding: 80px 24px 40px;
}

/* Scan Form */
.scan-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius);
  background: var(--bg-primary);
  margin-bottom: 24px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.field label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.field input,
.field select {
  padding: 10px 12px;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  font-size: 14px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s;
}

.field input:focus,
.field select:focus {
  border-color: var(--accent-purple);
}

.field input.mono,
.field select.mono {
  font-family: var(--font-mono);
}

.contract-name {
  position: absolute;
  right: 12px;
  top: 32px;
  font-size: 12px;
  color: var(--accent-purple);
  font-weight: 500;
}

.field-row {
  display: flex;
  gap: 12px;
  align-items: end;
}

.field-row .field { flex: 1; }

.range-dash {
  color: var(--text-tertiary);
  padding-bottom: 10px;
}

.scan-button {
  padding: 12px 24px;
  background: var(--text-primary);
  color: var(--bg-primary);
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
  font-family: var(--font-mono);
}

.scan-button:hover:not(:disabled) { opacity: 0.85; }
.scan-button:disabled { opacity: 0.3; cursor: not-allowed; }

/* Results */
.results {
  border: 1px solid var(--border-primary);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: 24px;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

.results-count {
  font-weight: 500;
  font-size: 13px;
}

.results-meta {
  font-size: 12px;
  color: var(--text-tertiary);
}

.results-table {
  overflow-x: auto;
}

.results-row {
  display: grid;
  grid-template-columns: 100px 120px repeat(auto-fit, minmax(120px, 1fr));
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-primary);
  font-size: 13px;
  align-items: center;
  gap: 8px;
}

.results-row:last-child { border-bottom: none; }

.results-row-header {
  font-weight: 500;
  color: var(--text-tertiary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: var(--bg-secondary);
}

.results-row a {
  color: var(--accent-purple);
  text-decoration: none;
}

.results-row a:hover { text-decoration: underline; }

.results-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--border-primary);
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
}

.results-footer a { color: var(--accent-purple); }

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* History */
.history {
  margin-top: 32px;
}

.history h3 {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.history-row {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-primary);
  font-size: 13px;
}

.results-count-small {
  color: var(--text-tertiary);
  font-size: 12px;
}

/* Loading */
.loading-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-purple);
  position: absolute;
  right: 12px;
  top: 38px;
  animation: pulse 1s infinite;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  display: inline-block;
  animation: spin 0.6s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

/* Error */
.error-toast {
  padding: 12px 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: var(--radius);
  color: #dc2626;
  font-size: 13px;
  margin-bottom: 16px;
}

.mono { font-family: var(--font-mono); }
```

---

## Wallet Connection (COPY FROM BLOSOM)

The wallet flow is identical to blosom. Copy these files from `../blosom/web/src/`:

1. **`lib/wagmi.js`** — only change: `KeyManager.http('http://localhost:3002/keys')` (port 3002)
2. **`lib/mppx-client.js`** — copy as-is
3. **`components/WalletConnect.jsx`** — copy as-is

Server-side, copy the tempo.ts key manager setup from `../blosom/server/index.ts`:
```typescript
import { Handler, Kv } from 'tempo.ts/server'

const keyManager = Handler.keyManager({
  kv: Kv.memory(),
  path: '/keys',
  rp: 'localhost',
})

app.all('/keys/*', (c) => keyManager.fetch(c.req.raw))
```

---

## Project Structure

```
varzim/
├── PROMPT.md              # This file
├── server/
│   ├── package.json
│   ├── index.ts           # Hono server, routes, MPP, key manager
│   ├── db.ts              # SQLite setup + queries
│   └── pricing.ts         # Cost calculation
├── web/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── index.css       # Copied from blosom + varzim additions
│       ├── components/
│       │   ├── WalletConnect.jsx  # Copied from blosom
│       │   ├── ScanForm.jsx
│       │   ├── Results.jsx
│       │   └── QueryHistory.jsx
│       └── lib/
│           ├── wagmi.js           # Copied from blosom (change port)
│           └── mppx-client.js     # Copied from blosom
```

---

## Quick Start

```bash
# Server
cd server
bun install
RECIPIENT_ADDRESS=0x... ALCHEMY_RPC_URL=https://... ETHERSCAN_API_KEY=... bun run index.ts

# Frontend (separate terminal)
cd web
npm install
npm run dev
```

---

## What Makes This a Good Hackathon Project

1. **Real utility**: `eth_getLogs` is something every developer needs. Wrapping it in MPP makes it instantly monetizable.
2. **Zero infrastructure**: No node needed — public RPC does the work.
3. **Clean MPP showcase**: Pay-per-query is the purest MPP use case.
4. **Composable**: Other hackathon projects could consume this as a paid API.
5. **Production path clear**: Replace public RPC with Reth ExEx for 100x performance + no rate limits. Charge per hour for live streaming via SSE.

---

## Links

- **Tempo Hackathon**: https://hackathon.tempo.xyz
- **MPP Docs**: https://mpp.dev
- **mppx SDK**: https://github.com/wevm/mppx
- **mpp-rs (Rust)**: https://github.com/tempoxyz/mpp-rs
- **Tempo Docs**: https://docs.tempo.xyz
- **Shadow.xyz (defunct reference)**: https://www.shadow.xyz/observability
- **Etherscan API**: https://docs.etherscan.io/api-endpoints/contracts
- **Sourcify**: https://docs.sourcify.dev
- **Blosom (sister project)**: https://github.com/figtracer/blosom
