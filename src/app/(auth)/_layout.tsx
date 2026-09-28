import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/hooks/use-stack-screen-options';

export default function AuthLayout() {
  return <Stack screenOptions={useStackScreenOptions()} />;
}
