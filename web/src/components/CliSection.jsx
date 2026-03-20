import { useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002'

const EXAMPLES = {
  watch: `tempo request -X POST --json '{"contract_address":"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2","event_abi":"event Transfer(address indexed src, address indexed dst, uint256 wad)"}' "${API}/api/watch"`,
  scan: `tempo request -X POST --json '{"contract_address":"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2","event_abi":"event Transfer(address indexed src, address indexed dst, uint256 wad)","from_block":24690000,"to_block":24690100}' "${API}/api/scan"`,
  stream: `curl -sN "${API}/api/watch/<watch_id>/stream?event_abi=event+Transfer(...)&contract_address=0xC02..."`,
}

export function CliSection() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(null)
  const [activeTab, setActiveTab] = useState('watch')

  const copy = (key) => {
    navigator.clipboard.writeText(EXAMPLES[key])
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <>
      <button className="cli-trigger" onClick={() => setOpen(true)} title="CLI / Agent usage">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
          <text x="8" y="12" textAnchor="middle" fill="currentColor" fontSize="11" fontWeight="600">i</text>
        </svg>
      </button>

      {open && (
        <div className="cli-backdrop" onClick={() => setOpen(false)}>
          <div className="cli-modal" onClick={e => e.stopPropagation()}>
            <button className="cli-close" onClick={() => setOpen(false)}>×</button>

            <div className="cli-header">
              <h3>CLI / Agent</h3>
              <span className="cli-badge">no wallet setup needed</span>
            </div>
            <p className="cli-desc">
              use your existing tempo wallet from the terminal — copy the commands below, or point your agent at the api.
            </p>

            <div className="cli-tabs">
              {['watch', 'scan', 'stream'].map(tab => (
                <button
                  key={tab}
                  className={`cli-tab ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="cli-code-wrap">
              <pre className="cli-code">{EXAMPLES[activeTab]}</pre>
              <button className="cli-copy" onClick={() => copy(activeTab)}>
                {copied === activeTab ? 'copied' : 'copy'}
              </button>
            </div>

            <div className="cli-steps">
              <div className="cli-step">
                <span className="cli-step-num">1</span>
                <span>install tempo cli — <code>curl -fsSL https://tempo.xyz/install | bash</code></span>
              </div>
              <div className="cli-step">
                <span className="cli-step-num">2</span>
                <span>login — <code>tempo wallet login</code></span>
              </div>
              <div className="cli-step">
                <span className="cli-step-num">3</span>
                <span>run the command above. payment happens automatically.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
