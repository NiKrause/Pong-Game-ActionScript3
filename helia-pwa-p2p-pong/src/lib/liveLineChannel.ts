import type { Stream } from '@libp2p/interface'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function chunkToUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk
  if (chunk != null && typeof chunk === 'object' && 'subarray' in chunk) {
    return (chunk as { subarray: (start?: number, end?: number) => Uint8Array }).subarray()
  }
  throw new TypeError('Unexpected stream chunk type')
}

class AsyncByteQueue implements AsyncIterable<Uint8Array> {
  private items: Uint8Array[] = []
  private waiters: Array<(result: IteratorResult<Uint8Array>) => void> = []
  private ended = false

  push(value: Uint8Array): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    if (waiter != null) {
      waiter({ value, done: false })
      return
    }
    this.items.push(value)
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    while (true) {
      if (this.items.length > 0) {
        const next = this.items.shift()
        if (next != null) yield next
        continue
      }
      if (this.ended) return
      const result = await new Promise<IteratorResult<Uint8Array>>((resolve) => {
        this.waiters.push(resolve)
      })
      if (result.done) return
      yield result.value
    }
  }
}

export type LiveLineChannel<T> = {
  send: (message: T) => void
  close: () => Promise<void>
}

export function createLiveLineChannel<T>(
  stream: Stream,
  onMessage: (message: T) => void,
  onClose?: (error?: string) => void
): LiveLineChannel<T> {
  const queue = new AsyncByteQueue()
  let closed = false

  const finish = (error?: unknown): void => {
    if (closed) return
    closed = true
    queue.end()
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
    onClose?.(message)
  }

  void stream
    .sink(queue)
    .catch((error: unknown) => {
      finish(error)
    })

  void (async () => {
    try {
      let buffer = ''
      for await (const chunk of stream.source) {
        buffer += textDecoder.decode(chunkToUint8Array(chunk), { stream: true })
        while (true) {
          const newlineIndex = buffer.indexOf('\n')
          if (newlineIndex === -1) break
          const rawLine = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          if (rawLine === '') continue
          onMessage(JSON.parse(rawLine) as T)
        }
      }
      finish()
    } catch (error) {
      finish(error)
    }
  })()

  return {
    send(message: T): void {
      if (closed) return
      queue.push(textEncoder.encode(`${JSON.stringify(message)}\n`))
    },
    async close(): Promise<void> {
      if (closed) return
      finish()
      try {
        await stream.close()
      } catch {
        // ignore
      }
    },
  }
}
