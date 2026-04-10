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

function pickDialAddr(snapshot) {
  const ownMultiaddrs = snapshot.node?.ownMultiaddrs ?? []
  return (
    ownMultiaddrs.find((addr) => addr.includes('/p2p-circuit/p2p/') && addr.includes('/ip4/95.217.163.72/')) ??
    ownMultiaddrs.find((addr) => addr.includes('/p2p-circuit/webrtc/p2p/') && addr.includes('/ip4/95.217.163.72/')) ??
    ownMultiaddrs.find((addr) => addr.includes('/p2p-circuit/p2p/')) ??
    ownMultiaddrs.find((addr) => addr.includes('/p2p-circuit/webrtc/p2p/')) ??
    null
  )
}

test('manual circuit dial reaches the other browser peer if the relay path is usable', async ({ browser }) => {
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

    const secondSnapshot = await debugSnapshot(second.page)
    const secondPeerId = secondSnapshot.localPeerId
    const dialAddr = pickDialAddr(secondSnapshot)
    expect(dialAddr).toBeTruthy()

    await first.page.evaluate(async (addr) => {
      await window.__pongDebug.dialMultiaddr(addr)
    }, dialAddr)

    await expect
      .poll(async () => {
        const snapshot = await debugSnapshot(first.page)
        return snapshot.node?.connections ?? []
      }, { timeout: timeoutMs })
      .toContainEqual(expect.objectContaining({ peerId: secondPeerId }))

    const afterFirst = await debugSnapshot(first.page)
    const afterSecond = await debugSnapshot(second.page)
    console.error(
      'manual-dial-summary',
      JSON.stringify(
        {
          dialAddr,
          firstConnections: afterFirst.node?.connections ?? [],
          secondConnections: afterSecond.node?.connections ?? [],
          firstEvents: afterFirst.node?.events ?? [],
          secondEvents: afterSecond.node?.events ?? [],
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
      'manual-dial-failure',
      JSON.stringify(
        {
          first: afterFirst.node,
          second: afterSecond.node,
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
