# Helia P2P Pong

This is a standalone local snapshot of `helia-connectivity-lab/apps/pwa`, repurposed into a two-browser human-vs-human Pong game.

It keeps the original browser libp2p pieces that mattered for connectivity:

- direct relay dialing via a TLS WebSocket multiaddr
- browser libp2p node with WebSockets, WebRTC, circuit relay, gossipsub, and pubsub peer discovery
- automatic discovery table so both browser peers can find each other
- WebRTC-preferred peer dialing before opening the game stream

## Local repo

This standalone repo was initialized locally from the current PWA sources and branched for multiplayer work:

- initial snapshot commit: `b6c5bb0`
- feature branch: `feat/p2p-two-player-pong`

## What changed

- replaced the generic connectivity-lab UI with a focused multiplayer Pong interface
- added a dedicated libp2p protocol: `/connectivity-pong/1.0.0`
- added a persistent newline-delimited JSON stream helper for browser-to-browser game messages
- added an authoritative Pong engine where the host simulates the match and the guest sends paddle input
- kept the ball slower at the start and ramping from speed level 1 to 10 every 30 seconds

## Run

```bash
npm install
npm run dev
```

Open the Vite URL in two browsers or tabs.

For production builds, set the relay multiaddr before `npm run build` if you want to override the default:

```bash
VITE_RELAY_MULTIADDR=/dns4/your-relay.example/tcp/443/tls/sni/your-relay.example/ws/p2p/<peer-id> npm run build
```

Current public relay default:

```text
/ip4/95.217.163.72/tcp/8443/tls/sni/95-217-163-72.k51qzi5uqu5dma6jqaa7ij2x6pn2it5wokit6j6h0ygenjgfxyzg729zdcdvik.libp2p.direct/ws/p2p/12D3KooWSHiPfALRy8rGZ1o3L68hV5vuADQvBt57uZucN36YpK9D
```

Build with that relay explicitly:

```bash
VITE_RELAY_MULTIADDR=/ip4/95.217.163.72/tcp/8443/tls/sni/95-217-163-72.k51qzi5uqu5dma6jqaa7ij2x6pn2it5wokit6j6h0ygenjgfxyzg729zdcdvik.libp2p.direct/ws/p2p/12D3KooWSHiPfALRy8rGZ1o3L68hV5vuADQvBt57uZucN36YpK9D npm run build
```

## How to play

1. In both browsers, wait for the relay to connect.
2. Wait until each browser sees the other in `Peers`.
3. Click `Play` on one side.
4. The host controls the left paddle and the guest controls the right paddle with `Up` and `Down`.

## Verification

The app was validated with:

```bash
npm run check
npm run test:e2e -- e2e/p2p-connectivity.spec.js e2e/pong-match.spec.js
npm run build
```

The build currently succeeds. Vite still reports a large bundle-size warning because libp2p and Helia are heavy browser dependencies.
