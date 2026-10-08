import { useIsMutating } from '@tanstack/react-query';
import { Camera, ImageIcon, ImagePlus, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { borderWidths, colors, layout, spacing } from '@/theme';

import { pickPhoto, PhotoPickError, type PhotoSource, type PickedPhoto } from '../photo';
import {
  apiErrorCode,
  isUncertainFailure,
  profileMutationKeys,
  useChangePhotoMutation,
  useRemovePhotoMutation,
} from '../queries';
import { Expandable } from './expandable';

type PhotoMessage = { text: string; action: 'settings' | 'retry' | null };

/** O texto da falha da troca de foto: o motivo que o fã entende, ou o genérico. */
function photoErrorKey(error: unknown): TranslationKey {
  if (error instanceof PhotoPickError) {
    if (error.reason === 'tooBig') return 'editProfile.photo.tooBig';
    if (error.reason === 'noCamera') return 'editProfile.photo.noCamera';
    return 'editProfile.photo.cameraDenied';
  }
  if (apiErrorCode(error) === 'photo_invalid') return 'editProfile.photo.invalid';
  // O teto do dia das vagas e das trocas; o 429 `rate_limited` (pedidos
  // seguidos demais, 27.3) fica com o genérico.
  if (apiErrorCode(error) === 'too_many_requests') return 'editProfile.photo.tooMany';
  return 'editProfile.photo.error';
}

/**
 * - `edit`: com a API, as três opções;
 * - `suspended`: o fã suspenso só tira a foto que já tem (`DELETE /me/photo`, 26.5);
 * - `readOnly`: sem a API, só o avatar, sem toque (24.1, decisão 12).
 */
export type EditPhotoMode = 'edit' | 'suspended' | 'readOnly';

export interface EditPhotoSectionProps {
  uid: string | null;
  name: string | null;
  photoURL: string | null;
  mode: EditPhotoMode;
  online: boolean;
  /**
   * O texto está salvando: a foto fica desligada e a fileira fecha, para o
   * sucesso do ✓ não fechar a tela com uma foto começada no meio.
   */
  locked?: boolean;
  /** A troca de foto deu certo nesta abertura da tela (o "Descartar" avisa que ela já está salva). */
  onPhotoSaved?: () => void;
}

const BADGE_ICON_SIZE = 16;

/**
 * A foto da tela "Editar perfil" (seção 28): o avatar grande com o selo da
 * câmera no canto. Só o avatar com o selo é tocável ("Trocar foto"), e o toque
 * abre embaixo a fileira "Galeria", "Câmera" e "Remover foto" (este só com
 * foto). A fileira e o aviso com os links ("Tentar de novo", "Abrir ajustes")
 * são irmãos do botão, nunca filhos: botão dentro de botão seria um foco a
 * mais para o leitor. O selo é desenho, fora do leitor.
 *
 * A foto salva na hora, fora do ✓: escolher fecha a fileira e roda o fluxo do
 * bloco 9 (a vaga, o envio ao Storage e o `PUT /me/photo`). Enquanto prepara,
 * envia e grava, o próprio botão fica desligado, com o rótulo "Enviando a foto"
 * e ocupado para o leitor, e o indicador sobre o avatar; sem internet, as
 * opções ficam desligadas. Sucesso troca o avatar (o cache do perfil recebe a
 * URL da resposta), anuncia e toca `success`; erro fica embaixo, anunciado,
 * com o toque `error` (a falha incerta oferece tentar de novo a mesma foto,
 * com a mesma chave; a câmera negada, abrir os ajustes do aparelho).
 *
 * O ocupado vem também do `useIsMutating` das duas chaves, como o da tela: a
 * foto de uma abertura anterior (o fã saiu com ela indo e abriu de novo)
 * segue no cache das mutações, e o `isPending` destas instâncias, novas, não
 * a vê. Sem isso, a tela reaberta mostraria o bloco parado e deixaria mandar
 * outra foto em paralelo.
 */
export function EditPhotoSection({
  uid,
  name,
  photoURL,
  mode,
  online,
  locked = false,
  onPhotoSaved,
}: EditPhotoSectionProps) {
  const change = useChangePhotoMutation();
  const remove = useRemovePhotoMutation();
  const pendingPhotos = useIsMutating({ mutationKey: profileMutationKeys.photo });
  const pendingRemovals = useIsMutating({ mutationKey: profileMutationKeys.removePhoto });
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<PhotoMessage | null>(null);
  const [lastPhoto, setLastPhoto] = useState<PickedPhoto | null>(null);
  const busy = change.isPending || remove.isPending || pendingPhotos + pendingRemovals > 0;
  const disabled = busy || locked || !online;
  const canPick = mode === 'edit';
  // O suspenso sem foto não tem o que fazer aqui; sem a API, nada é tocável.
  const pressable = canPick || (mode === 'suspended' && !!photoURL);

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
        onPhotoSaved?.();
        succeed('editProfile.photo.updated');
      },
      // "Tentar de novo" só quando o hook guardou a tentativa (o mesmo arquivo e a
      // mesma chave): a recusa do Storage (perfil ausente, sessão trocada) não.
      onError: (error) => fail(error, isUncertainFailure(error) ? 'retry' : null),
    });
  };

  const choose = async (source: PhotoSource): Promise<void> => {
    if (disabled) return;
    setOpen(false);
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
    setOpen(false);
    setMessage(null);
    remove.mutate(undefined, {
      onSuccess: () => succeed('editProfile.photo.removed'),
      onError: (error) => fail(error, null),
    });
  };

  const art = (
    <>
      <Avatar name={name} id={uid ?? 'me'} photoUrl={photoURL} size="profile" />
      {busy ? (
        <View style={styles.spinner} testID="edit-profile-photo-busy">
          <ActivityIndicator color={colors.text} />
        </View>
      ) : null}
      {pressable ? (
        // Dentro da área do avatar: no Fabric do iOS o toque fora do pai não chega.
        <View style={styles.badge}>
          <Icon icon={ImagePlus} size={BADGE_ICON_SIZE} strokeWidth={2.2} />
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.section} testID="edit-profile-photo">
      {pressable ? (
        <PressableScale
          onPress={() => setOpen((value) => !value)}
          disabled={busy || locked}
          accessibilityLabel={t(busy ? 'editProfile.photo.busy' : 'editProfile.photo.change')}
          accessibilityHint={busy || locked ? undefined : t('editProfile.photo.changeHint')}
          accessibilityState={
            busy
              ? { busy: true, disabled: true }
              : locked
                ? { disabled: true }
                : { expanded: open }
          }
          style={styles.avatar}
          testID="edit-profile-photo-button"
        >
          {art}
        </PressableScale>
      ) : (
        <View style={styles.avatar}>{art}</View>
      )}
      {pressable ? (
        <Expandable open={open && !busy && !locked} testID="edit-profile-photo-options">
          <View style={styles.options}>
            {canPick ? (
              <>
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
              </>
            ) : null}
            {photoURL ? (
              <Button
                label={t('editProfile.photo.remove')}
                icon={Trash2}
                variant="secondary"
                size="sm"
                onPress={removePhoto}
                disabled={disabled}
                testID="edit-profile-remove-photo"
              />
            ) : null}
          </View>
        </Expandable>
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
    </View>
  );
}

const AVATAR = layout.avatar.profile.size;

const styles = StyleSheet.create({
  section: {
    alignItems: 'center',
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
  },
  spinner: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: AVATAR / 2,
    // O vidro escuro sobre foto: o indicador fica legível sobre qualquer foto.
    backgroundColor: colors.glassDark,
  },
  // O selo encosta no canto de baixo da foto, por dentro do quadrado do avatar.
  badge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: layout.photoBadge,
    height: layout.photoBadge,
    borderRadius: layout.photoBadge / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassDarkStrong,
    borderWidth: borderWidths.default,
    borderColor: colors.borderGlassStrong,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
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
