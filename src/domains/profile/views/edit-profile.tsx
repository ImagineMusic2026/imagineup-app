import { zodResolver } from '@hookform/resolvers/zod';
import { useIsMutating } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { AccessibilityInfo, ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { LargeTitleHeader } from '@/components/header';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { sourceOf } from '@/config/data-source';
import { useIsOnline } from '@/hooks/use-is-online';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';
import { cleanLine } from '@/utils/visible-line';

import { EditPhotoSection } from '../components/edit-photo-section';
import { EditUsernameSection } from '../components/edit-username-section';
import { PROFILE_EDIT_COOLDOWN_MS, PROFILE_SAVE_TIMEOUT_MS } from '../consts';
import { useFanIdentity } from '../hooks/use-fan-identity';
import {
  lastProfileSave,
  profileMutationKeys,
  useMyProfileQuery,
  useUpdateProfileMutation,
  useWatchMyProfile,
} from '../queries';
import { editProfileSchema, type EditProfileForm, type EditProfileFormInput } from '../schemas';
import type { FanProfile, ProfileChanges } from '../types';

const FIELD_ORDER = ['name', 'city'] as const;

/** O que mudou em relação ao perfil (não ao valor inicial do formulário). */
function changesOf(
  values: { name: string; city: string | null },
  profile: Pick<FanProfile, 'displayName' | 'city'>,
): ProfileChanges {
  const changes: ProfileChanges = {};
  if (values.name !== (profile.displayName ?? '')) changes.displayName = values.name;
  if (values.city !== (profile.city ?? null)) changes.city = values.city;
  return changes;
}

/** O texto cru do formulário como o envio vai ver, para ligar o "Salvar". */
function draftOf(input: EditProfileFormInput): { name: string; city: string | null } {
  const city = cleanLine(input.city ?? '');
  return { name: cleanLine(input.name ?? ''), city: city === '' ? null : city };
}

/** Quanto falta dos 10 s depois da última gravação confirmada deste fã nesta sessão do app. */
function cooldownLeft(uid: string): number {
  const at = lastProfileSave(uid);
  return at === null ? 0 : at + PROFILE_EDIT_COOLDOWN_MS - Date.now();
}

/** A gravação recusada pela regra com valores que passaram no schema: a trava de 10 s. */
function isTooSoon(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'permission-denied';
}

type SaveMessage = { key: TranslationKey; tone: 'error' | 'info' };

/**
 * Nome e cidade, direto no Firestore pelas regras (24.12). O nome começa com o
 * de `useFanIdentity()` (o do perfil ou, no perfil sem nome, o da sessão que
 * passa nas regras) e a cidade com a do perfil; o que mudou é comparado com o
 * perfil, então no perfil sem nome o "Salvar" já começa ligado e o nome da
 * sessão vai junto. O "Salvar" fica desligado sem mudança, sem internet,
 * enquanto houver gravação do perfil pendente (o `useIsMutating`, que vale com
 * a tela fechada e aberta de novo) e nos 10 s depois de salvar. Espera a
 * confirmação até 10 s; passado o prazo, avisa e segue desligado até a
 * gravação resolver. O formulário não volta aos valores do perfil enquanto o
 * fã edita: só se reinicia depois de salvar.
 */
function EditInfoForm({
  profile,
  sessionName,
  online,
}: {
  profile: FanProfile;
  sessionName: string | null;
  online: boolean;
}) {
  const update = useUpdateProfileMutation();
  const pendingSaves = useIsMutating({ mutationKey: profileMutationKeys.update });
  const [message, setMessage] = useState<SaveMessage | null>(null);
  // Os 10 s depois de salvar, contados no aparelho a partir da confirmação
  // (também a de antes de a tela abrir de novo).
  const [initialCooldown] = useState(() => cooldownLeft(profile.uid));
  const [cooling, setCooling] = useState(initialCooldown > 0);
  const coolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const coolDown = (ms: number): void => {
    if (coolTimer.current) clearTimeout(coolTimer.current);
    coolTimer.current = setTimeout(() => setCooling(false), ms);
  };

  const { control, handleSubmit, formState, reset } = useForm<
    EditProfileFormInput,
    unknown,
    EditProfileForm
  >({
    resolver: zodResolver(editProfileSchema),
    defaultValues: { name: profile.displayName ?? sessionName ?? '', city: profile.city ?? '' },
  });

  useEffect(() => {
    if (initialCooldown > 0) {
      coolTimer.current = setTimeout(() => setCooling(false), initialCooldown);
    }
    return () => {
      if (coolTimer.current) clearTimeout(coolTimer.current);
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [initialCooldown]);

  const [name, city] = useWatch({ control, name: ['name', 'city'] });
  const dirty = Object.keys(changesOf(draftOf({ name, city }), profile)).length > 0;
  const pending = pendingSaves > 0;
  const disabled = !dirty || !online || pending || cooling;

  const fail = (key: TranslationKey): void => {
    setMessage({ key, tone: 'error' });
    AccessibilityInfo.announceForAccessibility(t(key));
    haptics.trigger('error');
  };

  const submit = (): void => {
    if (disabled) return;
    void handleSubmit(
      (form) => {
        const changes = changesOf(form, profile);
        if (Object.keys(changes).length === 0) return;
        setMessage(null);
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = setTimeout(() => {
          setMessage({ key: 'editProfile.info.timeout', tone: 'info' });
          AccessibilityInfo.announceForAccessibility(t('editProfile.info.timeout'));
        }, PROFILE_SAVE_TIMEOUT_MS);
        update.mutate(changes, {
          onSettled: () => {
            if (timeout.current) clearTimeout(timeout.current);
            timeout.current = null;
          },
          onSuccess: () => {
            reset({ name: form.name, city: form.city ?? '' });
            setCooling(true);
            coolDown(PROFILE_EDIT_COOLDOWN_MS);
            setMessage({ key: 'editProfile.info.saved', tone: 'info' });
            AccessibilityInfo.announceForAccessibility(t('editProfile.info.saved'));
            haptics.trigger('success');
          },
          onError: (error) =>
            fail(isTooSoon(error) ? 'editProfile.info.tooSoon' : 'editProfile.info.error'),
        });
      },
      (errors) => announceFirstError(errors, FIELD_ORDER),
    )();
  };

  return (
    <View testID="edit-profile-info">
      <Controller
        control={control}
        name="name"
        render={({ field: { ref, onChange, onBlur, value } }) => (
          <TextInput
            ref={ref}
            label={t('editProfile.info.name')}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={formState.errors.name?.message}
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            returnKeyType="next"
            testID="edit-profile-name"
          />
        )}
      />
      <View style={styles.field}>
        <Controller
          control={control}
          name="city"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <TextInput
              ref={ref}
              label={t('editProfile.info.city')}
              hint={t('editProfile.info.cityHint')}
              value={value ?? ''}
              onChangeText={onChange}
              onBlur={onBlur}
              error={formState.errors.city?.message}
              autoComplete="postal-address-locality"
              textContentType="addressCity"
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={submit}
              testID="edit-profile-city"
            />
          )}
        />
      </View>
      <Button
        label={t('editProfile.info.save')}
        onPress={submit}
        loading={pending}
        disabled={disabled}
        haptic="confirm"
        style={styles.save}
        testID="edit-profile-save"
      />
      {message ? (
        <Text
          variant="caption"
          color={message.tone === 'error' ? colors.danger : colors.textSecondary}
          style={styles.message}
          testID="edit-profile-save-message"
        >
          {t(message.key)}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * O perfil não está na tela: a leitura respondeu que ele não existe (a função
 * de cadastro ainda não o criou) ou falhou sem nada salvo. Enquanto ela não
 * respondeu, o indicador.
 */
function profileProblem(query: ReturnType<typeof useMyProfileQuery>): TranslationKey | null {
  if (query.data) return null;
  if (query.isError) return 'editProfile.loadError';
  return query.data === null ? 'editProfile.notReady' : null;
}

/**
 * Editar perfil (bloco 9, sem desenho, no visual das outras telas pela
 * aprovação de 28/09): a foto, nome e cidade e o @, aberta pelos Ajustes e
 * pelo hero do Perfil. Nome e cidade vão direto ao Firestore; o @ e a foto,
 * pela API, só com ela (sem a API, o @ aparece como texto e a foto sem os
 * botões). O perfil atualiza pela escuta que já existe. Sem o perfil (ainda
 * não criado, ou a leitura que falhou), o aviso com "Tentar de novo", e não o
 * indicador sem fim; a escuta troca pelo formulário se ele nascer depois.
 */
export function EditProfileScreen() {
  useWatchMyProfile();
  const bottomInset = useTabBarInset();
  const online = useIsOnline();
  const identity = useFanIdentity();
  const query = useMyProfileQuery();
  const profile = query.data;
  const withApi = sourceOf('profile') === 'api';
  const problem = profileProblem(query);

  // O aviso anunciado uma vez, quando aparece (buscar de novo não repete).
  useEffect(() => {
    if (problem) AccessibilityInfo.announceForAccessibility(t(problem));
  }, [problem]);

  return (
    <Screen scroll bottomInset={bottomInset}>
      <LargeTitleHeader title={t('editProfile.title')} showBack />
      {profile ? (
        <>
          <SectionLabel style={styles.firstLabel}>{t('editProfile.photo.section')}</SectionLabel>
          <EditPhotoSection
            uid={profile.uid}
            name={identity.name}
            photoURL={profile.photoURL}
            editable={withApi}
            online={online}
          />
          <SectionLabel>{t('editProfile.info.section')}</SectionLabel>
          <EditInfoForm profile={profile} sessionName={identity.name} online={online} />
          <SectionLabel>{t('editProfile.username.section')}</SectionLabel>
          <EditUsernameSection
            username={profile.username}
            changeableAt={profile.usernameChangeableAt ?? null}
            editable={withApi}
            online={online}
          />
        </>
      ) : problem ? (
        <EmptyState
          tone={problem === 'editProfile.loadError' ? 'error' : 'empty'}
          message={t(problem)}
          actionLabel={t('common.retry')}
          onAction={() => void query.refetch()}
          actionLoading={query.isFetching}
          style={styles.loading}
        />
      ) : (
        <ActivityIndicator
          color={colors.textMuted}
          style={styles.loading}
          accessibilityLabel={t('profile.loading')}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // O título já deixa 18 embaixo: a primeira sobrelinha não soma o espaço dela em cima.
  firstLabel: {
    paddingTop: 0,
  },
  field: {
    marginTop: spacing.md,
  },
  save: {
    marginTop: spacing.xl,
  },
  message: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  loading: {
    marginTop: spacing.xl,
  },
});
