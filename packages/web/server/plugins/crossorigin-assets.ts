/**
 * Mark the same-origin scripts Nuxt injects as `crossorigin="anonymous"` so a
 * script fault reaches `window.onerror` with its real message and stack instead
 * of an opaque `Script error.` that error tracking cannot read. See
 * `utils/crossOriginAssets.ts` for why the masking happens and what is touched.
 */
import { addCrossOriginToAssetTags } from '../../utils/crossOriginAssets';

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html) => {
    for (const section of [html.head, html.bodyPrepend, html.bodyAppend]) {
      for (let i = 0; i < section.length; i++) {
        section[i] = addCrossOriginToAssetTags(section[i]);
      }
    }
  });
});
