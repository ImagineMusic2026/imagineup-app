import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/hooks/use-stack-screen-options';

export default function OnboardingLayout() {
  return <Stack screenOptions={{ ...useStackScreenOptions(), gestureEnabled: false }} />;
}
