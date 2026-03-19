import { Mppx, tempo } from 'mppx/client'
import { getConnectorClient } from 'wagmi/actions'
import { config } from './wagmi'

export function initMppx() {
  Mppx.create({
    methods: [tempo({
      getClient: (parameters) => getConnectorClient(config, parameters),
    })],
  })
}
