import { useMutation } from '@tanstack/react-query';

import { haptics } from '@/services/haptics';

import { signInWithEmail } from '../api';
import type { SignInForm } from '../schemas';

/** Entrar não passa pelo cache: o resultado chega pelo listener de sessão. */
export function useSignIn() {
  return useMutation<void, Error, SignInForm>({
    mutationFn: ({ email, password }) => signInWithEmail(email, password),
    onSuccess: () => haptics.trigger('success'),
    onError: () => haptics.trigger('error'),
    networkMode: 'always',
    retry: false,
  });
}
