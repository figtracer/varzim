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
          <span className="mono">{q.from_block}&ndash;{q.to_block}</span>
          <span className="results-count-small">{q.result_count} events</span>
          <span className="mono">${q.cost_usd}</span>
        </div>
      ))}
    </motion.div>
  )
}
