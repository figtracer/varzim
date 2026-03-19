import { createConfig, http } from 'wagmi'
import { tempo } from 'viem/chains'
import { webAuthn, KeyManager } from 'wagmi/tempo'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002'
const rpId = API.includes('localhost') ? 'localhost' : 'varzim.figtracer.com'

export const config = createConfig({
  chains: [tempo],
  connectors: [
    webAuthn({
      keyManager: KeyManager.http(`${API}/keys`),
      rpId,
    }),
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempo.id]: http(),
  },
})
