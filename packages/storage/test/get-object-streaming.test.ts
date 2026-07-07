import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { R2Bucket } from '@cloudflare/workers-types'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import type { S3Client } from '@aws-sdk/client-s3'
import { wrapR2Bucket } from '../src/r2-binding.js'
import { S3CompatibleStorageProvider } from '../src/s3-compatible.js'

function makeTestStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]))
      controller.close()
    },
  })
}

describe('wrapR2Bucket getObject', () => {
  it('returns the native R2 body stream without buffering', async () => {
    const stream = makeTestStream()
    const bucket = {
      async get(key: string) {
        assert.equal(key, 'videos/test/seg.m4s')
        return {
          body: stream,
          size: 3,
          httpMetadata: { contentType: 'video/iso.segment' },
        }
      },
    }

    const provider = wrapR2Bucket(bucket as unknown as R2Bucket)
    const result = await provider.getObject('videos/test/seg.m4s')

    assert.ok(result)
    assert.equal(result.body, stream)
    assert.equal(result.body instanceof ReadableStream, true)
  })

  it('forwards byte range options to bucket.get', async () => {
    let capturedOptions: unknown
    const bucket = {
      async get(_key: string, options?: unknown) {
        capturedOptions = options
        return { body: makeTestStream(), size: 1000 }
      },
    }

    const provider = wrapR2Bucket(bucket as unknown as R2Bucket)
    await provider.getObject('videos/test/seg.m4s', { range: { offset: 100, length: 50 } })

    assert.deepEqual(capturedOptions, { range: { offset: 100, length: 50 } })
  })
})

describe('S3CompatibleStorageProvider getObject', () => {
  it('returns a ReadableStream without buffering the SDK body', async () => {
    const stream = makeTestStream()
    const mockClient = {
      async send(command: GetObjectCommand) {
        assert.ok(command instanceof GetObjectCommand)
        return { Body: stream, ContentLength: 3, ContentType: 'video/iso.segment' }
      },
    }

    const provider = new S3CompatibleStorageProvider({
      id: 'test',
      bucket: 'test-bucket',
      client: mockClient as unknown as S3Client,
    })
    const result = await provider.getObject('videos/test/seg.m4s')

    assert.ok(result)
    assert.equal(result.body, stream)
    assert.equal(result.body instanceof ReadableStream, true)
  })

  it('forwards Range to GetObjectCommand', async () => {
    const sent: GetObjectCommand[] = []
    const mockClient = {
      async send(command: GetObjectCommand) {
        sent.push(command)
        return { Body: makeTestStream(), ContentLength: 50 }
      },
    }

    const provider = new S3CompatibleStorageProvider({
      id: 'test',
      bucket: 'test-bucket',
      client: mockClient as unknown as S3Client,
    })
    await provider.getObject('videos/test/seg.m4s', { range: { offset: 100, length: 50 } })

    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.input.Range, 'bytes=100-149')
  })
})
