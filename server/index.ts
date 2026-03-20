import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Mppx, tempo } from 'mppx/server'
import { Handler, Kv } from 'tempo.ts/server'
import { createPublicClient, http, parseAbiItem, decodeEventLog, encodeEventTopics } from 'viem'
import { mainnet } from 'viem/chains'
import { getDb } from './db'
import { calculateCost, WATCH_COST_PER_HOUR, WATCH_DURATION_MS, WATCH_POLL_INTERVAL_MS } from './pricing'

const app = new Hono()
app.use('*', cors({
  origin: '*',
  exposeHeaders: ['WWW-Authenticate', 'Payment-Receipt', 'Authorization'],
}))

const mppx = Mppx.create({
  methods: [
    tempo({
      currency: '0x20c000000000000000000000b9537d11c60e8b50', // USDC
      recipient: process.env.RECIPIENT_ADDRESS!,
    }),
  ],
})

// --- WEBAUTHN KEY MANAGER (tempo.ts) ---
// Persist keys in SQLite so they survive restarts/deploys
const kvDb = getDb()
kvDb.exec('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

const sqliteKv = Kv.from({
  async get(key: string) {
    const row = kvDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as any
    return row ? JSON.parse(row.value) : undefined
  },
  async set(key: string, value: unknown) {
    kvDb.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
  },
  async delete(key: string) {
    kvDb.prepare('DELETE FROM kv_store WHERE key = ?').run(key)
  },
})

const keyManager = Handler.keyManager({
  kv: sqliteKv,
  path: '/keys',
  rp: process.env.RAILWAY_PUBLIC_DOMAIN ? 'varzim.figtracer.com' : 'localhost',
})

app.all('/keys/*', (c) => keyManager.fetch(c.req.raw))

// --- AUTHORIZATION RELAY (cross-domain access key) ---
const authorizeRpId = process.env.RAILWAY_PUBLIC_DOMAIN ? 'varzim.figtracer.com' : 'localhost'

app.get('/authorize', (c) => {
  const url = new URL(c.req.url)
  const keyAddress = url.searchParams.get('keyAddress') ?? ''
  const hash = url.searchParams.get('hash') ?? ''
  const chainId = url.searchParams.get('chainId') ?? ''
  const expiry = url.searchParams.get('expiry') ?? ''
  const origin = url.searchParams.get('origin') ?? ''
  const rpId = authorizeRpId

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Authorize Access Key</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0a0a0a;
    color: #e0e0e0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }
  .card {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    padding: 2rem;
    max-width: 420px;
    width: 100%;
  }
  h1 { font-size: 1.25rem; margin-bottom: 1.5rem; color: #fff; }
  .field { margin-bottom: 1rem; }
  .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 0.25rem; }
  .value { font-size: 0.95rem; font-family: monospace; word-break: break-all; color: #ccc; }
  .origin-value { color: #6ea8fe; }
  .actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
  button {
    flex: 1; padding: 0.75rem 1rem; border: none; border-radius: 8px;
    font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-approve { background: #22c55e; color: #000; }
  .btn-deny { background: #333; color: #e0e0e0; }
  .status { margin-top: 1rem; font-size: 0.85rem; color: #888; min-height: 1.2em; }
  .status.error { color: #f87171; }
</style>
</head>
<body>
<div class="card">
  <h1>Authorize Access Key</h1>
  <div class="field">
    <div class="label">Access Key</div>
    <div class="value" id="keyAddress"></div>
  </div>
  <div class="field">
    <div class="label">Expires</div>
    <div class="value" id="expiry"></div>
  </div>
  <div class="field">
    <div class="label">Requesting Origin</div>
    <div class="value origin-value" id="origin"></div>
  </div>
  <div class="field">
    <div class="label">Chain ID</div>
    <div class="value" id="chainId"></div>
  </div>
  <div class="actions">
    <button class="btn-deny" id="denyBtn">Deny</button>
    <button class="btn-approve" id="approveBtn">Approve</button>
  </div>
  <div class="status" id="status"></div>
</div>
<script>
(function() {
  var params = {
    keyAddress: ${JSON.stringify(keyAddress)},
    hash: ${JSON.stringify(hash)},
    chainId: ${JSON.stringify(chainId)},
    expiry: ${JSON.stringify(expiry)},
    origin: ${JSON.stringify(origin)},
  };
  var rpId = ${JSON.stringify(rpId)};

  var truncated = params.keyAddress.length > 12
    ? params.keyAddress.slice(0, 6) + '...' + params.keyAddress.slice(-4)
    : params.keyAddress;
  document.getElementById('keyAddress').textContent = truncated;

  var expiryNum = parseInt(params.expiry, 10);
  document.getElementById('expiry').textContent = expiryNum
    ? new Date(expiryNum * 1000).toLocaleString()
    : 'Unknown';

  document.getElementById('origin').textContent = params.origin || 'Unknown';
  document.getElementById('chainId').textContent = params.chainId || 'Unknown';

  var statusEl = document.getElementById('status');

  function hexToBytes(hex) {
    var h = hex.startsWith('0x') ? hex.slice(2) : hex;
    var bytes = new Uint8Array(h.length / 2);
    for (var i = 0; i < h.length; i += 2)
      bytes[i / 2] = parseInt(h.substring(i, i + 2), 16);
    return bytes;
  }

  function bufferToBase64url(buf) {
    var bytes = new Uint8Array(buf);
    var str = '';
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
  }

  function sendResult(msg) {
    if (window.opener) {
      window.opener.postMessage(msg, params.origin || '*');
    }
    setTimeout(function() { window.close(); }, 200);
  }

  document.getElementById('denyBtn').addEventListener('click', function() {
    sendResult({ type: 'keyAuthorization', error: 'denied' });
  });

  document.getElementById('approveBtn').addEventListener('click', async function() {
    var approveBtn = document.getElementById('approveBtn');
    var denyBtn = document.getElementById('denyBtn');
    approveBtn.disabled = true;
    denyBtn.disabled = true;
    statusEl.textContent = 'Waiting for passkey...';
    statusEl.className = 'status';

    try {
      var challenge = hexToBytes(params.hash);

      var assertion = await navigator.credentials.get({
        publicKey: {
          challenge: challenge,
          rpId: rpId,
          userVerification: 'required',
        },
      });

      var response = assertion.response;

      var result = {
        type: 'keyAuthorization',
        credential: {
          id: assertion.id,
          rawId: bufferToBase64url(assertion.rawId),
          response: {
            authenticatorData: bufferToBase64url(response.authenticatorData),
            clientDataJSON: bufferToBase64url(response.clientDataJSON),
            signature: bufferToBase64url(response.signature),
          },
          type: assertion.type,
        },
      };

      sendResult(result);
    } catch (err) {
      statusEl.textContent = 'Error: ' + (err.message || 'Passkey signing failed');
      statusEl.className = 'status error';
      approveBtn.disabled = false;
      denyBtn.disabled = false;
    }
  });
})();
</script>
</body>
</html>`

  return c.html(html)
})

// --- Viem Public Client ---
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ALCHEMY_RPC_URL),
})

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || ''
const db = getDb()

// --- Helper ---
function formatArg(val: unknown): string {
  if (typeof val === 'bigint') return val.toString()
  if (typeof val === 'object' && val !== null) return JSON.stringify(val)
  return String(val)
}

// --- FREE ENDPOINTS ---

// Pricing info — single source of truth
app.get('/api/pricing', (c) => {
  return c.json({
    scan: {
      base: 0.01,
      per_thousand_blocks: 0.001,
      min: 0.01,
      max: 0.10,
    },
    watch: {
      cost_per_hour: WATCH_COST_PER_HOUR,
      duration_minutes: WATCH_DURATION_MS / 60000,
    },
  })
})

// Fetch and cache contract ABI
app.get('/api/abis/:address', async (c) => {
  const address = c.req.param('address')

  // Check cache
  const cached = db.prepare('SELECT abi_json, name FROM cached_abis WHERE address = ?').get(address) as any
  if (cached) return c.json({ abi: JSON.parse(cached.abi_json), name: cached.name })

  // Fetch from Etherscan
  const etherscanUrl = `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_KEY}`
  const res = await fetch(etherscanUrl)
  const data = await res.json() as any

  if (data.status === '1') {
    const abi = JSON.parse(data.result)
    // Also fetch contract name
    const nameRes = await fetch(`https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${ETHERSCAN_KEY}`)
    const nameData = await nameRes.json() as any
    const name = nameData.result?.[0]?.ContractName || null

    db.prepare('INSERT OR REPLACE INTO cached_abis (address, abi_json, name) VALUES (?, ?, ?)').run(address, JSON.stringify(abi), name)
    return c.json({ abi, name })
  }

  // Fallback: Sourcify
  try {
    const sourcifyUrl = `https://sourcify.dev/server/files/any/1/${address}`
    const sourcifyRes = await fetch(sourcifyUrl)
    if (sourcifyRes.ok) {
      const sourcifyData = await sourcifyRes.json() as any
      // Sourcify returns files array, find the metadata or ABI
      const metadataFile = sourcifyData.files?.find((f: any) => f.name === 'metadata.json')
      if (metadataFile) {
        const metadata = JSON.parse(metadataFile.content)
        const abi = metadata.output?.abi
        if (abi) {
          const name = Object.keys(metadata.settings?.compilationTarget || {})[0] || null
          db.prepare('INSERT OR REPLACE INTO cached_abis (address, abi_json, name) VALUES (?, ?, ?)').run(address, JSON.stringify(abi), name)
          return c.json({ abi, name })
        }
      }
    }
  } catch {
    // Sourcify failed, fall through
  }

  return c.json({ error: 'ABI not found' }, 404)
})

// Query history for a wallet
app.get('/api/history', (c) => {
  const address = c.req.query('address')
  if (!address) return c.json({ queries: [] })

  const queries = db.prepare(`
    SELECT * FROM queries WHERE payer_address = ? ORDER BY created_at DESC LIMIT 50
  `).all(address)

  return c.json({ queries })
})

// Most-queried contracts
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

// --- MPP-GATED ENDPOINT ---

app.post('/api/scan', async (c) => {
  try {
  const body = await c.req.json()
  const { contract_address, event_abi, from_block, to_block } = body

  // Calculate cost based on block range
  const blockSpan = to_block - from_block
  const cost = calculateCost(blockSpan)

  // MPP charge
  const response = await mppx.charge({ amount: cost.toString() })(c.req.raw)
  if (response.status === 402) return response.challenge

  // Parse event ABI to get topic0
  const eventAbi = parseAbiItem(event_abi) as any
  const topic0 = encodeEventTopics({ abi: [eventAbi] })[0]

  // Call eth_getLogs via public RPC
  const logs = await publicClient.getLogs({
    address: contract_address as `0x${string}`,
    topics: [topic0],
    fromBlock: BigInt(from_block),
    toBlock: BigInt(to_block),
  })

  // Decode each log (skip undecodable)
  const decoded = logs.flatMap(log => {
    try {
      const result = decodeEventLog({ abi: [eventAbi], data: log.data, topics: log.topics })
      const args: Record<string, string> = {}
      if (result.args) {
        if (Array.isArray(result.args)) {
          result.args.forEach((val: unknown, i: number) => {
            args[eventAbi.inputs[i].name] = formatArg(val)
          })
        } else {
          for (const [key, val] of Object.entries(result.args)) {
            args[key] = formatArg(val)
          }
        }
      }
      return [{
        block_number: Number(log.blockNumber),
        tx_hash: log.transactionHash,
        log_index: log.logIndex,
        args,
      }]
    } catch {
      return []
    }
  })

  // Persist query — mppx receipt has `reference` (tx hash), not `txHash`
  const txHash = (response as any).reference || ''
  db.prepare(`
    INSERT INTO queries (contract_address, event_signature, from_block, to_block, result_count, payer_address, tx_hash, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(contract_address, event_abi, from_block, to_block, decoded.length, 'unknown', txHash, cost.toString())

  return (response as any).withReceipt(Response.json({
    events: decoded,
    count: decoded.length,
    block_range: { from: from_block, to: to_block },
    cost_usd: cost,
    tx_hash: txHash,
  }))
  } catch (err) {
    console.error('[scan error]', err)
    return c.json({ error: String(err) }, 500)
  }
})

// --- SHADOW WATCH: Live event streaming via SSE ---

// Track active watches for the status endpoint
const activeWatches = new Map<string, { contract: string, event: string, expiresAt: number }>()

// Start a live watch — charges $0.05/hr, returns SSE stream
app.post('/api/watch', async (c) => {
  try {
    // MPP charge first (before reading body, since mppx needs the raw request)
    const response = await mppx.charge({ amount: WATCH_COST_PER_HOUR.toString() })(c.req.raw)
    if (response.status === 402) return response.challenge

    const body = await c.req.json()
    const { contract_address, event_abi } = body

    const watchId = crypto.randomUUID()
    const expiresAt = Date.now() + WATCH_DURATION_MS

    activeWatches.set(watchId, {
      contract: contract_address,
      event: event_abi.split('(')[0]?.replace('event ', '') || event_abi,
      expiresAt,
    })

    // Persist the watch as a query — mppx receipt has `reference` (tx hash)
    const txHash = (response as any).reference || ''
    db.prepare(`
      INSERT INTO queries (contract_address, event_signature, from_block, to_block, result_count, payer_address, tx_hash, cost_usd)
      VALUES (?, ?, 0, 0, 0, ?, ?, ?)
    `).run(contract_address, `[watch] ${event_abi}`, 'unknown', txHash, WATCH_COST_PER_HOUR.toString())

    // Return the watch ID so the client can connect to the SSE stream
    return (response as any).withReceipt(Response.json({
      watch_id: watchId,
      expires_at: expiresAt,
      cost_usd: WATCH_COST_PER_HOUR,
      tx_hash: txHash,
    }))
  } catch (err) {
    console.error('[watch error]', err)
    return c.json({ error: String(err) }, 500)
  }
})

// SSE stream for an active watch
app.get('/api/watch/:id/stream', (c) => {
  const watchId = c.req.param('id')
  const watch = activeWatches.get(watchId)
  if (!watch) return c.json({ error: 'Watch not found or expired' }, 404)

  // Re-parse the event ABI from the stored data
  // The client sends the event_abi as a query param for the stream
  const eventAbiStr = c.req.query('event_abi')
  const contractAddress = c.req.query('contract_address')
  if (!eventAbiStr || !contractAddress) return c.json({ error: 'Missing event_abi or contract_address' }, 400)

  const eventAbi = parseAbiItem(eventAbiStr) as any
  const topic0 = encodeEventTopics({ abi: [eventAbi] })[0]

  // Prepared statement for persisting events
  const insertEvent = db.prepare(
    'INSERT INTO watch_events (watch_id, block_number, tx_hash, log_index, args_json) VALUES (?, ?, ?, ?, ?)'
  )

  return c.newResponse(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        let lastBlock = 0n
        let totalEvents = 0
        const uniqueAddresses = new Set<string>()
        const startTime = Date.now()

        // Send initial connected message
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', watch_id: watchId, expires_at: watch.expiresAt })}\n\n`))

        const interval = setInterval(async () => {
          try {
            // Check expiry
            if (Date.now() >= watch.expiresAt) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'expired', total_events: totalEvents })}\n\n`))
              clearInterval(interval)
              activeWatches.delete(watchId)
              controller.close()
              return
            }

            // Get current block
            const currentBlock = await publicClient.getBlockNumber()

            // On first poll, start from current block
            if (lastBlock === 0n) {
              lastBlock = currentBlock
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'synced', block: Number(currentBlock) })}\n\n`))
              return
            }

            // No new blocks
            if (currentBlock <= lastBlock) return

            // Fetch logs for new blocks
            const logs = await publicClient.getLogs({
              address: contractAddress as `0x${string}`,
              topics: [topic0],
              fromBlock: lastBlock + 1n,
              toBlock: currentBlock,
            })

            lastBlock = currentBlock

            if (logs.length === 0) {
              // Send heartbeat with stats
              const elapsedMin = (Date.now() - startTime) / 60000
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'heartbeat',
                block: Number(currentBlock),
                stats: {
                  total_events: totalEvents,
                  unique_addresses: uniqueAddresses.size,
                  events_per_min: elapsedMin > 0 ? +(totalEvents / elapsedMin).toFixed(1) : 0,
                },
              })}\n\n`))
              return
            }

            // Decode and send events (skip logs that can't be decoded)
            const decoded = logs.flatMap(log => {
              try {
                const result = decodeEventLog({ abi: [eventAbi], data: log.data, topics: log.topics })
                const args: Record<string, string> = {}
                if (result.args) {
                  if (Array.isArray(result.args)) {
                    result.args.forEach((val: unknown, i: number) => {
                      args[eventAbi.inputs[i].name] = formatArg(val)
                    })
                  } else {
                    for (const [key, val] of Object.entries(result.args)) {
                      args[key] = formatArg(val)
                    }
                  }
                }
                return [{
                  block_number: Number(log.blockNumber),
                  tx_hash: log.transactionHash,
                  log_index: log.logIndex,
                  args,
                }]
              } catch {
                return [] // skip undecodable logs
              }
            })

            // Persist events to DB
            for (const ev of decoded) {
              insertEvent.run(watchId, ev.block_number, ev.tx_hash, ev.log_index, JSON.stringify(ev.args))
              // Track unique addresses from args
              for (const val of Object.values(ev.args)) {
                if (typeof val === 'string' && val.startsWith('0x') && val.length === 42) {
                  uniqueAddresses.add(val.toLowerCase())
                }
              }
            }

            totalEvents += decoded.length
            const elapsedMin = (Date.now() - startTime) / 60000

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'events',
              events: decoded,
              block: Number(currentBlock),
              stats: {
                total_events: totalEvents,
                unique_addresses: uniqueAddresses.size,
                events_per_min: elapsedMin > 0 ? +(totalEvents / elapsedMin).toFixed(1) : 0,
              },
            })}\n\n`))
          } catch (err) {
            // Send error but don't kill the stream
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`))
          }
        }, WATCH_POLL_INTERVAL_MS)

        // Cleanup on client disconnect
        c.req.raw.signal?.addEventListener('abort', () => {
          clearInterval(interval)
          activeWatches.delete(watchId)
        })
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } }
  )
})

// Export watch session as CSV
app.get('/api/watch/:id/export', (c) => {
  const watchId = c.req.param('id')
  const events = db.prepare(
    'SELECT block_number, tx_hash, log_index, args_json, created_at FROM watch_events WHERE watch_id = ? ORDER BY id ASC'
  ).all(watchId) as any[]

  if (events.length === 0) return c.json({ error: 'No events found for this watch' }, 404)

  // Build CSV
  const firstArgs = JSON.parse(events[0].args_json)
  const argKeys = Object.keys(firstArgs)
  const header = ['block_number', 'tx_hash', 'log_index', ...argKeys, 'timestamp'].join(',')
  const rows = events.map((ev: any) => {
    const args = JSON.parse(ev.args_json)
    return [ev.block_number, ev.tx_hash, ev.log_index, ...argKeys.map(k => args[k] ?? ''), ev.created_at].join(',')
  })

  const csv = [header, ...rows].join('\n')
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="watch-${watchId.slice(0, 8)}.csv"`,
    },
  })
})

// Active watches status (free)
app.get('/api/watches', (c) => {
  const now = Date.now()
  const watches = Array.from(activeWatches.entries())
    .filter(([, w]) => w.expiresAt > now)
    .map(([id, w]) => ({
      id,
      contract: w.contract,
      event: w.event,
      minutes_remaining: Math.ceil((w.expiresAt - now) / 60000),
    }))
  return c.json({ watches })
})

export default {
  port: parseInt(process.env.PORT || '3002'),
  idleTimeout: 255, // max for Bun — keeps SSE streams alive
  fetch: app.fetch,
}
