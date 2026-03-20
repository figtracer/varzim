import { useEffect, useState } from 'react'
import { useAccount, useConnect, useConnectors, useDisconnect } from 'wagmi'
import { initMppx } from '../lib/mppx-client'
import { connectCrossDomain, getStoredSession, clearSession } from '../lib/crossDomainConnector'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002'

export function WalletConnect() {
  const { address, isConnected } = useAccount()
  const connect = useConnect()
  const connectors = useConnectors()
  const { disconnect } = useDisconnect()
  const [floats, setFloats] = useState([])

  // Cross-domain state (independent of wagmi)
  const [crossDomainSession, setCrossDomainSession] = useState(() => getStoredSession())
  const [crossDomainPending, setCrossDomainPending] = useState(false)
  const [crossDomainError, setCrossDomainError] = useState(null)

  useEffect(() => {
    if (isConnected) {
      initMppx()
    }
  }, [isConnected])

  const copyAddress = (e) => {
    const addr = address || crossDomainSession?.address
    if (!addr) return
    navigator.clipboard.writeText(addr)
    const id = Date.now()
    const rect = e.currentTarget.getBoundingClientRect()
    setFloats(prev => [...prev, { id, x: e.clientX - rect.left }])
    setTimeout(() => setFloats(prev => prev.filter(f => f.id !== id)), 1200)
  }

  const handleCrossDomainConnect = async () => {
    setCrossDomainPending(true)
    setCrossDomainError(null)
    try {
      const session = await connectCrossDomain({
        authorizationUrl: `${API}/authorize`,
        chainId: 0, // will be filled by the chain config
      })
      setCrossDomainSession(session)
    } catch (err) {
      setCrossDomainError(err.message || 'Cross-domain connection failed')
    } finally {
      setCrossDomainPending(false)
    }
  }

  const handleCrossDomainDisconnect = () => {
    clearSession()
    setCrossDomainSession(null)
  }

  // Show pending state for either flow
  if (connect.isPending || crossDomainPending) {
    return (
      <div className="wallet-connect">
        <span className="wallet-pending">
          {crossDomainPending ? 'Waiting for authorization...' : 'Check biometric prompt...'}
        </span>
      </div>
    )
  }

  // Connected via cross-domain access key
  if (crossDomainSession && !isConnected) {
    const addr = crossDomainSession.address
    return (
      <div className="wallet-connected">
        <span className="wallet-dot wallet-dot-cross" />
        <button className="wallet-address" onClick={copyAddress} title={addr}>
          {addr?.slice(0, 6)}...{addr?.slice(-4)}
          {floats.map(f => (
            <span key={f.id} className="copy-float" style={{ left: f.x }}>copied!</span>
          ))}
        </button>
        <span className="cross-domain-badge">access key</span>
        <button className="disconnect-btn" onClick={handleCrossDomainDisconnect}>
          Sign out
        </button>
      </div>
    )
  }

  // Connected via passkey (wagmi)
  if (isConnected) {
    return (
      <div className="wallet-connected">
        <span className="wallet-dot" />
        <button className="wallet-address" onClick={copyAddress} title={address}>
          {address?.slice(0, 6)}...{address?.slice(-4)}
          {floats.map(f => (
            <span key={f.id} className="copy-float" style={{ left: f.x }}>copied!</span>
          ))}
        </button>
        <button className="disconnect-btn" onClick={() => disconnect()}>
          Sign out
        </button>
      </div>
    )
  }

  const [connector] = connectors

  return (
    <div className="wallet-connect">
      {connector && (
        <>
          <button
            className="connect-btn connect-btn-primary"
            onClick={() => connect.connect({
              connector,
              capabilities: { type: 'sign-up' },
            })}
          >
            Sign Up
          </button>
          <button
            className="connect-btn"
            onClick={() => connect.connect({ connector })}
          >
            Sign In
          </button>
        </>
      )}

      <button
        className="connect-btn connect-btn-cross"
        onClick={handleCrossDomainConnect}
        title="Connect using a passkey from another domain"
      >
        Tempo Connect
      </button>

      {(connect.error || crossDomainError) && (
        <div className="wallet-error-toast">
          {crossDomainError || 'Connection failed'}
        </div>
      )}
    </div>
  )
}
