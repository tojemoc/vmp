import { Platform } from 'react-native';

/**
 * True on Android TV / Apple TV when built with react-native-tvos + EXPO_TV.
 * Phone/tablet builds leave Platform.isTV false/undefined.
 */
export function isTvPlatform(): boolean {
  return Boolean((Platform as { isTV?: boolean }).isTV);
}
