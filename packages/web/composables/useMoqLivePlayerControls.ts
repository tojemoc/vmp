import type { Signal } from '@moq/signals';
import { ref, type ShallowRef, shallowRef } from 'vue';

type Dispose = () => void;

/**
 * Control surface for the composed @moq/watch 0.4 pipeline
 * (Broadcast + Video/Audio + Sync), replacing the removed MultiBackend.
 */
export type MoqLivePlayerHandle = {
  paused: Signal<boolean>;
  volume: Signal<number>;
  muted: Signal<boolean>;
  /** Pulse true→false to wait for re-announcement / catch the live edge. */
  reload: Signal<boolean>;
  /** Optional sync reset used when catching up to live in buffered mode. */
  resetSync?: () => void;
};

/**
 * UI state + actions for MoQ live playback (canvas + WebAudio).
 */
export function useMoqLivePlayerControls() {
  const shellRef = ref<HTMLElement | null>(null);
  const player = shallowRef<MoqLivePlayerHandle | null>(null);

  const isPaused = ref(false);
  const volume01 = ref(0.85);
  const isMuted = ref(false);

  const disposers: Dispose[] = [];

  const clearSubscriptions = () => {
    while (disposers.length) {
      disposers.pop()?.();
    }
  };

  const attach = (handle: MoqLivePlayerHandle) => {
    clearSubscriptions();
    player.value = handle;
    disposers.push(
      handle.paused.subscribe((v) => {
        isPaused.value = v;
      }),
    );
    disposers.push(
      handle.volume.subscribe((v) => {
        volume01.value = v;
      }),
    );
    disposers.push(
      handle.muted.subscribe((v) => {
        isMuted.value = v;
      }),
    );
    // Seed Vue refs from current signal values (subscribe alone is change-only).
    isPaused.value = handle.paused.peek();
    volume01.value = handle.volume.peek();
    isMuted.value = handle.muted.peek();
  };

  const detach = () => {
    clearSubscriptions();
    player.value = null;
  };

  const togglePause = () => {
    const p = player.value;
    if (!p) return;
    p.paused.update((paused) => !paused);
  };

  /** Resume A/V and re-anchor to the live edge (sync reset + reload pulse). */
  const goLive = () => {
    const p = player.value;
    if (!p) return;
    p.paused.set(false);
    p.resetSync?.();
    // Brief false→true pulse forces re-subscribe; steady state stays reload=true
    // (wait for announcements), matching <moq-watch>'s default.
    p.reload.set(false);
    queueMicrotask(() => {
      p.reload.set(true);
    });
  };

  const toggleMute = () => {
    const p = player.value;
    if (!p) return;
    p.muted.update((m) => !m);
  };

  const setVolume = (v: number) => {
    const p = player.value;
    if (!p) return;
    const clamped = Math.min(1, Math.max(0, v));
    p.volume.set(clamped);
    if (clamped > 0 && p.muted.peek()) p.muted.set(false);
  };

  const toggleFullscreen = async () => {
    const el = shellRef.value;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('toggleFullscreen failed in useMoqLivePlayerControls', {
          shellRef: shellRef.value,
          err,
        });
      }
    }
  };

  return {
    shellRef,
    player: player as ShallowRef<MoqLivePlayerHandle | null>,
    isPaused,
    volume01,
    isMuted,
    attach,
    detach,
    togglePause,
    goLive,
    toggleMute,
    setVolume,
    toggleFullscreen,
  };
}

export function isLiveRecommendation(rec: { livestream_provider?: string | null }): boolean {
  return Boolean(rec?.livestream_provider);
}
