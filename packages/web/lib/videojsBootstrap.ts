/**
 * Lazy-load Video.js and register <videojs-video> only on the watch page.
 * Keeps ~500KB+ of player code out of the homepage entry bundle.
 */
import type videojs from 'video.js'

type VideojsMediaElement = HTMLElement & {
  api?: { pause?: () => void; play?: () => Promise<void> | void }
  nativeEl?: HTMLVideoElement
  call?: (name: string, ...args: unknown[]) => unknown
}

let bootstrapPromise: Promise<void> | null = null

function patchVideojsPlaybackMethods() {
  const ctor = customElements.get('videojs-video')
  if (!ctor?.prototype?.call) return

  const proto = ctor.prototype as VideojsMediaElement
  if ((proto as { __vmpPlaybackPatched?: boolean }).__vmpPlaybackPatched) return
  ;(proto as { __vmpPlaybackPatched?: boolean }).__vmpPlaybackPatched = true

  const originalCall = proto.call
  proto.call = function callWithNativeFallback(this: VideojsMediaElement, name: string, ...args: unknown[]) {
    if (name === 'pause' || name === 'play') {
      const apiMethod = this.api?.[name]
      if (typeof apiMethod === 'function') {
        return apiMethod.apply(this.api, args as [])
      }
      const native = this.nativeEl
      const nativeMethod = native?.[name]
      if (typeof nativeMethod === 'function') {
        return nativeMethod.apply(native, args as [])
      }
    }
    return originalCall?.call(this, name, ...args)
  }

  const protoRecord = proto as VideojsMediaElement & Record<'pause' | 'play', (...args: unknown[]) => unknown>
  for (const method of ['pause', 'play'] as const) {
    if (typeof protoRecord[method] === 'function') continue
    protoRecord[method] = function patchedPlaybackMethod(this: VideojsMediaElement, ...args: unknown[]) {
      return proto.call?.call(this, method, ...args)
    }
  }
}

/** Load Video.js once and register the custom element used on /watch. */
export async function ensureVideojsLoaded(): Promise<void> {
  if (!import.meta.client) return
  if (customElements.get('videojs-video')) return
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const [{ default: videojsLib }, videoElementModule] = await Promise.all([
        import('video.js'),
        import('videojs-video-element'),
      ])
      await import('video.js/dist/video-js.css')

      const g = globalThis as typeof globalThis & { videojs?: typeof videojs }
      if (typeof g.videojs === 'undefined') {
        g.videojs = videojsLib as typeof videojs
      }

      void videoElementModule
      await customElements.whenDefined('videojs-video')
      patchVideojsPlaybackMethods()
    })().catch((err) => {
      bootstrapPromise = null
      throw err
    })
  }
  await bootstrapPromise
}
