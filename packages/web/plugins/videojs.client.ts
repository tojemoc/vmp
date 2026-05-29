/**
 * Bundle Video.js locally so videojs-video-element does not fetch from jsDelivr.
 * Safari Tracking Prevention blocks storage for third-party CDN scripts, which breaks
 * dynamic script loading and causes "Cannot read properties of undefined (reading 'src')".
 */
import videojs from 'video.js'
import 'video.js/dist/video-js.css'

export default defineNuxtPlugin(() => {
  const g = globalThis as typeof globalThis & { videojs?: typeof videojs }
  if (typeof g.videojs === 'undefined') {
    g.videojs = videojs
  }
})
