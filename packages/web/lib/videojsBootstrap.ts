/**
 * Lazy-load Video.js and register <videojs-video> only on the watch page.
 * Keeps ~500KB+ of player code out of the homepage entry bundle.
 */
import type videojs from 'video.js';

type VideojsFn = typeof videojs;

type VideojsMediaElement = HTMLElement & {
  api?: {
    pause?: () => void;
    play?: () => Promise<void> | void;
    src?: (value: string) => void;
    ready?: (cb: () => void) => void;
  };
  nativeEl?: HTMLVideoElement;
  call?: (name: string, ...args: unknown[]) => unknown;
  load?: () => Promise<void> | void;
  loadComplete?: { resolve?: () => void };
};

type VideojsGlobal = typeof globalThis & { videojs?: unknown };

const ELEMENT_NAME = 'videojs-video';

/**
 * Upgrading and building the player takes a frame or two in practice. The cap only
 * exists so a wedged element surfaces an error instead of spinning forever.
 */
const READY_TIMEOUT_MS = 10_000;

/**
 * Native <video> is created in the custom element constructor. Fail fast when it is
 * missing rather than waiting the full player timeout.
 */
const NATIVE_EL_TIMEOUT_MS = 500;

/**
 * How long to wait for the element's own load() before reconstructing the player.
 * videojs-video-element sets its private init flag *before* assigning `api`; when that
 * first load hangs on a CDN fetch (globalThis.videojs missing) or throws, waiting the
 * full READY_TIMEOUT_MS just delays the same failure.
 */
const ELEMENT_LOAD_GRACE_MS = 2_000;

let bootstrapPromise: Promise<void> | null = null;

function getVideojsGlobal(): VideojsFn | null {
  const candidate = (globalThis as VideojsGlobal).videojs;
  // `typeof x === 'function'` only narrows to Function; VideojsFn needs unknown first.
  return typeof candidate === 'function' ? (candidate as unknown as VideojsFn) : null;
}

/** Unwrap CJS/ESM interop shapes (`fn`, `{ default: fn }`, nested default). */
function unwrapVideojsExport(mod: unknown): VideojsFn | null {
  let candidate: unknown = mod;
  for (let i = 0; i < 3; i += 1) {
    if (typeof candidate === 'function') return candidate as unknown as VideojsFn;
    if (candidate && typeof candidate === 'object' && 'default' in candidate) {
      candidate = (candidate as { default: unknown }).default;
      continue;
    }
    break;
  }
  return null;
}

/**
 * Guarantee `globalThis.videojs` is the Video.js constructor. videojs-video-element
 * falls back to a jsDelivr script tag when the global is missing; that path sets the
 * element's init flag before `api` exists and is what wedges Mobile Safari when the
 * CDN is slow or blocked.
 */
async function publishVideojsGlobal(): Promise<VideojsFn> {
  const existing = getVideojsGlobal();
  if (existing) return existing;

  const mod = await import('video.js');
  const videojsLib = unwrapVideojsExport(mod);
  if (!videojsLib) {
    throw new Error('Video.js module did not export a constructor');
  }
  (globalThis as VideojsGlobal).videojs = videojsLib;
  return videojsLib;
}

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

/**
 * Reconstruct `api` when videojs-video-element wedged: private `#apiInit` is true but
 * `api` was never assigned (CDN hang / thrown init). Later element `load()` calls take
 * the `this.api.src(...)` branch once `api` exists.
 */
function recoverWedgedVideojsApi(media: VideojsMediaElement, videojsFn: VideojsFn): void {
  if (media.api) return;
  const video = media.nativeEl;
  if (!video) return;

  try {
    const options = {
      autoplay: false,
      preload: media.getAttribute?.('preload') ?? 'metadata',
      playsinline: true,
      controls: false,
      children: ['mediaLoader'],
      html5: { nativeTextTracks: true },
    };
    media.api = videojsFn(video, options) as VideojsMediaElement['api'];
    media.api?.ready?.(() => {
      media.loadComplete?.resolve?.();
    });
  } catch {
    // Leave api unset; the caller surfaces the standard readiness timeout.
  }
}

/** Load Video.js once and register the custom element used on /watch. */
export async function ensureVideojsLoaded(): Promise<void> {
  if (!import.meta.client) return;

  // CE may already be registered (route revisit, HMR) while the global was lost or
  // never published — still ensure videojs is callable so load() never hits the CDN.
  if (customElements.get(ELEMENT_NAME)) {
    await publishVideojsGlobal();
    patchVideojsPlaybackMethods();
    return;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const cssPromise = import('video.js/dist/video-js.css');

      // Publish the global *before* videojs-video-element is evaluated. Evaluating it
      // calls customElements.define(), which immediately upgrades the <videojs-video>
      // already in the DOM — and the element lazily fetches Video.js from a CDN when
      // `globalThis.videojs` is missing. That fetch leaves the element's init flag set
      // while `api` is still undefined, which is the window in which a load() throws
      // "can't access property 'src', this.api is undefined".
      await publishVideojsGlobal();

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
  options: { signal?: AbortSignal; message: string; timeoutMs?: number },
): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS;
  while (!predicate()) {
    if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (Date.now() - startedAt > timeoutMs) throw new Error(options.message);
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

  // Shadow/light <video> must exist before load() — otherwise the element sets its
  // init flag and throws on `video.classList`, permanently wedging this instance.
  // Native video is created in the constructor; a short cap beats a 10s spinner.
  await waitUntil(() => Boolean(media.nativeEl) || Boolean(media.api) || !el.isConnected, {
    signal: options.signal,
    message: `<${ELEMENT_NAME}> never created its native video`,
    timeoutMs: NATIVE_EL_TIMEOUT_MS,
  });
  if (!el.isConnected) {
    throw new DOMException('Request aborted', 'AbortError');
  }
  if (media.api) return;

  // Prefer the element's own load(). A concurrent in-flight load() rejects with the
  // TypeError above — ignore it and settle on whichever call produces `api`.
  // When load() settles without `api` (wedged init flag), recover immediately rather
  // than waiting out the full grace window.
  let loadSettled = false;
  void Promise.resolve()
    .then(() => media.load?.())
    .catch(() => undefined)
    .finally(() => {
      loadSettled = true;
    });

  await waitUntil(() => Boolean(media.api) || !el.isConnected || loadSettled, {
    signal: options.signal,
    message: `__element_load_grace__`,
    timeoutMs: ELEMENT_LOAD_GRACE_MS,
  }).catch((err) => {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Grace elapsed with load() still hanging (CDN) — try recovery below.
  });

  if (!el.isConnected) {
    throw new DOMException('Request aborted', 'AbortError');
  }
  if (media.api) return;

  const videojsFn = getVideojsGlobal();
  if (videojsFn) {
    recoverWedgedVideojsApi(media, videojsFn);
  }

  await waitUntil(() => Boolean(media.api) || !el.isConnected, {
    signal: options.signal,
    message: `<${ELEMENT_NAME}> never exposed its player API`,
  });
  if (!el.isConnected) {
    throw new DOMException('Request aborted', 'AbortError');
  }
}
