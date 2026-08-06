import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Persist a storage getObject body to a local path without buffering streams in memory. */
export async function writeObjectBodyToFile(
  body: ReadableStream | Uint8Array | ArrayBuffer,
  localIn: string,
): Promise<void> {
  if (body instanceof ReadableStream) {
    await pipeline(
      Readable.fromWeb(body as import('node:stream/web').ReadableStream),
      createWriteStream(localIn),
    );
    return;
  }
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  await writeFile(localIn, bytes);
}
