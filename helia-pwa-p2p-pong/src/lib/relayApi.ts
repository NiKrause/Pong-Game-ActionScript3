export const LEGACY_DEFAULT_RELAY_MULTIADDR =
  '/dns4/libp2p.le-space.de/tcp/443/tls/sni/libp2p.le-space.de/ws/p2p/12D3KooWSHiPfALRy8rGZ1o3L68hV5vuADQvBt57uZucN36YpK9D'

export const DEFAULT_RELAY_MULTIADDR =
  '/ip4/95.217.163.72/tcp/8443/tls/sni/95-217-163-72.k51qzi5uqu5dma6jqaa7ij2x6pn2it5wokit6j6h0ygenjgfxyzg729zdcdvik.libp2p.direct/ws/p2p/12D3KooWSHiPfALRy8rGZ1o3L68hV5vuADQvBt57uZucN36YpK9D'

export function relayMultiaddr(): string {
  return (import.meta.env.VITE_RELAY_MULTIADDR?.trim() || DEFAULT_RELAY_MULTIADDR).trim()
}

export function relayPeerIdFromMultiaddr(addr: string): string {
  const match = addr.trim().match(/\/p2p\/([^/]+)$/)
  return match?.[1] ?? ''
}

/**
 * Short UI label for a dial multiaddr (browser-relevant layers first).
 * Note: `/ws` without `/tls/` becomes `ws://` in the stack; `/tls/.../ws` becomes `wss://`.
 */
export function transportLabel(ma: string): string {
  if (ma.includes('/webtransport')) return 'WebTransport'
  if (ma.includes('/webrtc') || ma.includes('/certhash')) return 'WebRTC'

  const hasWs = ma.includes('/ws') || ma.includes('/wss')
  if (hasWs) {
    const tls = ma.includes('/tls/')
    const sni = ma.includes('/sni/')
    if (tls && sni) return 'WSS · TLS+SNI'
    if (tls) return 'WSS · TLS'
    return 'WS · cleartext'
  }

  if (ma.includes('/quic-v1')) return 'QUIC (Node)'
  if (ma.includes('/tcp/')) return 'TCP (Node)'
  return 'other'
}

export function canBrowserDialMultiaddr(ma: string): boolean {
  const s = ma.trim()
  if (s.includes('/ws') || s.includes('/wss')) return true
  if (s.includes('/webrtc')) return true
  return false
}
