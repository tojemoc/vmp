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
  const raw = await SecureStore.getItemAsync(SUB_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedSubscription;
    if (!parsed || parsed.userId !== userId) return null;
    return parsed.subscription ?? null;
  } catch {
    return null;
  }
}

export async function clearSubscriptionCache(): Promise<void> {
  await SecureStore.deleteItemAsync(SUB_CACHE_KEY);
}
