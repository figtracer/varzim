/**
 * Simplified cross-domain access key connector for local testing.
 *
 * Generates a secp256k1 key locally, opens a popup to the authorization relay
 * on the server (where the user's passkey lives), and waits for the signed
 * credential via postMessage. The signed authorization + local private key are
 * persisted in localStorage so subsequent page loads skip the popup.
 *
 * This is a standalone implementation that mirrors the logic from the modified
 * wagmi crossDomainAccessKey connector, without requiring the modified wagmi
 * build.
 */

const STORAGE_PREFIX = 'varzim:crossDomain:'

/**
 * Open a popup to the authorization relay URL and wait for the signed
 * credential to come back via postMessage.
 */
function requestCrossDomainAuthorization({ authorizationUrl, keyAddress, hash, chainId, expiry }) {
  const url = new URL(authorizationUrl)
  url.searchParams.set('keyAddress', keyAddress)
  url.searchParams.set('hash', hash)
  url.searchParams.set('chainId', String(chainId))
  url.searchParams.set('expiry', String(expiry))
  url.searchParams.set('origin', window.location.origin)

  return new Promise((resolve, reject) => {
    const width = 500
    const height = 600
    const left = window.screenX + (window.innerWidth - width) / 2
    const top = window.screenY + (window.innerHeight - height) / 2

    const popup = window.open(
      url.toString(),
      'tempo-authorize',
      `width=${width},height=${height},left=${left},top=${top},popup=true`,
    )

    if (!popup) {
      reject(new Error('Failed to open authorization popup. Check popup blocker.'))
      return
    }

    const expectedOrigin = url.origin

    const onMessage = (event) => {
      if (event.origin !== expectedOrigin) return
      if (event.data?.type !== 'keyAuthorization') return

      cleanup()

      if (event.data.error) {
        reject(new Error(event.data.error))
        return
      }

      resolve(event.data.credential)
    }

    const pollClosed = setInterval(() => {
      if (popup.closed) {
        cleanup()
        reject(new Error('Authorization popup was closed.'))
      }
    }, 500)

    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      clearInterval(pollClosed)
      try { popup.close() } catch {}
    }

    window.addEventListener('message', onMessage)
  })
}

/**
 * Get the stored cross-domain session from localStorage, if any.
 * Returns { privateKey, address, credential, expiry } or null.
 */
export function getStoredSession() {
  try {
    const json = localStorage.getItem(STORAGE_PREFIX + 'session')
    if (!json) return null
    const session = JSON.parse(json)
    // Check expiry
    if (session.expiry && session.expiry < Date.now() / 1000) {
      localStorage.removeItem(STORAGE_PREFIX + 'session')
      return null
    }
    return session
  } catch {
    return null
  }
}

/**
 * Clear the stored cross-domain session.
 */
export function clearSession() {
  localStorage.removeItem(STORAGE_PREFIX + 'session')
}

/**
 * Initiate the cross-domain access key flow:
 * 1. Generate a secp256k1 private key (via viem)
 * 2. Open popup to authorization URL
 * 3. Wait for signed credential
 * 4. Store everything in localStorage
 *
 * Returns { privateKey, address, credential, expiry }
 */
export async function connectCrossDomain({ authorizationUrl, chainId, expiry }) {
  // Dynamically import viem to generate the key
  const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts')
  const { hashMessage, keccak256, encodePacked } = await import('viem')

  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  const keyAddress = account.address

  // Build the hash that the passkey needs to sign (key authorization sign payload).
  // This mirrors KeyAuthorization.getSignPayload from ox/tempo:
  //   keccak256(abi.encodePacked(address, chainId, expiry, type))
  // For testing we use a simplified hash — the popup will sign whatever hash we send.
  const expiryTs = expiry ?? Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000)

  // Simplified hash: keccak256 of the key address + chainId + expiry
  const hash = keccak256(
    encodePacked(
      ['address', 'uint256', 'uint256'],
      [keyAddress, BigInt(chainId || 0), BigInt(expiryTs)],
    ),
  )

  const credential = await requestCrossDomainAuthorization({
    authorizationUrl,
    keyAddress,
    hash,
    chainId: chainId || 0,
    expiry: expiryTs,
  })

  const session = {
    privateKey,
    address: keyAddress,
    credential,
    expiry: expiryTs,
    chainId: chainId || 0,
    hash,
  }

  localStorage.setItem(STORAGE_PREFIX + 'session', JSON.stringify(session))

  return session
}
