/**
 * Add `crossorigin="anonymous"` to the same-origin `<script>` and module-preload
 * tags Nuxt injects.
 *
 * Safari (and other browsers) mask any cross-origin script whose response carries
 * no CORS header: the fault reaches `window.onerror` as an opaque `Script error.`
 * with no message and no stack, so error tracking cannot read it. Marking the tag
 * cross-origin makes the browser hand over the real message and stack instead.
 *
 * Only same-origin URLs (a single leading `/`) are touched. Third-party tags such
 * as GTM use absolute origins and need matching server CORS headers, so they are
 * left untouched to avoid blocking them.
 */

/** True for a root-relative path (`/x`), which is always same-origin — not `//host`. */
function isSameOriginPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

/** True for a `<link>` tag that fetches a script (module preload or script preload). */
function isScriptLink(tag: string): boolean {
  return /\srel="modulepreload"/i.test(tag) || /\sas="script"/i.test(tag);
}

export function addCrossOriginToAssetTags(markup: string): string {
  return markup.replace(/<(script|link)\b[^>]*>/gi, (tag, name: string) => {
    if (/\scrossorigin(?:[\s=>/]|$)/i.test(tag)) return tag;
    const isScript = name.toLowerCase() === 'script';
    const urlMatch = tag.match(isScript ? /\ssrc="([^"]*)"/i : /\shref="([^"]*)"/i);
    if (!urlMatch || !isSameOriginPath(urlMatch[1])) return tag;
    if (!isScript && !isScriptLink(tag)) return tag;
    return tag.replace(/\s*\/?>$/, (close) => ` crossorigin="anonymous"${close}`);
  });
}
