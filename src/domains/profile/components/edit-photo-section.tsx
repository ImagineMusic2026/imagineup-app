import { Camera, ImageIcon } from 'lucide-react-native';
import { useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { t, type TranslationKey } from '@/i18n';
import { ApiError } from '@/services/api';
import { haptics } from '@/services/haptics';
import { colors, layout, spacing } from '@/theme';

import { pickPhoto, PhotoPickError, type PhotoSource, type PickedPhoto } from '../photo';
import {
  apiErrorCode,
  isUncertainFailure,
  useChangePhotoMutation,
  useRemovePhotoMutation,
} from '../queries';

/** Status HTTP do teto do dia (`too_many_requests`). */
const TOO_MANY_REQUESTS = 429;

type PhotoMessage = { text: string; action: 'settings' | 'retry' | null };

/** O texto da falha da troca de foto: o motivo que o fã entende, ou o genérico. */
function photoErrorKey(error: unknown): TranslationKey {
  if (error instanceof PhotoPickError) {
    if (error.reason === 'tooBig') return 'editProfile.photo.tooBig';
    if (error.reason === 'noCamera') return 'editProfile.photo.noCamera';
    return 'editProfile.photo.cameraDenied';
  }
  if (apiErrorCode(error) === 'photo_invalid') return 'editProfile.photo.invalid';
  if (error instanceof ApiError && error.status === TOO_MANY_REQUESTS) {
    return 'editProfile.photo.tooMany';
  }
  return 'editProfile.photo.error';
}

export interface EditPhotoSectionProps {
  uid: string | null;
  name: string | null;
  photoURL: string | null;
  /** Com a API: os botões da foto; sem ela (fixtures), só o avatar (24.1, decisão 12). */
  editable: boolean;
  online: boolean;
}

/**
 * A foto da tela "Editar perfil" (bloco 9): o avatar do fã (as iniciais sem
 * foto) e, com a API, "Galeria" e "Câmera" lado a lado e o "Remover foto".
 * Enquanto prepara, envia e grava, um indicador sobre o avatar, os botões
 * desligados e o bloco ocupado para o leitor de tela; sem internet, desligados.
 * Sucesso troca o avatar (o cache do perfil recebe a URL da resposta), anuncia
 * e toca `success`; erro fica embaixo dos botões, anunciado, com o toque
 * `error` (a falha incerta oferece tentar de novo a mesma foto, com a mesma
 * chave; a câmera negada, abrir os ajustes do aparelho).
 */
export function EditPhotoSection({ uid, name, photoURL, editable, online }: EditPhotoSectionProps) {
  const change = useChangePhotoMutation();
  const remove = useRemovePhotoMutation();
  const [message, setMessage] = useState<PhotoMessage | null>(null);
  const [lastPhoto, setLastPhoto] = useState<PickedPhoto | null>(null);
  const busy = change.isPending || remove.isPending;
  const disabled = busy || !online;

  const fail = (error: unknown, action: PhotoMessage['action']): void => {
    const text = t(photoErrorKey(error));
    setMessage({ text, action });
    AccessibilityInfo.announceForAccessibility(text);
    haptics.trigger('error');
  };

  const succeed = (key: TranslationKey): void => {
    setMessage(null);
    AccessibilityInfo.announceForAccessibility(t(key));
    haptics.trigger('success');
  };

  const send = (photo: PickedPhoto): void => {
    setMessage(null);
    setLastPhoto(photo);
    change.mutate(photo, {
      onSuccess: () => {
        setLastPhoto(null);
        succeed('editProfile.photo.updated');
      },
      // "Tentar de novo" só quando o hook guardou a tentativa (o mesmo arquivo e a
      // mesma chave): a recusa do Storage (perfil ausente, sessão trocada) não.
      onError: (error) => fail(error, isUncertainFailure(error) ? 'retry' : null),
    });
  };

  const choose = async (source: PhotoSource): Promise<void> => {
    if (disabled) return;
    setMessage(null);
    try {
      const photo = await pickPhoto(source);
      if (photo) send(photo);
    } catch (error) {
      const denied = error instanceof PhotoPickError && error.reason === 'cameraDenied';
      fail(error, denied ? 'settings' : null);
    }
  };

  const removePhoto = (): void => {
    if (disabled) return;
    setMessage(null);
    remove.mutate(undefined, {
      onSuccess: () => succeed('editProfile.photo.removed'),
      onError: (error) => fail(error, null),
    });
  };

  return (
    <View style={styles.section} testID="edit-profile-photo">
      <View
        accessible={busy}
        accessibilityLabel={busy ? t('editProfile.photo.busy') : undefined}
        accessibilityState={busy ? { busy: true } : undefined}
        style={styles.avatar}
      >
        <Avatar name={name} id={uid ?? 'me'} photoUrl={photoURL} size="hero" />
        {busy ? (
          <View style={styles.spinner} testID="edit-profile-photo-busy">
            <ActivityIndicator color={colors.text} />
          </View>
        ) : null}
      </View>
      {editable ? (
        <>
          <View style={styles.buttons}>
            <Button
              label={t('editProfile.photo.gallery')}
              accessibilityLabel={t('editProfile.photo.galleryLabel')}
              icon={ImageIcon}
              variant="secondary"
              size="sm"
              onPress={() => void choose('library')}
              disabled={disabled}
              testID="edit-profile-gallery"
            />
            <Button
              label={t('editProfile.photo.camera')}
              accessibilityLabel={t('editProfile.photo.cameraLabel')}
              icon={Camera}
              variant="secondary"
              size="sm"
              onPress={() => void choose('camera')}
              disabled={disabled}
              testID="edit-profile-camera"
            />
          </View>
          {photoURL ? (
            <TextLink
              label={t('editProfile.photo.remove')}
              onPress={removePhoto}
              disabled={disabled}
              style={styles.remove}
              testID="edit-profile-remove-photo"
            />
          ) : null}
          {message ? (
            <View style={styles.message}>
              <Text variant="caption" color={colors.danger} style={styles.centered}>
                {message.text}
              </Text>
              {message.action === 'settings' ? (
                <TextLink
                  label={t('editProfile.photo.openSettings')}
                  onPress={() => void Linking.openSettings()}
                  testID="edit-profile-open-settings"
                />
              ) : null}
              {message.action === 'retry' && lastPhoto ? (
                <TextLink
                  label={t('common.retry')}
                  onPress={() => send(lastPhoto)}
                  disabled={disabled}
                  testID="edit-profile-photo-retry"
                />
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    alignItems: 'center',
  },
  avatar: {
    width: layout.avatar.hero.size,
    height: layout.avatar.hero.size,
  },
  spinner: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.avatar.hero.size / 2,
    // O vidro escuro sobre foto: o indicador fica legível sobre qualquer foto.
    backgroundColor: colors.glassDark,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  remove: {
    marginTop: spacing.xs,
  },
  message: {
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  centered: {
    textAlign: 'center',
  },
});
