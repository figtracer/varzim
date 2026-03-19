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
          blocks {data.block_range.from}&ndash;{data.block_range.to} &middot; ${data.cost_usd}
        </span>
      </div>

      <div className="results-table">
        <div className="results-row results-row-header">
          <span>Block</span>
          <span>Tx</span>
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
          Paid via Tempo &middot; <a href={`https://explorer.tempo.xyz/tx/${data.tx_hash}`} target="_blank" rel="noopener">{data.tx_hash.slice(0, 14)}...</a>
        </div>
      )}
    </motion.div>
  )
}
