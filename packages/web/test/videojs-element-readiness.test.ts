import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ensureVideojsElementReady } from '../lib/videojsBootstrap';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stands in for <videojs-video>. Reproduces the two details that made the real player
 * die: `api` only exists once load() has run, and load() sets its init flag *before*
 * assigning `api`, so a second load() during that window throws.
 */
class FakeVideojsElement {
  isConnected = true;
  api: { src: (value: string) => void } | undefined;
  loadCalls = 0;
  private apiInit = false;

  constructor(private readonly initDelayMs = 0) {}

  async load(): Promise<void> {
    this.loadCalls += 1;
    if (this.apiInit) {
      // Exactly what the real element does — and what threw for users when `api` was
      // still undefined: TypeError: can't access property "src", this.api is undefined.
      (this.api as { src: (value: string) => void }).src('');
      return;
    }
    this.apiInit = true;
    if (this.initDelayMs > 0) await delay(this.initDelayMs);
    this.api = { src: () => {} };
  }
}

class NeverReadyElement {
  isConnected = true;
  api: undefined;
  loadCalls = 0;

  async load(): Promise<void> {
    this.loadCalls += 1;
    await new Promise<never>(() => {});
  }
}

function registryWith(entries: Record<string, unknown>) {
  return {
    get: (name: string) => entries[name],
    whenDefined: async () => {},
    upgrade: () => {},
  };
}

function installRegistry(ctor: unknown) {
  const entries = ctor === undefined ? {} : { 'videojs-video': ctor };
  (globalThis as { customElements?: unknown }).customElements = registryWith(entries);
}

const asElement = (el: unknown) => el as unknown as HTMLElement;

let previousCustomElements: unknown;

beforeEach(() => {
  previousCustomElements = (globalThis as { customElements?: unknown }).customElements;
});

afterEach(() => {
  (globalThis as { customElements?: unknown }).customElements = previousCustomElements;
});

describe('ensureVideojsElementReady', () => {
  it('builds the player before the caller is allowed to touch src', async () => {
    installRegistry(FakeVideojsElement);
    const el = new FakeVideojsElement();

    await ensureVideojsElementReady(asElement(el));

    assert.ok(el.api, 'api must exist before src is set');
    assert.equal(el.loadCalls, 1);
  });

  it('waits out a load() that is already in flight instead of throwing on it', async () => {
    installRegistry(FakeVideojsElement);
    // The lazy-import race: init flag set, `api` not assigned yet.
    const el = new FakeVideojsElement(120);
    void el.load();
    assert.equal(el.api, undefined);

    await ensureVideojsElementReady(asElement(el));

    assert.ok(el.api, 'must resolve only once the in-flight load() produced an api');
  });

  it('is a no-op once the element already has a player (route changes)', async () => {
    installRegistry(FakeVideojsElement);
    const el = new FakeVideojsElement();
    await el.load();

    await ensureVideojsElementReady(asElement(el));

    assert.equal(el.loadCalls, 1, 'must not kick off a redundant load()');
  });

  it('waits for an element that is not connected yet', async () => {
    installRegistry(FakeVideojsElement);
    const el = new FakeVideojsElement();
    el.isConnected = false;
    setTimeout(() => {
      el.isConnected = true;
    }, 60);

    await ensureVideojsElementReady(asElement(el));

    assert.ok(el.api);
  });

  it('aborts promptly rather than holding the spinner until the timeout', async () => {
    installRegistry(NeverReadyElement);
    const el = new NeverReadyElement();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);

    await assert.rejects(
      ensureVideojsElementReady(asElement(el), { signal: controller.signal }),
      (e: unknown) => e instanceof DOMException && e.name === 'AbortError',
    );
  });

  it('fails loudly when the custom element was never registered', async () => {
    installRegistry(undefined);

    await assert.rejects(
      ensureVideojsElementReady(asElement(new FakeVideojsElement())),
      /was not registered/,
    );
  });
});
