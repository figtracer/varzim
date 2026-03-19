import { useState, useRef, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { WalletConnect } from './components/WalletConnect'
import { ScanForm } from './components/ScanForm'
import { Results } from './components/Results'
import { LiveFeed } from './components/LiveFeed'
import { QueryHistory } from './components/QueryHistory'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002'

export default function App() {
  const { address, isConnected } = useAccount()
  const [results, setResults] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)
  const [lastQuery, setLastQuery] = useState(null)

  // Watch state
  const [watching, setWatching] = useState(false)
  const [liveEvents, setLiveEvents] = useState([])
  const [currentBlock, setCurrentBlock] = useState(null)
  const [watchStats, setWatchStats] = useState(null)
  const [watchExpiresAt, setWatchExpiresAt] = useState(null)
  const [watchTxHash, setWatchTxHash] = useState(null)
  const [watchCostUsd, setWatchCostUsd] = useState(null)
  const [watchId, setWatchId] = useState(null)
  const eventSourceRef = useRef(null)

  const handleScan = async (query) => {
    stopWatch()
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

  const stopWatch = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setWatching(false)
  }, [])

  const handleWatch = async (query) => {
    stopWatch()
    setResults(null)
    setError(null)
    setLiveEvents([])
    setWatchStats(null)
    setCurrentBlock(null)
    setWatchTxHash(null)
    setWatchCostUsd(null)
    setWatchId(null)
    setWatching(true)

    try {
      const res = await fetch(`${API}/api/watch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      })
      if (!res.ok) throw new Error(`Watch failed: ${res.status}`)
      const data = await res.json()

      setWatchExpiresAt(data.expires_at)
      setWatchTxHash(data.tx_hash)
      setWatchCostUsd(data.cost_usd)
      setWatchId(data.watch_id)

      const params = new URLSearchParams({
        event_abi: query.event_abi,
        contract_address: query.contract_address,
      })
      const es = new EventSource(`${API}/api/watch/${data.watch_id}/stream?${params}`)
      eventSourceRef.current = es

      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          switch (msg.type) {
            case 'events':
              setLiveEvents(prev => [...msg.events, ...prev].slice(0, 200))
              setWatchStats(msg.stats)
              setCurrentBlock(msg.block)
              break
            case 'heartbeat':
              setCurrentBlock(msg.block)
              if (msg.stats) setWatchStats(msg.stats)
              break
            case 'synced':
              setCurrentBlock(msg.block)
              break
            case 'expired':
              setWatchStats(prev => ({ ...prev, total_events: msg.total_events }))
              stopWatch()
              break
            case 'error':
              setError(msg.message)
              break
          }
        } catch {}
      }

      es.onerror = () => {
        stopWatch()
        setError('Watch connection lost')
      }
    } catch (e) {
      setError(e.message)
      setWatching(false)
    }
  }

  const showLiveFeed = watching || liveEvents.length > 0

  return (
    <div className="page">
      <WalletConnect />
      <ScanForm
        onScan={handleScan}
        onWatch={handleWatch}
        scanning={scanning}
        watching={watching}
        isConnected={isConnected}
      />
      {error && <div className="error-toast">{error}</div>}
      {showLiveFeed && (
        <LiveFeed
          events={liveEvents}
          currentBlock={currentBlock}
          watching={watching}
          stats={watchStats}
          expiresAt={watchExpiresAt}
          txHash={watchTxHash}
          costUsd={watchCostUsd}
          watchId={watchId}
          api={API}
          onStop={stopWatch}
        />
      )}
      {results && <Results data={results} query={lastQuery} />}
      {isConnected && <QueryHistory address={address} api={API} />}
    </div>
  )
}
