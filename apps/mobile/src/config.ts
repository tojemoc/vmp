/** Runtime config for the Tier 1 Expo PoC. */

const DEFAULT_API_URL = 'http://localhost:8787';

export const apiUrl = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, '');

export const appScheme = 'vmp';
