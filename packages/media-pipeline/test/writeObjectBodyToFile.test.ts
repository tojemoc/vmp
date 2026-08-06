import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { writeObjectBodyToFile } from '../writeObjectBodyToFile.js';

describe('writeObjectBodyToFile', () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'vmp-write-object-body-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes ReadableStream body bytes exactly', async () => {
    const source = Buffer.from([0x01, 0x02, 0xff, 0x00, 0x7a]);
    const out = path.join(dir, 'stream.bin');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(source));
        controller.close();
      },
    });
    await writeObjectBodyToFile(stream, out);
    assert.deepEqual(await readFile(out), source);
  });

  it('writes Uint8Array body bytes exactly', async () => {
    const source = new Uint8Array([10, 20, 30, 40, 50]);
    const out = path.join(dir, 'uint8.bin');
    await writeObjectBodyToFile(source, out);
    assert.deepEqual(await readFile(out), Buffer.from(source));
  });

  it('writes ArrayBuffer body bytes exactly', async () => {
    const source = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]).buffer;
    const out = path.join(dir, 'arraybuffer.bin');
    await writeObjectBodyToFile(source, out);
    assert.deepEqual(await readFile(out), Buffer.from(new Uint8Array(source)));
  });
});
