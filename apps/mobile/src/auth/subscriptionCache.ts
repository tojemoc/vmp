import * as SecureStore from 'expo-secure-store';
import type { AccountSubscription } from '../entitlements/premium';

const SUB_CACHE_KEY = 'vmp.subscriptionCache';

type CachedSubscription = {
  userId: string;
  subscription: AccountSubscription;
  savedAt: string;
};

export async function writeSubscriptionCache(
  userId: string,
  subscription: AccountSubscription,
): Promise<void> {
  const payload: CachedSubscription = {
    userId,
    subscription,
    savedAt: new Date().toISOString(),
  };
  await SecureStore.setItemAsync(SUB_CACHE_KEY, JSON.stringify(payload));
}

export async function readSubscriptionCache(userId: string): Promise<AccountSubscription | null> {
  try {
    const raw = await SecureStore.getItemAsync(SUB_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSubscription;
    if (!parsed || parsed.userId !== userId) return null;
    return parsed.subscription ?? null;
  } catch {
    // SecureStore / JSON failures must not block hydrateEntitlements.
    return null;
  }
}

export async function clearSubscriptionCache(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SUB_CACHE_KEY);
  } catch {
    // Best-effort clear on logout.
  }
}
