import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002'

export function ScanForm({ onScan, onWatch, scanning, watching, isConnected }) {
  const [mode, setMode] = useState('scan') // 'scan' | 'watch'
  const [contractAddress, setContractAddress] = useState('')
  const [events, setEvents] = useState([])
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

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!selectedEvent) return

    if (mode === 'scan') {
      if (!fromBlock || !toBlock) return
      onScan({
        contract_address: contractAddress,
        event_abi: selectedEvent.abiItem,
        from_block: Number(fromBlock),
        to_block: Number(toBlock),
      })
    } else {
      onWatch({
        contract_address: contractAddress,
        event_abi: selectedEvent.abiItem,
      })
    }
  }

  const canSubmit = mode === 'scan'
    ? isConnected && selectedEvent && fromBlock && toBlock && Number(toBlock) > Number(fromBlock) && !scanning
    : isConnected && selectedEvent && !watching

  return (
    <motion.form
      className="scan-form"
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Mode toggle */}
      <div className="mode-toggle">
        <button
          type="button"
          className={`mode-btn ${mode === 'scan' ? 'active' : ''}`}
          onClick={() => setMode('scan')}
        >
          Scan
        </button>
        <button
          type="button"
          className={`mode-btn ${mode === 'watch' ? 'active' : ''}`}
          onClick={() => setMode('watch')}
        >
          <span className="watch-dot" />
          Watch
        </button>
      </div>

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

      {/* Block range — only in scan mode */}
      {mode === 'scan' && (
        <div className="field-row">
          <div className="field">
            <label>From Block</label>
            <input type="number" value={fromBlock} onChange={e => setFromBlock(e.target.value)} placeholder="19840000" className="mono" />
          </div>
          <span className="range-dash">&mdash;</span>
          <div className="field">
            <label>To Block</label>
            <input type="number" value={toBlock} onChange={e => setToBlock(e.target.value)} placeholder="19841000" className="mono" />
          </div>
        </div>
      )}

      {/* Watch mode info */}
      {mode === 'watch' && (
        <div className="watch-info">
          Live stream of events as they happen on-chain. Charged per hour per contract.
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={`scan-button ${mode === 'watch' ? 'watch-button' : ''}`}
      >
        {scanning || watching ? (
          <span className="spinner" />
        ) : mode === 'scan' ? (
          'Scan'
        ) : (
          'Watch'
        )}
      </button>
    </motion.form>
  )
}
