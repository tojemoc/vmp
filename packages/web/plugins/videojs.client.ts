/**
 * Bundle Video.js locally so videojs-video-element does not fetch from jsDelivr.
 * Safari Tracking Prevention blocks storage for third-party CDN scripts, which breaks
 * dynamic script loading and causes "Cannot read properties of undefined (reading 'src')".
 */
import videojs from 'video.js'
import 'video.js/dist/video-js.css'

export default defineNuxtPlugin(() => {
  if (typeof globalThis.videojs === 'undefined') {
    globalThis.videojs = videojs
  }
})
