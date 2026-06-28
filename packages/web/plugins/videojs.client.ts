/**
 * Bundle Video.js locally so videojs-video-element does not fetch from jsDelivr.
 * Safari Tracking Prevention blocks storage for third-party CDN scripts, which breaks
 * dynamic script loading and causes "Cannot read properties of undefined (reading 'src')".
 */
import videojs from 'video.js'
import 'video.js/dist/video-js.css'
// Registers the <videojs-video> custom element used on the watch page.
// Regression: feat(web) offline downloads (#398) dropped the watch-page side-effect
// import; without this, customElements.whenDefined('videojs-video') never resolves.
import 'videojs-video-element'

type VideojsMediaElement = HTMLElement & {
  api?: { pause?: () => void; play?: () => Promise<void> | void }
  nativeEl?: HTMLVideoElement
  call?: (name: string, ...args: unknown[]) => unknown
}

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

export default defineNuxtPlugin(() => {
  const g = globalThis as typeof globalThis & { videojs?: typeof videojs }
  if (typeof g.videojs === 'undefined') {
    g.videojs = videojs
  }
  if (import.meta.client) {
    void customElements.whenDefined('videojs-video').then(() => {
      patchVideojsPlaybackMethods()
    })
  }
})
