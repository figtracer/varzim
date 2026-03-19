import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const MAX_VISIBLE = 15

export function LiveFeed({ events, currentBlock, watching, stats, expiresAt, txHash, costUsd, watchId, api, onStop }) {
  const [expanded, setExpanded] = useState(false)
  const minutesLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000)) : null

  const visibleEvents = expanded ? events : events.slice(0, MAX_VISIBLE)
  const hiddenCount = events.length - MAX_VISIBLE

  return (
    <motion.div
      className="results live-feed"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="results-header live-header">
        <div className="live-status">
          {watching && <span className="live-indicator" />}
          <span className="results-count">
            {watching ? 'Watching' : 'Stopped'}
          </span>
        </div>
        <div className="live-meta">
          {currentBlock && <span className="mono">block {currentBlock}</span>}
          {minutesLeft !== null && watching && <span>{minutesLeft}m left</span>}
          {watching && (
            <button className="stop-btn" onClick={onStop}>Stop</button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="live-stats">
          <div className="stat">
            <span className="stat-value mono">{stats.total_events}</span>
            <span className="stat-label">events</span>
          </div>
          <div className="stat">
            <span className="stat-value mono">{stats.events_per_min}</span>
            <span className="stat-label">per min</span>
          </div>
          <div className="stat">
            <span className="stat-value mono">{stats.unique_addresses}</span>
            <span className="stat-label">addresses</span>
          </div>
        </div>
      )}

      {/* Event table — capped */}
      <div className="results-table">
        {visibleEvents.length > 0 && (
          <div className="results-row results-row-header">
            <span>Block</span>
            <span>Tx</span>
            {Object.keys(visibleEvents[0].args).map(key => (
              <span key={key}>{key}</span>
            ))}
          </div>
        )}

        <AnimatePresence initial={false}>
          {visibleEvents.map((event) => (
            <motion.div
              key={`${event.tx_hash}-${event.log_index}`}
              className="results-row"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
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

        {events.length === 0 && watching && (
          <div className="live-waiting">
            <span className="spinner" /> Waiting for events...
          </div>
        )}
      </div>

      {/* Show more / collapse */}
      {!expanded && hiddenCount > 0 && (
        <button className="show-more-btn" onClick={() => setExpanded(true)}>
          +{hiddenCount} more events
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button className="show-more-btn" onClick={() => setExpanded(false)}>
          Show less
        </button>
      )}

      {/* Footer: tx hash + export */}
      <div className="results-footer mono live-footer">
        <div>
          {txHash && (
            <>Paid via Tempo {costUsd != null && <>&middot; ${costUsd}</>} &middot; <a href={`https://explorer.tempo.xyz/tx/${txHash}`} target="_blank" rel="noopener">{txHash.slice(0, 14)}...</a></>
          )}
        </div>
        {watchId && stats && stats.total_events > 0 && (
          <a href={`${api}/api/watch/${watchId}/export`} className="export-btn" download>
            Export CSV
          </a>
        )}
      </div>
    </motion.div>
  )
}
