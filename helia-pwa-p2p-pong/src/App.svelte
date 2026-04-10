<script lang="ts">
  import { onMount } from 'svelte'
  import type { Stream } from '@libp2p/interface'
  import {
    DEFAULT_RELAY_MULTIADDR,
    LEGACY_DEFAULT_RELAY_MULTIADDR,
    relayMultiaddr as defaultRelayMultiaddr,
    relayPeerIdFromMultiaddr,
    transportLabel,
  } from './lib/relayApi'
  import { ConnectivityBrowserNode, type DiscoveryRow } from './lib/browserNode'
  import { createLiveLineChannel, type LiveLineChannel } from './lib/liveLineChannel'
  import {
    clonePongState,
    createInitialPongState,
    drawPong,
    stepPong,
    type PaddleInput,
    type PongState,
    PONG_STAGE,
  } from './lib/pongGame'
  import { CONNECTIVITY_PONG_PROTOCOL, DEFAULT_PUBSUB_PEER_DISCOVERY_TOPIC } from './lib/protocol'

  type MatchRole = 'host' | 'guest'

  type PongWireMessage =
    | { type: 'input'; up: boolean; down: boolean }
    | { type: 'state'; state: PongState }
    | { type: 'leave'; reason: string }

  const DOUBLE_TAP_MS = 320
  const TAP_MOVE_TOLERANCE_PX = 18
  const SWIPE_DEAD_ZONE_PX = 18

  const keyboardInput = { up: false, down: false }
  const swipeInput = { up: false, down: false }
  const localInput = { up: false, down: false }
  const remoteInput = { up: false, down: false }

  let canvasEl = $state<HTMLCanvasElement | null>(null)
  let playfieldEl = $state<HTMLDivElement | null>(null)
  let relayMultiaddrInput = $state('')
  let topic = $state(DEFAULT_PUBSUB_PEER_DISCOVERY_TOPIC)
  let manualTopicOverride = $state(false)
  let busy = $state(false)
  let node = $state<ConnectivityBrowserNode | null>(null)
  let discoveryRows = $state<DiscoveryRow[]>([])
  let peersCount = $state(0)
  let ownMultiaddrs = $state<string[]>([])
  let localPeerId = $state('')
  let relayDialResult = $state('Starting browser node...')
  let relayConnected = $state(false)
  let relayConnectionAddr = $state('')
  let matchRole = $state<MatchRole | null>(null)
  let matchStatus = $state<'idle' | 'live'>('idle')
  let matchMessage = $state('Wait for another browser to appear, then press Play.')
  let remotePeerId = $state('')
  let activeTransportAddr = $state('')
  let leftScore = $state(0)
  let rightScore = $state(0)
  let speedLevel = $state(1)
  let activeMatchChannel: LiveLineChannel<PongWireMessage> | null = null

  let currentGameState: PongState = createInitialPongState()
  let hostLastFrameMs = 0
  let hostLastSnapshotMs = 0
  let playfieldFullscreen = $state(false)
  let activeTouchId: number | null = null
  let touchStartX = 0
  let touchStartY = 0
  let lastTapMs = 0
  let lastTapX = 0
  let lastTapY = 0

  function exposeDebugHandle(): void {
    ;(window as Window & {
      __pongDebug?: {
        snapshot: () => Record<string, unknown>
        publishDiscoveryPing: (label: string) => Promise<void>
        dialMultiaddr: (addr: string) => Promise<void>
      }
    }).__pongDebug = {
      snapshot: () => ({
        relayMultiaddr: normalizedRelayMultiaddr(),
        topic: normalizedTopic(),
        relayConnected,
        relayConnectionAddr,
        relayDialResult,
        localPeerId,
        remotePeerId,
        matchRole,
        matchStatus,
        matchMessage,
        activeTransportAddr,
        leftScore,
        rightScore,
        speedLevel,
        currentGameState: clonePongState(currentGameState),
        peerCount: peersCount,
        ownMultiaddrs,
        discoveryRows,
        node: node?.getDebugSnapshot() ?? null,
      }),
      publishDiscoveryPing: async (label: string) => {
        if (node == null) throw new Error('node not ready')
        const payload = new TextEncoder().encode(`debug-ping:${label}`)
        await node.publishDebugPubsubMessage(normalizedTopic(), payload)
      },
      dialMultiaddr: async (addr: string) => {
        if (node == null) throw new Error('node not ready')
        await node.dialMultiaddrForDebug(addr)
      },
    }
  }

  function loadStorage(): void {
    const storedRelayMultiaddr = localStorage.getItem('relayMultiaddr')
    if (storedRelayMultiaddr) {
      relayMultiaddrInput =
        storedRelayMultiaddr === LEGACY_DEFAULT_RELAY_MULTIADDR ? DEFAULT_RELAY_MULTIADDR : storedRelayMultiaddr
    }
    manualTopicOverride = localStorage.getItem('pubsubTopicManual') === '1'
    const storedTopic = localStorage.getItem('pubsubTopic')
    if (storedTopic) topic = storedTopic
    syncTopicOverrideFromValue(topic)
  }

  function persistStorage(): void {
    localStorage.setItem('relayMultiaddr', normalizedRelayMultiaddr())
    localStorage.removeItem('relayHttpBase')
    localStorage.removeItem('relayControlToken')
    localStorage.removeItem('relaySuggestedTopic')
    localStorage.setItem('pubsubTopic', normalizedTopic())
    if (manualTopicOverride) {
      localStorage.setItem('pubsubTopicManual', '1')
    } else {
      localStorage.removeItem('pubsubTopicManual')
    }
  }

  function normalizedTopic(): string {
    const next = topic.trim()
    return next || DEFAULT_PUBSUB_PEER_DISCOVERY_TOPIC
  }

  function syncTopicOverrideFromValue(nextTopic: string): void {
    const next = nextTopic.trim()
    manualTopicOverride = next !== '' && next !== DEFAULT_PUBSUB_PEER_DISCOVERY_TOPIC
  }

  function onTopicInput(nextTopic: string): void {
    topic = nextTopic
    syncTopicOverrideFromValue(nextTopic)
  }

  function normalizedRelayMultiaddr(): string {
    const next = relayMultiaddrInput.trim()
    return next || defaultRelayMultiaddr()
  }

  function relayBootstrapAddrs(): string[] {
    const relayAddr = normalizedRelayMultiaddr()
    return relayAddr === '' ? [] : [relayAddr]
  }

  function relayPeerId(): string {
    return relayPeerIdFromMultiaddr(normalizedRelayMultiaddr())
  }

  function playableDiscoveryRows(): DiscoveryRow[] {
    const relayId = relayPeerId()
    if (relayId === '') return discoveryRows
    return discoveryRows.filter((row) => row.peerId !== relayId)
  }

  function playablePeersCount(): number {
    return playableDiscoveryRows().length
  }

  function shortPeerId(peerId: string): string {
    if (peerId.length <= 20) return peerId
    return `${peerId.slice(0, 10)}...${peerId.slice(-6)}`
  }

  function matchStatusLabel(): string {
    if (matchStatus !== 'live') return 'waiting'
    return matchRole === 'host' ? 'live left paddle' : 'live right paddle'
  }

  function peerConnectionAddr(peerId: string): string {
    return node?.getPreferredPeerConnectionAddr(peerId) ?? ''
  }

  function peerTransportLabel(peerId: string): string {
    const addr = peerConnectionAddr(peerId)
    if (addr !== '') return transportLabel(addr)
    const row = discoveryRows.find((candidate) => candidate.peerId === peerId)
    if (row?.discoveryAddrs.some((candidate) => candidate.includes('/webrtc'))) return 'WebRTC advertised'
    if (row?.discoveryAddrs.some((candidate) => candidate.includes('/p2p-circuit'))) return 'relay path advertised'
    return 'discovered'
  }

  function syncScoreboard(): void {
    leftScore = currentGameState.leftScore
    rightScore = currentGameState.rightScore
    speedLevel = currentGameState.speedLevel
  }

  function resetInputs(): void {
    keyboardInput.up = false
    keyboardInput.down = false
    swipeInput.up = false
    swipeInput.down = false
    localInput.up = false
    localInput.down = false
    remoteInput.up = false
    remoteInput.down = false
  }

  function syncLocalInput(): void {
    const nextUp = keyboardInput.up || swipeInput.up
    const nextDown = keyboardInput.down || swipeInput.down
    const changed = localInput.up !== nextUp || localInput.down !== nextDown
    localInput.up = nextUp
    localInput.down = nextDown

    if (changed && matchRole === 'guest') {
      sendGuestInput()
    }
  }

  function resetGameState(): void {
    currentGameState = createInitialPongState()
    syncScoreboard()
  }

  async function restartNodeForTopicChange(message: string): Promise<void> {
    const currentNode = node
    if (currentNode == null) return

    const relayAddr = normalizedRelayMultiaddr()
    busy = true
    relayDialResult = message
    try {
      if (activeMatchChannel != null) {
        await teardownMatch(message, true)
      }
      await currentNode.stop()
      node = null
      discoveryRows = []
      peersCount = 0
      ownMultiaddrs = []
      localPeerId = ''
      relayConnected = false
      relayConnectionAddr = ''
      activeTransportAddr = ''

      const nextNode = await ensureNode()
      if (relayAddr !== '') {
        await nextNode.dialRelay(relayAddr)
        relayDialResult = `Connected via ${transportLabel(relayAddr)}`
      } else {
        relayDialResult = 'Topic updated, but relay multiaddr is not configured.'
      }
    } catch (error) {
      relayDialResult = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
    }
  }

  async function ensureNode(): Promise<ConnectivityBrowserNode> {
    if (node != null) return node

    const nextNode = new ConnectivityBrowserNode(
      normalizedTopic(),
      relayBootstrapAddrs(),
      (rows) => {
        discoveryRows = rows
      }
    )
    await nextNode.start()
    await nextNode.handleProtocol(CONNECTIVITY_PONG_PROTOCOL, async ({ stream, peerId, remoteAddr }) => {
      await handleIncomingMatch(stream, peerId, remoteAddr)
    })

    node = nextNode
    localPeerId = nextNode.getLocalPeerId() ?? ''
    ownMultiaddrs = nextNode.getOwnMultiaddrs()
    return nextNode
  }

  async function dialRelay(): Promise<void> {
    busy = true
    relayDialResult = 'Dialing relay...'
    try {
      const nextNode = await ensureNode()
      const relayAddr = normalizedRelayMultiaddr()
      if (relayAddr === '') {
        relayDialResult = 'Relay multiaddr is not configured.'
        return
      }
      await nextNode.dialRelay(relayAddr)
      relayDialResult = `Connected via ${transportLabel(relayAddr)}`
    } catch (error) {
      relayDialResult = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
    }
  }

  function updateConnectionIndicators(): void {
    if (node == null) {
      peersCount = 0
      ownMultiaddrs = []
      relayConnected = false
      relayConnectionAddr = ''
      activeTransportAddr = ''
      return
    }

    localPeerId = node.getLocalPeerId() ?? ''
    ownMultiaddrs = node.getOwnMultiaddrs()
    peersCount = playablePeersCount()

    const configuredRelayPeerId = relayPeerId()
    if (configuredRelayPeerId !== '') {
      relayConnectionAddr = node.getPreferredPeerConnectionAddr(configuredRelayPeerId) ?? ''
      relayConnected = relayConnectionAddr !== ''
    } else {
      relayConnected = false
      relayConnectionAddr = ''
    }

    if (remotePeerId !== '') {
      activeTransportAddr = node.getPreferredPeerConnectionAddr(remotePeerId) ?? activeTransportAddr
    } else {
      activeTransportAddr = ''
    }
  }

  function sendGuestInput(): void {
    if (matchRole !== 'guest' || activeMatchChannel == null) return
    activeMatchChannel.send({
      type: 'input',
      up: localInput.up,
      down: localInput.down,
    })
  }

  function onArrowKey(event: KeyboardEvent, pressed: boolean): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()

    if (event.key === 'ArrowUp') {
      keyboardInput.up = pressed
    } else {
      keyboardInput.down = pressed
    }
    syncLocalInput()
  }

  function setSwipeDirection(direction: PaddleInput): void {
    swipeInput.up = direction < 0
    swipeInput.down = direction > 0
    syncLocalInput()
  }

  function resetTouchTracking(): void {
    activeTouchId = null
    setSwipeDirection(0)
  }

  function activeTouchFrom(list: TouchList): Touch | null {
    if (activeTouchId == null) return null
    for (const touch of list) {
      if (touch.identifier === activeTouchId) return touch
    }
    return null
  }

  function syncPlayfieldFullscreen(): void {
    playfieldFullscreen = document.fullscreenElement === playfieldEl
    if (!playfieldFullscreen) {
      resetTouchTracking()
    }
  }

  async function enterPlayfieldFullscreen(): Promise<void> {
    if (playfieldEl == null || document.fullscreenElement === playfieldEl) return
    await playfieldEl.requestFullscreen()
  }

  async function exitPlayfieldFullscreen(): Promise<void> {
    if (document.fullscreenElement !== playfieldEl) return
    await document.exitFullscreen()
  }

  async function togglePlayfieldFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement === playfieldEl) {
        await exitPlayfieldFullscreen()
      } else {
        await enterPlayfieldFullscreen()
      }
    } catch {
      syncPlayfieldFullscreen()
    }
  }

  function registerTap(x: number, y: number): void {
    const now = performance.now()
    const isDoubleTap =
      now - lastTapMs <= DOUBLE_TAP_MS && Math.hypot(x - lastTapX, y - lastTapY) <= TAP_MOVE_TOLERANCE_PX * 2

    lastTapMs = isDoubleTap ? 0 : now
    lastTapX = x
    lastTapY = y

    if (isDoubleTap) {
      void togglePlayfieldFullscreen()
    }
  }

  function handlePlayfieldTouchStart(event: TouchEvent): void {
    if (event.changedTouches.length === 0 || activeTouchId != null) return

    const touch = event.changedTouches[0]
    activeTouchId = touch.identifier
    touchStartX = touch.clientX
    touchStartY = touch.clientY
    setSwipeDirection(0)

    if (event.cancelable) {
      event.preventDefault()
    }
  }

  function handlePlayfieldTouchMove(event: TouchEvent): void {
    const touch = activeTouchFrom(event.touches)
    if (touch == null) return

    const deltaY = touch.clientY - touchStartY
    const direction = Math.abs(deltaY) < SWIPE_DEAD_ZONE_PX ? 0 : deltaY < 0 ? -1 : 1
    setSwipeDirection(direction)

    if (event.cancelable) {
      event.preventDefault()
    }
  }

  function handlePlayfieldTouchEnd(event: TouchEvent): void {
    const touch = activeTouchFrom(event.changedTouches)
    if (touch == null) return

    const travel = Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY)
    resetTouchTracking()
    if (travel <= TAP_MOVE_TOLERANCE_PX) {
      registerTap(touch.clientX, touch.clientY)
    }

    if (event.cancelable) {
      event.preventDefault()
    }
  }

  function handlePlayfieldTouchCancel(event: TouchEvent): void {
    const touch = activeTouchFrom(event.changedTouches)
    if (touch == null) return
    resetTouchTracking()

    if (event.cancelable) {
      event.preventDefault()
    }
  }

  async function teardownMatch(reason: string, sendLeave: boolean): Promise<void> {
    const activeChannel = activeMatchChannel
    activeMatchChannel = null

    if (sendLeave && activeChannel != null) {
      activeChannel.send({ type: 'leave', reason })
    }
    if (activeChannel != null) {
      await activeChannel.close()
    }

    matchRole = null
    matchStatus = 'idle'
    matchMessage = reason
    remotePeerId = ''
    activeTransportAddr = ''
    resetInputs()
    resetGameState()
  }

  function attachMatchChannel(
    channel: LiveLineChannel<PongWireMessage>,
    peerId: string,
    role: MatchRole,
    remoteAddr: string | null
  ): void {
    activeMatchChannel = channel
    matchRole = role
    matchStatus = 'live'
    remotePeerId = peerId
    activeTransportAddr = remoteAddr ?? node?.getPreferredPeerConnectionAddr(peerId) ?? ''
    resetInputs()
    resetGameState()
    matchMessage =
      role === 'host'
        ? 'Match live. You are the left paddle.'
        : 'Connected. Waiting for the first host snapshot.'

    if (role === 'host') {
      hostLastFrameMs = performance.now()
      hostLastSnapshotMs = 0
      activeMatchChannel?.send({
        type: 'state',
        state: clonePongState(currentGameState),
      })
    }
  }

  function handleMatchMessage(message: PongWireMessage): void {
    if (message.type === 'leave') {
      void teardownMatch(`Remote peer left: ${message.reason}`, false)
      return
    }

    if (message.type === 'input' && matchRole === 'host') {
      remoteInput.up = message.up
      remoteInput.down = message.down
      return
    }

    if (message.type === 'state' && matchRole === 'guest') {
      currentGameState = clonePongState(message.state)
      syncScoreboard()
      matchMessage = 'Match live. You are the right paddle.'
    }
  }

  function createMatchChannel(
    stream: Stream,
    peerId: string,
    role: MatchRole,
    remoteAddr: string | null
  ): LiveLineChannel<PongWireMessage> {
    let channel: LiveLineChannel<PongWireMessage>

    channel = createLiveLineChannel<PongWireMessage>(
      stream,
      (message) => {
        if (activeMatchChannel !== channel) return
        handleMatchMessage(message)
      },
      (error) => {
        if (activeMatchChannel !== channel) return
        void teardownMatch(error != null ? `Match closed: ${error}` : 'Match closed.', false)
      }
    )

    attachMatchChannel(channel, peerId, role, remoteAddr)
    return channel
  }

  async function handleIncomingMatch(stream: Stream, peerId: string, remoteAddr: string | null): Promise<void> {
    if (activeMatchChannel != null && remotePeerId !== '' && remotePeerId !== peerId) {
      const spareChannel = createLiveLineChannel<PongWireMessage>(stream, () => {})
      spareChannel.send({ type: 'leave', reason: 'peer already in another match' })
      setTimeout(() => {
        void spareChannel.close()
      }, 120)
      return
    }

    createMatchChannel(stream, peerId, 'guest', remoteAddr)
  }

  async function invitePeer(row: DiscoveryRow): Promise<void> {
    const nextNode = await ensureNode()
    busy = true
    try {
      if (activeMatchChannel != null) {
        await teardownMatch('Starting a new match.', true)
      }

      matchMessage = `Opening match with ${shortPeerId(row.peerId)}...`
      const { stream, remoteAddr } = await nextNode.dialPeerProtocol(
        row.peerId,
        CONNECTIVITY_PONG_PROTOCOL,
        row.discoveryAddrs
      )
      createMatchChannel(stream, row.peerId, 'host', remoteAddr)
    } catch (error) {
      matchMessage = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
    }
  }

  function hostInputDirection(up: boolean, down: boolean): PaddleInput {
    if (up && !down) return -1
    if (down && !up) return 1
    return 0
  }

  function runFrame(now: number): void {
    const ctx = canvasEl?.getContext('2d')
    if (ctx == null) return

    if (matchRole === 'host' && matchStatus === 'live' && activeMatchChannel != null) {
      if (hostLastFrameMs === 0) hostLastFrameMs = now
      const dtMs = now - hostLastFrameMs
      hostLastFrameMs = now

      stepPong(
        currentGameState,
        hostInputDirection(localInput.up, localInput.down),
        hostInputDirection(remoteInput.up, remoteInput.down),
        dtMs
      )
      syncScoreboard()

      if (now - hostLastSnapshotMs >= 50) {
        hostLastSnapshotMs = now
        activeMatchChannel.send({
          type: 'state',
          state: clonePongState(currentGameState),
        })
      }
    } else {
      hostLastFrameMs = now
    }

    drawPong(ctx, currentGameState, matchRole)
  }

  onMount(() => {
    loadStorage()
    if (!relayMultiaddrInput.trim()) relayMultiaddrInput = defaultRelayMultiaddr()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && document.fullscreenElement === playfieldEl) {
        event.preventDefault()
        void exitPlayfieldFullscreen()
        return
      }
      onArrowKey(event, true)
    }
    const onKeyUp = (event: KeyboardEvent): void => onArrowKey(event, false)
    const onFullscreenChange = (): void => syncPlayfieldFullscreen()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    exposeDebugHandle()

    let mounted = true
    void (async () => {
      try {
        await ensureNode()
        await dialRelay()
      } catch (error) {
        relayDialResult = error instanceof Error ? error.message : String(error)
      }
    })()

    const infoTimer = setInterval(() => {
      if (!mounted) return
      updateConnectionIndicators()
    }, 700)

    let rafId = 0
    const tick = (now: number): void => {
      runFrame(now)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      mounted = false
      clearInterval(infoTimer)
      cancelAnimationFrame(rafId)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      resetTouchTracking()
      if (activeMatchChannel != null) {
        void activeMatchChannel.close()
      }
      if (node != null) {
        void node.stop()
      }
      delete (window as Window & { __pongDebug?: unknown }).__pongDebug
    }
  })
</script>

<main class="shell">
  <section class="hero">
    <div>
      <p class="eyebrow">Browser To Browser Pong</p>
      <h1>P2P Pong</h1>
      <p class="release-meta">Version 0.1.0 · committed 2026-04-10</p>
      <p class="subtitle">
        Open this page in two browsers. Both peers connect to the relay, discover each other, and libp2p upgrades toward
        WebRTC when it can.
      </p>
      <div class="button-row hero-actions">
        <button
          type="button"
          disabled={busy}
          onclick={() => {
            persistStorage()
            void dialRelay()
          }}
        >
          Connect relay
        </button>
        <button
          type="button"
          disabled={matchStatus !== 'live'}
          onclick={() => void teardownMatch('Local player ended the match.', true)}
        >
          Leave match
        </button>
      </div>
      <p class="hero-note">{matchMessage}</p>
    </div>

    <div class="hero-stats">
      <div>
        <span class="label">Relay</span>
        <strong data-testid="relay-status">{relayConnected ? 'connected' : 'connecting'}</strong>
      </div>
      <div>
        <span class="label">Peers</span>
        <strong data-testid="peer-count">{playablePeersCount()}</strong>
      </div>
      <div>
        <span class="label">Match</span>
        <strong data-testid="match-status">{matchStatusLabel()}</strong>
      </div>
    </div>
  </section>

  <section class="layout">
    <div class="panel">
      <div class="panel-header">
        <h2>Peers</h2>
        <span class="muted">Press Play on any discovered peer. Direct WebRTC is preferred, but we no longer block on it.</span>
      </div>

      <div class="peer-list">
        {#each playableDiscoveryRows() as row (row.peerId)}
          <article
            class:active-peer={remotePeerId === row.peerId}
            class="peer-card"
            data-testid="peer-card"
            data-peer-id={row.peerId}
          >
            <div>
              <p class="peer-id">{shortPeerId(row.peerId)}</p>
              <p class="peer-meta" data-testid="peer-card-status">{row.autoDial === 'ok' ? 'connected' : row.autoDial}</p>
              <p class="peer-meta">{peerTransportLabel(row.peerId)}</p>
            </div>
            <button type="button" disabled={busy} onclick={() => void invitePeer(row)}>
              Play
            </button>
          </article>
        {:else}
          <p class="empty-state">No peer yet. Open the same page in another browser and give discovery a few seconds.</p>
        {/each}
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2>Match</h2>
        <div class="pill-row">
          <span class="pill">{matchStatusLabel()}</span>
          <span class="pill">{matchRole ?? 'spectator'}</span>
          <span
            class:ok-pill={activeTransportAddr.includes('/webrtc')}
            class:bad-pill={activeTransportAddr !== '' && !activeTransportAddr.includes('/webrtc')}
            class="pill"
          >
            {activeTransportAddr === '' ? 'transport pending' : transportLabel(activeTransportAddr)}
          </span>
        </div>
      </div>

      <div class="score-strip">
        <div>
          <span class="label">Left paddle</span>
          <strong>{leftScore}</strong>
        </div>
        <div>
          <span class="label">Speed level</span>
          <strong>{speedLevel}</strong>
        </div>
        <div>
          <span class="label">Right paddle</span>
          <strong>{rightScore}</strong>
        </div>
      </div>

      <div
        bind:this={playfieldEl}
        aria-label="Pong playfield. Double-click or double-tap to toggle fullscreen."
        class:playfield-fullscreen={playfieldFullscreen}
        class="playfield-shell"
        ondblclick={() => void togglePlayfieldFullscreen()}
        ontouchstart={handlePlayfieldTouchStart}
        ontouchmove={handlePlayfieldTouchMove}
        ontouchend={handlePlayfieldTouchEnd}
        ontouchcancel={handlePlayfieldTouchCancel}
        role="application"
      >
        <canvas bind:this={canvasEl} width={PONG_STAGE.width} height={PONG_STAGE.height}></canvas>
      </div>

      <p class="muted small">
        Controls: <code>Up</code> and <code>Down</code>, or swipe the playfield up and down on touch devices in
        portrait or landscape. Double-click or double-tap the playfield for fullscreen. Press <code>Esc</code> or
        double-tap again to exit. The host controls the left paddle and sends authoritative state. The guest controls
        the right paddle and only sends input.
      </p>
    </div>
  </section>

  <details class="panel advanced">
    <summary>Advanced</summary>

    <div class="controls">
      <label>
        Relay multiaddr
        <input type="text" bind:value={relayMultiaddrInput} placeholder={DEFAULT_RELAY_MULTIADDR} />
      </label>
      <label>
        Pubsub topic
        <input
          type="text"
          bind:value={topic}
          placeholder={DEFAULT_PUBSUB_PEER_DISCOVERY_TOPIC}
          oninput={(event) => onTopicInput((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </div>

    <div class="details-grid">
      <div>
        <span class="label">This peer id</span>
        <p class="mono" data-testid="local-peer-id">{localPeerId || 'starting...'}</p>
      </div>
      <div>
        <span class="label">Relay peer id</span>
        <p class="mono" data-testid="relay-peer-id">{relayPeerId() || 'missing from relay multiaddr'}</p>
      </div>
      <div>
        <span class="label">Relay transport</span>
        <p class="mono">{relayConnectionAddr || normalizedRelayMultiaddr() || 'none yet'}</p>
      </div>
      <div>
        <span class="label">Dial result</span>
        <p>{relayDialResult}</p>
      </div>
      <div>
        <span class="label">Relay target</span>
        <p class="mono">{normalizedRelayMultiaddr() || 'not configured'}</p>
      </div>
      <div>
        <span class="label">Remote peer</span>
        <p class="mono">{remotePeerId || 'none'}</p>
      </div>
      <div>
        <span class="label">Active transport</span>
        <p class="mono">{activeTransportAddr || 'no active p2p stream yet'}</p>
      </div>
    </div>

    <div class="advanced-grid">
      <div class="addr-list">
        <h3>My multiaddrs</h3>
        {#if ownMultiaddrs.length > 0}
          {#each ownMultiaddrs as addr (addr)}
            <code>{addr}</code>
          {/each}
        {:else}
          <p class="muted">No announced addresses yet.</p>
        {/if}
      </div>

      <div class="addr-list">
        <h3>Discovery rows</h3>
        {#if discoveryRows.length > 0}
          {#each discoveryRows as row (row.peerId)}
            <code data-testid="discovery-row">{shortPeerId(row.peerId)} · {row.autoDial} · {peerConnectionAddr(row.peerId) || row.discoveryAddrs[0] || row.detail || 'waiting'}</code>
          {/each}
        {:else}
          <p class="muted">No discovery rows yet.</p>
        {/if}
      </div>
    </div>
  </details>
</main>
