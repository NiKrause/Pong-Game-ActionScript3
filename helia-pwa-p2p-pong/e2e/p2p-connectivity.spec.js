import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLocalRelay } from './local-relay.js'

const connectTimeoutMs = Number(process.env.E2E_CONNECT_TIMEOUT_MS || 90_000)
const configuredRelayMultiaddr = process.env.E2E_RELAY_MULTIADDR || process.env.VITE_RELAY_MULTIADDR || ''
const pubsubTopic = process.env.E2E_PUBSUB_TOPIC || ''
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let localRelay = null
let relayMultiaddr = configuredRelayMultiaddr

test.beforeAll(async () => {
  if (relayMultiaddr !== '') return
  localRelay = await startLocalRelay(projectDir)
  relayMultiaddr = localRelay.relayMultiaddr
})

test.afterAll(async () => {
  await localRelay?.stop()
})

async function seedSettings(context) {
  await context.addInitScript(
    ({ nextRelayMultiaddr, nextPubsubTopic }) => {
      if (nextRelayMultiaddr) {
        window.localStorage.setItem('relayMultiaddr', nextRelayMultiaddr)
      }
      if (nextPubsubTopic) {
        window.localStorage.setItem('pubsubTopic', nextPubsubTopic)
        window.localStorage.setItem('pubsubTopicManual', '1')
      } else {
        window.localStorage.removeItem('pubsubTopicManual')
      }
    },
    {
      nextRelayMultiaddr: relayMultiaddr,
      nextPubsubTopic: pubsubTopic,
    }
  )
}

async function openBrowserPeer(browser, label) {
  const context = await browser.newContext()
  await seedSettings(context)

  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[${label}] console error: ${msg.text()}`)
    }
  })

  await page.goto('/')
  await page.getByText('Advanced').click()

  await expect(page.getByTestId('local-peer-id')).not.toHaveText('starting...', {
    timeout: connectTimeoutMs,
  })

  return { context, page, label }
}

async function peerDiagnostics(page) {
  return await page.evaluate(() => {
    const rawDebugSnapshot =
      typeof window.__pongDebug?.snapshot === 'function' ? window.__pongDebug.snapshot() : null
    const debugSnapshot =
      rawDebugSnapshot == null
        ? null
        : {
            relayMultiaddr: rawDebugSnapshot.relayMultiaddr,
            topic: rawDebugSnapshot.topic,
            relayConnected: rawDebugSnapshot.relayConnected,
            relayConnectionAddr: rawDebugSnapshot.relayConnectionAddr,
            relayDialResult: rawDebugSnapshot.relayDialResult,
            localPeerId: rawDebugSnapshot.localPeerId,
            remotePeerId: rawDebugSnapshot.remotePeerId,
            peerCount: rawDebugSnapshot.peerCount,
            discoveryRows: rawDebugSnapshot.discoveryRows,
            node: rawDebugSnapshot.node == null
              ? null
              : {
                  topic: rawDebugSnapshot.node.topic,
                  localPeerId: rawDebugSnapshot.node.localPeerId,
                  peerCount: rawDebugSnapshot.node.peerCount,
                  connections: rawDebugSnapshot.node.connections,
                  topicSubscribers: rawDebugSnapshot.node.topicSubscribers,
                  discoveryRows: rawDebugSnapshot.node.discoveryRows,
                  events: rawDebugSnapshot.node.events.slice(-40),
                },
          }
    const query = (selector) => document.querySelector(selector)?.textContent?.trim() || ''
    const queryAll = (selector) =>
      Array.from(document.querySelectorAll(selector)).map((el) => el.textContent?.trim() || '')

    return {
      debugSnapshot,
      relayStatus: query('[data-testid="relay-status"]'),
      peerCount: query('[data-testid="peer-count"]'),
      localPeerId: query('[data-testid="local-peer-id"]'),
      relayPeerId: query('[data-testid="relay-peer-id"]'),
      peerCards: queryAll('[data-testid="peer-card-status"]'),
      discoveryRows: queryAll('[data-testid="discovery-row"]'),
      body: document.body.innerText,
    }
  })
}

async function waitForConnectedPeers(peer, expectedLocalPeerId, expectedRelayPeerId) {
  const { page, label } = peer

  await expect
    .poll(
      async () =>
        await page.evaluate(({ remotePeerId, relayPeerId }) => {
          const query = (selector) => document.querySelector(selector)?.textContent?.trim() || ''
          const remoteCardText =
            document.querySelector(`[data-testid="peer-card"][data-peer-id="${remotePeerId}"]`)?.textContent?.trim() || ''
          return (
            Number(query('[data-testid="peer-count"]') || '0') >= 1 &&
            query('[data-testid="relay-peer-id"]') === relayPeerId &&
            query('[data-testid="relay-status"]') === 'connected' &&
            remoteCardText.includes('connected')
          )
        }, { remotePeerId: expectedLocalPeerId, relayPeerId: expectedRelayPeerId }),
      {
        timeout: connectTimeoutMs,
        message: `${label} should discover the other browser`,
      }
    )
    .toBe(true)

  const localPeerId = ((await page.getByTestId('local-peer-id').textContent()) || '').trim()
  expect(localPeerId).not.toBe(expectedLocalPeerId)
}

async function waitForDirectWebrtcConnection(peer, expectedRemotePeerId) {
  await expect
    .poll(
      async () =>
        await peer.page.evaluate(({ remotePeerId }) => {
          const debugSnapshot =
            typeof window.__pongDebug?.snapshot === 'function' ? window.__pongDebug.snapshot() : null
          const connections = debugSnapshot?.node?.connections ?? []
          const remoteCardText =
            document.querySelector(`[data-testid="peer-card"][data-peer-id="${remotePeerId}"]`)?.textContent?.trim() || ''
          return (
            remoteCardText.includes('WebRTC') ||
            connections.some(
            (connection) =>
              connection.peerId === remotePeerId &&
              connection.addr.includes('/webrtc') &&
              !connection.addr.includes('/p2p-circuit')
          )
          )
        }, { remotePeerId: expectedRemotePeerId }),
      {
        timeout: connectTimeoutMs,
        message: `${peer.label} should upgrade to a direct WebRTC connection`,
      }
    )
    .toBe(true)
}

test('two browsers connect through the relay and discover each other', async ({ browser }) => {
  const first = await openBrowserPeer(browser, 'browser-1')
  const second = await openBrowserPeer(browser, 'browser-2')

  try {
    const firstLocalPeerId = ((await first.page.getByTestId('local-peer-id').textContent()) || '').trim()
    const secondLocalPeerId = ((await second.page.getByTestId('local-peer-id').textContent()) || '').trim()

    expect(firstLocalPeerId).toBeTruthy()
    expect(secondLocalPeerId).toBeTruthy()
    expect(firstLocalPeerId).not.toBe(secondLocalPeerId)

    const firstRelayPeerId = ((await first.page.getByTestId('relay-peer-id').textContent()) || '').trim()
    const secondRelayPeerId = ((await second.page.getByTestId('relay-peer-id').textContent()) || '').trim()

    expect(firstRelayPeerId).toBeTruthy()
    expect(secondRelayPeerId).toBeTruthy()
    expect(firstRelayPeerId).toBe(secondRelayPeerId)

    await Promise.all([
      waitForConnectedPeers(first, secondLocalPeerId, firstRelayPeerId),
      waitForConnectedPeers(second, firstLocalPeerId, secondRelayPeerId),
      waitForDirectWebrtcConnection(first, secondLocalPeerId),
      waitForDirectWebrtcConnection(second, firstLocalPeerId),
    ])
  } catch (error) {
    const [firstInfo, secondInfo] = await Promise.all([
      peerDiagnostics(first.page),
      peerDiagnostics(second.page),
    ])
    console.error('browser-1 diagnostics', JSON.stringify(firstInfo, null, 2))
    console.error('browser-2 diagnostics', JSON.stringify(secondInfo, null, 2))
    throw error
  } finally {
    await Promise.all([first.context.close(), second.context.close()])
  }
})
