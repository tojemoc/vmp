/**
 * Lazy-load Video.js and register <videojs-video> only on the watch page.
 * Keeps ~500KB+ of player code out of the homepage entry bundle.
 */
import type videojs from 'video.js';

type VideojsMediaElement = HTMLElement & {
  api?: { pause?: () => void; play?: () => Promise<void> | void };
  nativeEl?: HTMLVideoElement;
  call?: (name: string, ...args: unknown[]) => unknown;
  load?: () => Promise<void> | void;
};

const ELEMENT_NAME = 'videojs-video';

/**
 * Upgrading and building the player takes a frame or two in practice. The cap only
 * exists so a wedged element surfaces an error instead of spinning forever.
 */
const READY_TIMEOUT_MS = 10_000;

let bootstrapPromise: Promise<void> | null = null;

function patchVideojsPlaybackMethods() {
  const ctor = customElements.get(ELEMENT_NAME);
  if (!ctor?.prototype?.call) return;

  const proto = ctor.prototype as VideojsMediaElement;
  if ((proto as { __vmpPlaybackPatched?: boolean }).__vmpPlaybackPatched) return;
  (proto as { __vmpPlaybackPatched?: boolean }).__vmpPlaybackPatched = true;

  const originalCall = proto.call;
  proto.call = function callWithNativeFallback(
    this: VideojsMediaElement,
    name: string,
    ...args: unknown[]
  ) {
    if (name === 'pause' || name === 'play') {
      const apiMethod = this.api?.[name];
      if (typeof apiMethod === 'function') {
        return apiMethod.apply(this.api, args as []);
      }
      const native = this.nativeEl;
      const nativeMethod = native?.[name];
      if (typeof nativeMethod === 'function') {
        return nativeMethod.apply(native, args as []);
      }
    }
    return originalCall?.call(this, name, ...args);
  };

  const protoRecord = proto as VideojsMediaElement &
    Record<'pause' | 'play', (...args: unknown[]) => unknown>;
  for (const method of ['pause', 'play'] as const) {
    if (typeof protoRecord[method] === 'function') continue;
    protoRecord[method] = function patchedPlaybackMethod(
      this: VideojsMediaElement,
      ...args: unknown[]
    ) {
      return proto.call?.call(this, method, ...args);
    };
  }
}

/** Load Video.js once and register the custom element used on /watch. */
export async function ensureVideojsLoaded(): Promise<void> {
  if (!import.meta.client) return;
  if (customElements.get(ELEMENT_NAME)) return;
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const cssPromise = import('video.js/dist/video-js.css');
      const { default: videojsLib } = await import('video.js');

      // Publish the global *before* videojs-video-element is evaluated. Evaluating it
      // calls customElements.define(), which immediately upgrades the <videojs-video>
      // already in the DOM — and the element lazily fetches Video.js from a CDN when
      // `globalThis.videojs` is missing. That fetch leaves the element's init flag set
      // while `api` is still undefined, which is the window in which a load() throws
      // "can't access property 'src', this.api is undefined".
      const g = globalThis as typeof globalThis & { videojs?: typeof videojs };
      if (typeof g.videojs === 'undefined') {
        g.videojs = videojsLib as typeof videojs;
      }

      // Side-effect import: evaluating the module registers the custom element.
      const videoElementModule = await import('videojs-video-element');
      void videoElementModule;
      await cssPromise;

      await customElements.whenDefined(ELEMENT_NAME);
      patchVideojsPlaybackMethods();
    })().catch((err) => {
      bootstrapPromise = null;
      throw err;
    });
  }
  await bootstrapPromise;
}

/** Yield for a frame, falling back to a timer so hidden tabs still make progress. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
    setTimeout(finish, 32);
  });
}

async function waitUntil(
  predicate: () => boolean,
  options: { signal?: AbortSignal; message: string },
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (Date.now() - startedAt > READY_TIMEOUT_MS) throw new Error(options.message);
    await nextFrame();
  }
  if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
}

/**
 * Resolve once `el` is genuinely usable: the class is registered, *this instance* is
 * upgraded and connected, and its Video.js `api` exists.
 *
 * `customElements.whenDefined()` is not enough — it only reports that the class was
 * registered. `api` is created inside the element's own async load(), and the element
 * sets its init flag before assigning `api`, so anything that triggers a second load()
 * during that window (setting `src` does) throws
 * `TypeError: can't access property "src", this.api is undefined`.
 *
 * Call this before touching `src`, and re-check your own abort/staleness guard after
 * it resolves — it awaits, so the caller may no longer be the current invocation.
 */
export async function ensureVideojsElementReady(
  el: HTMLElement,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  await ensureVideojsLoaded();

  const ctor = customElements.get(ELEMENT_NAME);
  if (!ctor) throw new Error(`<${ELEMENT_NAME}> was not registered`);

  // define() upgrades connected instances itself, but an element that was detached at
  // registration time (route change, transition) needs a nudge.
  if (!(el instanceof ctor)) customElements.upgrade(el);
  await waitUntil(() => el instanceof ctor && el.isConnected, {
    signal: options.signal,
    message: `<${ELEMENT_NAME}> did not finish upgrading`,
  });

  const media = el as VideojsMediaElement;
  if (media.api) return;

  // `api` only appears once load() has run. A load() may already be in flight, in which
  // case ours rejects with exactly the TypeError above — ignore it and let the poll
  // below settle on whichever call wins.
  void Promise.resolve()
    .then(() => media.load?.())
    .catch(() => {});

  await waitUntil(() => Boolean(media.api), {
    signal: options.signal,
    message: `<${ELEMENT_NAME}> never exposed its player API`,
  });
}
