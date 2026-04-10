import { expect, test } from '@playwright/test'

const timeoutMs = Number(process.env.E2E_CONNECT_TIMEOUT_MS || 30_000)

async function openPeer(browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  await page.getByText('Advanced').click()
  await expect(page.getByTestId('local-peer-id')).not.toHaveText('starting...', {
    timeout: timeoutMs,
  })
  return { context, page }
}

async function debugSnapshot(page) {
  return await page.evaluate(() => {
    if (typeof window.__pongDebug?.snapshot !== 'function') {
      throw new Error('debug snapshot not available')
    }
    return window.__pongDebug.snapshot()
  })
}

test('pubsub discovery topic forwards signed messages between two browsers', async ({ browser }) => {
  const first = await openPeer(browser)
  const second = await openPeer(browser)

  try {
    await Promise.all([
      expect
        .poll(async () => {
          const snapshot = await debugSnapshot(first.page)
          return snapshot.node?.events?.some((event) => event.type === 'relay:reservation:created') ?? false
        }, { timeout: timeoutMs })
        .toBe(true),
      expect
        .poll(async () => {
          const snapshot = await debugSnapshot(second.page)
          return snapshot.node?.events?.some((event) => event.type === 'relay:reservation:created') ?? false
        }, { timeout: timeoutMs })
        .toBe(true),
    ])

    const firstSnapshot = await debugSnapshot(first.page)
    const secondSnapshot = await debugSnapshot(second.page)
    const firstPeerId = firstSnapshot.localPeerId
    const secondPeerId = secondSnapshot.localPeerId

    await first.page.evaluate(async () => {
      await window.__pongDebug.publishDiscoveryPing(`from-${Date.now()}`)
    })

    await expect
      .poll(async () => {
        const snapshot = await debugSnapshot(second.page)
        return snapshot.node?.events?.filter((event) => event.type === 'pubsub:message') ?? []
      }, { timeout: timeoutMs })
      .toContainEqual(expect.objectContaining({ peerId: firstPeerId, topic: '_peer-discovery._p2p._pubsub' }))

    const afterFirst = await debugSnapshot(first.page)
    const afterSecond = await debugSnapshot(second.page)

    console.error(
      'pubsub-debug-summary',
      JSON.stringify(
        {
          firstPeerId,
          secondPeerId,
          firstEvents: afterFirst.node?.events ?? [],
          secondEvents: afterSecond.node?.events ?? [],
          firstConnections: afterFirst.node?.connections ?? [],
          secondConnections: afterSecond.node?.connections ?? [],
          firstTopicSubscribers: afterFirst.node?.topicSubscribers ?? [],
          secondTopicSubscribers: afterSecond.node?.topicSubscribers ?? [],
        },
        null,
        2
      )
    )
  } catch (error) {
    const [afterFirst, afterSecond] = await Promise.all([
      debugSnapshot(first.page),
      debugSnapshot(second.page),
    ])
    console.error(
      'pubsub-debug-failure',
      JSON.stringify(
        {
          first: {
            localPeerId: afterFirst.localPeerId,
            node: afterFirst.node,
          },
          second: {
            localPeerId: afterSecond.localPeerId,
            node: afterSecond.node,
          },
        },
        null,
        2
      )
    )
    throw error
  } finally {
    await Promise.all([first.context.close(), second.context.close()])
  }
})
