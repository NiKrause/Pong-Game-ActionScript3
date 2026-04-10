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

async function readDebug(page) {
  return await page.evaluate(() =>
    typeof window.__pongDebug?.snapshot === 'function' ? window.__pongDebug.snapshot() : null
  )
}

async function readRequiredDebug(page, label) {
  const snapshot = await readDebug(page)
  expect(snapshot, `${label} debug snapshot should be available`).toBeTruthy()
  return snapshot
}

async function waitForPeerCard(page, remotePeerId) {
  await expect
    .poll(
      async () =>
        await page.evaluate((peerId) => {
          const card = document.querySelector(`[data-testid="peer-card"][data-peer-id="${peerId}"]`)
          return card?.textContent?.trim() || ''
        }, remotePeerId),
      {
        timeout: connectTimeoutMs,
      }
    )
    .toContain('connected')
}

async function startMatchFromHost(hostPage, guestPeerId) {
  await hostPage.locator(`[data-testid="peer-card"][data-peer-id="${guestPeerId}"] button`).click()
}

async function waitForLiveMatch(page, expectedRole, expectedRemotePeerId) {
  await expect
    .poll(
      async () =>
        await page.evaluate(({ role, remotePeerId }) => {
          const snapshot =
            typeof window.__pongDebug?.snapshot === 'function' ? window.__pongDebug.snapshot() : null
          if (snapshot == null) return null
          return {
            matchStatus: snapshot.matchStatus,
            matchRole: snapshot.matchRole,
            remotePeerId: snapshot.remotePeerId,
            activeTransportAddr: snapshot.activeTransportAddr,
          }
        }, { role: expectedRole, remotePeerId: expectedRemotePeerId }),
      {
        timeout: connectTimeoutMs,
        message: `${expectedRole} page should enter a live match`,
      }
    )
    .toMatchObject({
      matchStatus: 'live',
      matchRole: expectedRole,
      remotePeerId: expectedRemotePeerId,
    })
}

async function waitForBallMovement(page, label) {
  const before = await readDebug(page)
  expect(before?.currentGameState?.ballX).toBeDefined()
  expect(before?.currentGameState?.ballY).toBeDefined()

  await page.waitForTimeout(700)

  await expect
    .poll(
      async () => {
        const after = await readDebug(page)
        if (after == null || before == null) return false
        return (
          after.matchStatus === 'live' &&
          (after.currentGameState.ballX !== before.currentGameState.ballX ||
            after.currentGameState.ballY !== before.currentGameState.ballY)
        )
      },
      {
        timeout: 10_000,
        message: `${label} should observe the ball moving`,
      }
    )
    .toBe(true)
}

async function waitForGuestInputAffectsHost(hostPage, guestPage) {
  const hostBefore = await readDebug(hostPage)
  expect(hostBefore?.currentGameState?.rightY).toBeDefined()

  await guestPage.keyboard.down('ArrowUp')
  await guestPage.waitForTimeout(500)
  await guestPage.keyboard.up('ArrowUp')

  await expect
    .poll(
      async () => {
        const hostAfter = await readDebug(hostPage)
        if (hostAfter == null || hostBefore == null) return false
        return hostAfter.currentGameState.rightY !== hostBefore.currentGameState.rightY
      },
      {
        timeout: 10_000,
        message: 'host should receive guest paddle input',
      }
    )
    .toBe(true)
}

async function focusGame(page) {
  await page.locator('canvas').click()
}

async function movePaddleAwayFromBall(page, hostSnapshot) {
  const moveKey =
    hostSnapshot.currentGameState.ballY > hostSnapshot.currentGameState.height / 2 ? 'ArrowUp' : 'ArrowDown'

  await focusGame(page)
  await page.keyboard.down(moveKey)
  await page.waitForTimeout(1_400)
  await page.keyboard.up(moveKey)
}

async function waitForScoreSync(hostPage, guestPage, expectedLeftScore, expectedRightScore) {
  await Promise.all([
    expect
      .poll(
        async () => {
          const snapshot = await readDebug(hostPage)
          if (snapshot == null) return null
          return {
            leftScore: snapshot.leftScore,
            rightScore: snapshot.rightScore,
            matchStatus: snapshot.matchStatus,
          }
        },
        {
          timeout: 12_000,
          message: 'host should report the expected score',
        }
      )
      .toMatchObject({
        leftScore: expectedLeftScore,
        rightScore: expectedRightScore,
        matchStatus: 'live',
      }),
    expect
      .poll(
        async () => {
          const snapshot = await readDebug(guestPage)
          if (snapshot == null) return null
          return {
            leftScore: snapshot.leftScore,
            rightScore: snapshot.rightScore,
            matchStatus: snapshot.matchStatus,
          }
        },
        {
          timeout: 12_000,
          message: 'guest should receive the same score update',
        }
      )
      .toMatchObject({
        leftScore: expectedLeftScore,
        rightScore: expectedRightScore,
        matchStatus: 'live',
      }),
  ])
}

async function forceSinglePoint(hostPage, guestPage) {
  const initialHostSnapshot = await readRequiredDebug(hostPage, 'host')
  const initialLeftScore = initialHostSnapshot.leftScore
  const initialRightScore = initialHostSnapshot.rightScore

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hostSnapshot = await readRequiredDebug(hostPage, 'host')
    const ballMovingToGuest = hostSnapshot.currentGameState.ballVx > 0
    const pageToMove = ballMovingToGuest ? guestPage : hostPage
    const expectedLeftScore = ballMovingToGuest ? initialLeftScore + 1 : initialLeftScore
    const expectedRightScore = ballMovingToGuest ? initialRightScore : initialRightScore + 1

    await movePaddleAwayFromBall(pageToMove, hostSnapshot)

    try {
      await waitForScoreSync(hostPage, guestPage, expectedLeftScore, expectedRightScore)
      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

test('two browsers can select each other and start a live pong match', async ({ browser }) => {
  const first = await openBrowserPeer(browser, 'browser-1')
  const second = await openBrowserPeer(browser, 'browser-2')

  try {
    const firstLocalPeerId = ((await first.page.getByTestId('local-peer-id').textContent()) || '').trim()
    const secondLocalPeerId = ((await second.page.getByTestId('local-peer-id').textContent()) || '').trim()

    expect(firstLocalPeerId).toBeTruthy()
    expect(secondLocalPeerId).toBeTruthy()
    expect(firstLocalPeerId).not.toBe(secondLocalPeerId)

    await Promise.all([
      waitForPeerCard(first.page, secondLocalPeerId),
      waitForPeerCard(second.page, firstLocalPeerId),
    ])

    await startMatchFromHost(first.page, secondLocalPeerId)

    await Promise.all([
      waitForLiveMatch(first.page, 'host', secondLocalPeerId),
      waitForLiveMatch(second.page, 'guest', firstLocalPeerId),
    ])

    await Promise.all([
      waitForBallMovement(first.page, 'host'),
      waitForBallMovement(second.page, 'guest'),
    ])

    await waitForGuestInputAffectsHost(first.page, second.page)
  } finally {
    await Promise.all([first.context.close(), second.context.close()])
  }
})

test('two browsers keep scores synchronized when a point is scored', async ({ browser }) => {
  const first = await openBrowserPeer(browser, 'browser-1')
  const second = await openBrowserPeer(browser, 'browser-2')

  try {
    const firstLocalPeerId = ((await first.page.getByTestId('local-peer-id').textContent()) || '').trim()
    const secondLocalPeerId = ((await second.page.getByTestId('local-peer-id').textContent()) || '').trim()

    expect(firstLocalPeerId).toBeTruthy()
    expect(secondLocalPeerId).toBeTruthy()
    expect(firstLocalPeerId).not.toBe(secondLocalPeerId)

    await Promise.all([
      waitForPeerCard(first.page, secondLocalPeerId),
      waitForPeerCard(second.page, firstLocalPeerId),
    ])

    await startMatchFromHost(first.page, secondLocalPeerId)

    await Promise.all([
      waitForLiveMatch(first.page, 'host', secondLocalPeerId),
      waitForLiveMatch(second.page, 'guest', firstLocalPeerId),
      waitForBallMovement(first.page, 'host'),
      waitForBallMovement(second.page, 'guest'),
    ])

    await forceSinglePoint(first.page, second.page)
  } finally {
    await Promise.all([first.context.close(), second.context.close()])
  }
})
