import http from 'node:http'
import path from 'node:path'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'

const LOCAL_RELAY_PORTS = {
  tcp: '4301',
  ws: '4302',
  webrtc: '4303',
  webrtcDirect: '4306',
  http: '4300',
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body: data })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function waitForRelayMultiaddrs(httpPort, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const response = await httpGet(`http://127.0.0.1:${httpPort}/multiaddrs`)
      if (response.status === 200) {
        const payload = JSON.parse(response.body || '{}')
        const multiaddrs = Array.isArray(payload.all) ? payload.all : []
        const relayMultiaddr = multiaddrs.find(
          (addr) => typeof addr === 'string' && addr.includes('/ws') && addr.includes('/p2p/')
        )
        if (relayMultiaddr != null) {
          return relayMultiaddr.replace(/^\/ip4\/[^/]+\/tcp\//, '/ip4/127.0.0.1/tcp/')
        }
      }
      lastError = new Error(`relay /multiaddrs not ready yet (HTTP ${response.status})`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw lastError ?? new Error('timed out waiting for local relay')
}

function resolveRelayCliPath(cwd) {
  const binName = process.platform === 'win32' ? 'orbitdb-relay-pinner.cmd' : 'orbitdb-relay-pinner'
  const cliPath = path.join(cwd, 'node_modules', '.bin', binName)
  return existsSync(cliPath) ? cliPath : null
}

export async function startLocalRelay(cwd) {
  const relayCliPath = resolveRelayCliPath(cwd)
  if (relayCliPath == null) {
    throw new Error('orbitdb-relay-pinner is not installed')
  }

  const datastorePath = path.join(cwd, '.tmp', 'playwright-relay-datastore')
  rmSync(datastorePath, { recursive: true, force: true })
  mkdirSync(datastorePath, { recursive: true })

  const relayProcess = spawn(process.execPath, [relayCliPath], {
    cwd: datastorePath,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      RELAY_TCP_PORT: LOCAL_RELAY_PORTS.tcp,
      RELAY_WS_PORT: LOCAL_RELAY_PORTS.ws,
      RELAY_WEBRTC_PORT: LOCAL_RELAY_PORTS.webrtc,
      RELAY_WEBRTC_DIRECT_PORT: LOCAL_RELAY_PORTS.webrtcDirect,
      HTTP_PORT: LOCAL_RELAY_PORTS.http,
      METRICS_PORT: LOCAL_RELAY_PORTS.http,
      DATASTORE_PATH: datastorePath,
      PUBSUB_TOPICS: '_peer-discovery._p2p._pubsub',
      RELAY_DISABLE_WEBRTC: 'true',
      STRUCTURED_LOGS: 'false',
      ENABLE_GENERAL_LOGS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  relayProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[local-relay] ${chunk}`)
  })
  relayProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[local-relay] ${chunk}`)
  })

  const relayMultiaddr = await waitForRelayMultiaddrs(LOCAL_RELAY_PORTS.http)

  return {
    httpBase: `http://127.0.0.1:${LOCAL_RELAY_PORTS.http}`,
    relayMultiaddr,
    stop: async () => {
      if (relayProcess.killed) return
      relayProcess.kill('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (relayProcess.exitCode == null) {
        relayProcess.kill('SIGKILL')
      }
    },
  }
}
