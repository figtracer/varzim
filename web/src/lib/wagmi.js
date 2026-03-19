import { createConfig, http } from 'wagmi'
import { tempo } from 'viem/chains'
import { webAuthn, KeyManager } from 'wagmi/tempo'

export const config = createConfig({
  chains: [tempo],
  connectors: [
    webAuthn({
      keyManager: KeyManager.http('http://localhost:3002/keys'),
      rpId: 'localhost',
    }),
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempo.id]: http(),
  },
})
