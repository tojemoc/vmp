import { type ReactNode, useState } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { isTvPlatform } from '../platform/tv';

type FocusableProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  focusedStyle?: StyleProp<ViewStyle>;
  preferredFocus?: boolean;
  children?: ReactNode;
};

/**
 * Pressable with visible D-pad focus ring on TV. On phone it behaves like Pressable.
 */
export function Focusable({
  style,
  focusedStyle,
  preferredFocus,
  onFocus,
  onBlur,
  children,
  ...rest
}: FocusableProps) {
  const [focused, setFocused] = useState(false);
  const tv = isTvPlatform();

  return (
    <Pressable
      {...rest}
      hasTVPreferredFocus={tv ? preferredFocus : undefined}
      onFocus={(e) => {
        if (tv) setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        if (tv) setFocused(false);
        onBlur?.(e);
      }}
      style={[style, focused ? (focusedStyle ?? styles.focused) : null]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  focused: {
    borderColor: '#38bdf8',
    borderWidth: 3,
    transform: [{ scale: 1.03 }],
  },
});
