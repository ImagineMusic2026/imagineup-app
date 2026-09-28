import { DarkTheme, type Theme } from 'expo-router';

import { colors } from './colors';

/** Tema dos navegadores, para que nenhuma transição pisque em branco. */
export const navigationTheme: Theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.divider,
    notification: colors.accent,
  },
};
