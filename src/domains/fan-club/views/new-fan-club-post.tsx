import { zodResolver } from '@hookform/resolvers/zod';
import { useIsMutating } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ImagePlus } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { AccessibilityInfo, ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { goBack, LargeTitleHeader } from '@/components/header';
import { RemoteImage } from '@/components/remote-image';
import { Screen } from '@/components/screen';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import {
  PhotoPickError,
  pickPhoto,
  prepareFanClubPhoto,
  SuspensionContact,
  type PreparedFanClubPhoto,
} from '@/domains/profile';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey, type TranslationParams } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, radii, spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import { FanClubNotice } from '../components/fan-club-notice';
import { UnofficialBand } from '../components/unofficial-band';
import { FAN_CLUB_PENDING_MAX, FAN_CLUB_POST_TEXT_MAX } from '../consts';
import { fanClubErrorText } from '../describe';
import { fanClubStageOf } from '../entry';
import { fanClubMutationKeys, useCreateFanClubPostMutation, useShownFanClub } from '../queries';
import { postSchema, type PostFormInput } from '../schemas';
import type { MyFanClubClub } from '../types';

const PHOTO_ASPECT = 4 / 5;
const SKELETON_HEIGHT = 160;

/** A recusa que fica no pé, acima do botão. */
type Failure = { key: TranslationKey; params?: TranslationParams; contact?: boolean };

/** Volta ao "Meu fã-clube"; aberta a frio, troca por ele. */
function leave(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/meu-fa-clube');
}

interface NewPostFormProps {
  club: MyFanClubClub;
  /** A recusa do pé, guardada na tela: a recusa que tira o fã-clube do ar tira o formulário. */
  failure: Failure | null;
  onFailure: (failure: Failure | null) => void;
}

function NewPostForm({ club, failure, onFailure: setFailure }: NewPostFormProps) {
  const online = useIsOnline();
  const create = useCreateFanClubPostMutation();
  const [photo, setPhoto] = useState<PreparedFanClubPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<TranslationKey | null>(null);
  useStayOnScreen(create.isPending || preparing);

  /** A recusa no pé, anunciada. */
  const fail = (next: Failure): void => {
    setFailure(next);
    AccessibilityInfo.announceForAccessibility(t(next.key, next.params));
  };

  const { control, handleSubmit, setError } = useForm<PostFormInput>({
    resolver: zodResolver(postSchema),
    defaultValues: { text: '' },
  });
  const text = useWatch({ control, name: 'text' });
  const full = club.pendingPosts >= FAN_CLUB_PENDING_MAX;
  const blocked = full || club.rulesOutdated;

  // A galeria sem o recorte do sistema e o preparo em 4:5 na hora da escolha:
  // a prévia mostra o recorte que vai, e a foto grande demais aparece já aqui.
  const choose = async (): Promise<void> => {
    setPhotoError(null);
    try {
      const picked = await pickPhoto('library', 'none');
      if (!picked) return;
      setPreparing(true);
      setPhoto(await prepareFanClubPhoto(picked));
    } catch (error) {
      const key: TranslationKey =
        error instanceof PhotoPickError && error.reason === 'tooBig'
          ? 'fanClub.newPost.photoTooBig'
          : 'fanClub.newPost.photoError';
      setPhotoError(key);
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t(key));
    } finally {
      setPreparing(false);
    }
  };

  // O envio inválido (só espaços) anuncia o erro do campo, como os outros formulários.
  const submit = handleSubmit(
    (form) => {
      setFailure(null);
      setPhotoError(null);
      create.mutate(
        { text: form.text, photo: club.photosAllowed ? photo : null },
        {
          onSuccess: () => {
            haptics.trigger('success');
            AccessibilityInfo.announceForAccessibility(t('fanClub.newPost.sent'));
            leave();
          },
          onError: (error) => {
            haptics.trigger('error');
            const known = fanClubErrorText(error);
            if (known?.field === 'text') {
              setError('text', { message: t(known.key) }, { shouldFocus: true });
              AccessibilityInfo.announceForAccessibility(t(known.key));
              return;
            }
            if (known?.field === 'photo') {
              setPhotoError(known.key);
              AccessibilityInfo.announceForAccessibility(t(known.key));
              return;
            }
            if (known) {
              fail({ key: known.key, params: known.params });
              return;
            }
            const action = create.failedStep() === 'post' ? 'clubPost' : 'clubUpload';
            const refusal = actionRefusal(error, action);
            fail({ key: refusal.key, contact: refusal.type === 'suspended' });
          },
        },
      );
    },
    (errors) => announceFirstError(errors, ['text']),
  );

  return (
    <View>
      <UnofficialBand />
      <Text variant="bodyLead" color={colors.textSecondary} style={styles.lead}>
        {t('fanClub.newPost.lead')}
      </Text>
      {full ? (
        <FanClubNotice
          tone="warning"
          body={t('fanClub.errors.refused.tooManyPending')}
          style={styles.notice}
        />
      ) : null}
      {club.rulesOutdated ? (
        <FanClubNotice
          tone="warning"
          body={t('fanClub.errors.refused.rulesOutdated')}
          style={styles.notice}
        />
      ) : null}
      <Controller
        control={control}
        name="text"
        render={({ field: { ref, value, onChange, onBlur }, fieldState }) => (
          <TextInput
            ref={ref}
            label={t('fanClub.newPost.text')}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder={t('fanClub.newPost.textPlaceholder')}
            error={fieldState.error?.message}
            multiline
            maxLength={FAN_CLUB_POST_TEXT_MAX}
            editable={!create.isPending}
            accessibilityStatus={t('fanClub.apply.counterLabel', {
              count: text.length,
              max: FAN_CLUB_POST_TEXT_MAX,
            })}
            footer={
              <Text
                variant="caption"
                color={text.length >= FAN_CLUB_POST_TEXT_MAX ? colors.danger : colors.textMuted}
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={styles.counter}
              >
                {t('fanClub.apply.counter', { count: text.length, max: FAN_CLUB_POST_TEXT_MAX })}
              </Text>
            }
            testID="fan-club-post-text"
          />
        )}
      />

      {club.photosAllowed ? (
        <View style={styles.photoBlock}>
          {photo ? (
            <>
              <RemoteImage
                uri={photo.photo.uri}
                fallback={{ kind: 'surface', seed: photo.photo.uri }}
                accessibilityLabel={t('fanClub.newPost.photoLabel')}
                style={styles.preview}
                testID="fan-club-post-preview"
              />
              <View style={styles.photoActions}>
                <Button
                  label={t('fanClub.newPost.changePhoto')}
                  variant="secondary"
                  size="md"
                  onPress={() => void choose()}
                  disabled={create.isPending || preparing}
                  accessibilityHint={t('fanClub.newPost.pickHint')}
                  testID="fan-club-post-change-photo"
                />
                <Button
                  label={t('fanClub.newPost.removePhoto')}
                  variant="ghost"
                  size="md"
                  onPress={() => setPhoto(null)}
                  disabled={create.isPending || preparing}
                  testID="fan-club-post-remove-photo"
                />
              </View>
            </>
          ) : (
            <Button
              label={t('fanClub.newPost.pickPhoto')}
              variant="secondary"
              icon={ImagePlus}
              onPress={() => void choose()}
              loading={preparing}
              disabled={create.isPending || preparing}
              accessibilityHint={t('fanClub.newPost.pickHint')}
              testID="fan-club-post-pick-photo"
            />
          )}
          {preparing ? (
            <View
              accessible
              accessibilityLabel={t('fanClub.newPost.preparing')}
              style={styles.preparing}
            >
              <ActivityIndicator color={colors.textMuted} />
              <Text variant="caption" color={colors.textMuted}>
                {t('fanClub.newPost.preparing')}
              </Text>
            </View>
          ) : null}
          {photoError ? (
            <Text variant="caption" color={colors.danger} testID="fan-club-post-photo-error">
              {t(photoError)}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text variant="caption" color={colors.textMuted} style={styles.textOnly}>
          {t('fanClub.newPost.textOnly')}
        </Text>
      )}

      <View style={styles.footer}>
        {failure ? (
          <View testID="fan-club-post-error">
            <Text variant="caption" color={colors.danger} style={styles.error}>
              {t(failure.key, failure.params)}
            </Text>
            {failure.contact ? <SuspensionContact align="center" /> : null}
          </View>
        ) : null}
        <Button
          label={t(online ? 'fanClub.newPost.submit' : 'fanClub.apply.submitOffline')}
          onPress={() => void submit()}
          loading={create.isPending}
          disabled={!online || create.isPending || preparing || blocked}
          haptic="confirm"
          testID="fan-club-post-submit"
        />
      </View>
    </View>
  );
}

/**
 * Nova publicação (`/meu-fa-clube/nova-publicacao`, 34.9, item 6), na pilha
 * raiz, por causa do teclado: o texto de 1 a 1.000 e, só com o
 * `photosAllowed`, "Escolher foto da galeria" (o seletor do sistema, sem
 * permissão e sem o recorte dele), com a prévia do recorte 4:5 que o
 * `prepareFanClubPhoto` faz (a foto em 1080 × 1350 e a miniatura em 480 × 600,
 * em JPEG, sem EXIF). O envio é a vaga, os dois arquivos e o `POST`, com a
 * tentativa guardada, e confirma com "Enviado para revisão". Só abre com o
 * fã-clube no ar para o gestor; senão (e antes da abertura do programa), diz
 * que não dá e não chama mais nada.
 */
export function NewFanClubPostScreen() {
  const insets = useSafeAreaInsets();
  const { query, mine } = useShownFanClub();
  const sending = useIsMutating({ mutationKey: fanClubMutationKeys.post }) > 0;
  const [failure, setFailure] = useState<Failure | null>(null);
  const stage = mine ? fanClubStageOf(mine) : null;
  const club = stage?.kind === 'club' && stage.club.available ? stage.club : null;

  let body;
  if (club) {
    body = <NewPostForm club={club} failure={failure} onFailure={setFailure} />;
  } else if (mine && failure) {
    // A recusa que tirou o fã-clube do ar para o gestor (pausado, fora da
    // central, o artista fechado) tira o formulário: a frase dela fica.
    body = (
      <View testID="fan-club-post-unavailable">
        <EmptyState
          message={t(failure.key, failure.params)}
          actionLabel={t('common.back')}
          onAction={leave}
        />
      </View>
    );
  } else if (!mine && query.isPending) {
    body = (
      <SkeletonGroup>
        <Skeleton height={SKELETON_HEIGHT} tone="surface" />
      </SkeletonGroup>
    );
  } else {
    body = (
      <View testID="fan-club-post-unavailable">
        <EmptyState
          message={t(mine ? 'fanClub.newPost.unavailable' : 'fanClub.notAvailable')}
          actionLabel={t('common.back')}
          onAction={mine ? leave : goBack}
        />
      </View>
    );
  }

  return (
    <Screen scroll bottomInset={insets.bottom}>
      <LargeTitleHeader title={t('fanClub.newPost.title')} showBack backDisabled={sending} />
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  notice: {
    marginBottom: spacing.lg,
  },
  counter: {
    alignSelf: 'flex-end',
    marginTop: spacing.xs,
  },
  photoBlock: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  preview: {
    width: '100%',
    aspectRatio: PHOTO_ASPECT,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  photoActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  preparing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  textOnly: {
    marginTop: spacing.md,
  },
  footer: {
    marginTop: spacing.sectionTop,
    gap: spacing.listGap,
  },
  error: {
    textAlign: 'center',
  },
});
