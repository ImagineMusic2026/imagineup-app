import { zodResolver } from '@hookform/resolvers/zod';
import { useIsMutating } from '@tanstack/react-query';
import { Check, CircleCheck, CircleX, Lock, MapPin, User } from 'lucide-react-native';
import { useEffect, useRef, useState, type Ref } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  StyleSheet,
  View,
  type TextInput as NativeTextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { BackHeader, goBack, HeaderIconButton } from '@/components/header';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { Pill } from '@/components/pill';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { TextLink } from '@/components/text-link';
import { sourceOf } from '@/config/data-source';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useIsOnline } from '@/hooks/use-is-online';
import { useNow } from '@/hooks/use-now';
import { useStayOnScreen, type StayOnScreenMode } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { formatLongDate } from '@/utils/date';
import { announceFirstError } from '@/utils/form-errors';

import { EditPhotoSection } from '../components/edit-photo-section';
import { FormGroup } from '../components/form-group';
import { GenderField } from '../components/gender-field';
import { ProfileReadOnly, SOCIAL_PREFIX } from '../components/profile-read-only';
import { BIO_MAX, SOCIAL_INPUT_MAX, SOCIAL_NETWORKS, normalizeSocialHandle } from '../details';
import { useFanIdentity } from '../hooks/use-fan-identity';
import {
  USERNAME_ERROR_STATUSES,
  USERNAME_STATUS_TEXT,
  useUsernameCheck,
} from '../hooks/use-username-check';
import {
  apiErrorCode,
  apiErrorDetail,
  isUncertainFailure,
  profileMutationKeys,
  refusedUsernameStatus,
  useMyProfileQuery,
  useUpdateProfileMutation,
  useWatchMyProfile,
} from '../queries';
import {
  changesOf,
  EDIT_PROFILE_FIELD_ORDER,
  editProfileSchema,
  formValuesOf,
  hasChanges,
  SERVER_FIELD_TO_FORM,
  SOCIAL_LABEL_KEYS,
  type EditProfileField,
  type EditProfileForm,
  type EditProfileFormInput,
  type TouchedFields,
} from '../schemas';
import type { FanProfile, ProfileChanges, SocialNetwork } from '../types';
import { isAutomaticUsername, normalizeUsername } from '../username';

const ICON_SIZE = 18;
const STATUS_ICON_SIZE = 18;

/** Todos os campos do formulário, para acompanhar o perfil vivo. */
const ALL_FIELDS: readonly EditProfileField[] = [...EDIT_PROFILE_FIELD_ORDER, 'privateAccount'];

/** O aviso embaixo do header: a falha do ✓, o suspenso, o só leitura. */
type Notice = { text: string; tone: 'error' | 'info' };

/** A falha do ✓ que fica embaixo do header; a incerta some quando a escuta mostra o perfil salvo. */
type SaveMessage = { key: TranslationKey; uncertain: boolean };

interface HeaderProps {
  onClose?: () => void;
  closeDisabled?: boolean;
  save?: { onPress: () => void; disabled: boolean; busy: boolean };
  notice?: Notice | null;
}

/**
 * O header fixo: o X ("Fechar"), "Editar perfil" como cabeçalho e o ✓
 * ("Salvar"), com o aviso da tela logo embaixo, fora da rolagem.
 */
function EditProfileHeader({ onClose, closeDisabled = false, save, notice }: HeaderProps) {
  return (
    <View>
      <BackHeader
        leading="close"
        title={t('editProfile.title')}
        onBack={onClose}
        backDisabled={closeDisabled}
        right={
          save ? (
            <HeaderIconButton
              icon={Check}
              onPress={save.onPress}
              disabled={save.disabled}
              busy={save.busy}
              haptic="confirm"
              accessibilityLabel={t(save.busy ? 'editProfile.saving' : 'editProfile.save')}
              testID="edit-profile-save"
            />
          ) : undefined
        }
      />
      {notice ? (
        <Text
          variant="caption"
          color={notice.tone === 'error' ? colors.danger : colors.textSecondary}
          style={styles.notice}
          testID="edit-profile-message"
        >
          {notice.text}
        </Text>
      ) : null}
    </View>
  );
}

interface BioInputProps {
  inputRef: Ref<NativeTextInput>;
  value: string;
  onChangeText: (text: string) => void;
  onBlur: () => void;
  error?: string;
  editable: boolean;
}

/**
 * A bio: várias linhas, até 200, com o contador "12/200" embaixo da caixa,
 * sempre à vista e fora do leitor (que ouve "12 de 200 caracteres" pela dica
 * do campo). No limite, o `maxLength` descarta o resto em silêncio: o leitor
 * ouve uma vez que chegou nele, como no comentário. Só o que o fã digita até
 * o limite anuncia: a bio que já chega cheia (a salva, a da escuta, a do
 * suspenso) não, porque nada foi descartado.
 */
function BioInput({ inputRef, value, onChangeText, onBlur, error, editable }: BioInputProps) {
  const count = value.length;
  const full = count >= BIO_MAX;
  const [typedToLimit, setTypedToLimit] = useState(false);
  useAnnounceWhen(full && typedToLimit, t('editProfile.basic.bioLimit', { max: BIO_MAX }));
  return (
    <TextInput
      ref={inputRef}
      variant="bare"
      label={t('editProfile.basic.bio')}
      labelHidden
      placeholder={t('editProfile.basic.bioPlaceholder')}
      value={value}
      onChangeText={(text) => {
        setTypedToLimit(text.length >= BIO_MAX);
        onChangeText(text);
      }}
      onBlur={onBlur}
      error={error}
      editable={editable}
      multiline
      maxLength={BIO_MAX}
      accessibilityStatus={t('editProfile.basic.bioCounterLabel', { count, max: BIO_MAX })}
      footer={
        <Text
          variant="caption"
          color={full ? colors.danger : colors.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={styles.counter}
          testID="edit-profile-bio-counter"
        >
          {t('editProfile.basic.bioCounter', { count, max: BIO_MAX })}
        </Text>
      }
      testID="edit-profile-bio"
    />
  );
}

interface ProfileFormProps {
  profile: FanProfile;
  /** O nome da sessão, para o perfil que nasceu sem nome. */
  fallbackName: string | null;
  online: boolean;
}

/**
 * O formulário da tela, com a API (seção 28): um ✓ só salva nome, @, bio,
 * cidade, gênero, conta privada e redes num `PUT /me/profile`; a foto salva na
 * hora, fora dele.
 *
 * - O corpo leva os campos que o fã mexeu cujo valor limpo difere do perfil
 *   de agora (`changesOf`), mais o nome no perfil sem nome; quando a escuta
 *   traz um perfil novo, cada campo não mexido recebe o valor novo.
 * - O ✓ fica apagado sem mudança, sem internet, com o @ mexido que ainda não
 *   está "Disponível", enquanto salva, enquanto a foto vai e para o suspenso.
 * - Enquanto salva, a tela fica presa (o X desliga, o voltar e o gesto não
 *   saem, e a foto não abre), por no máximo 20 s: o resultado chega com a
 *   tela montada. Sucesso anuncia, toca `success` e sai pelo `goBack` (aberta
 *   a frio, vai ao início). Como a foto fica presa enquanto o texto salva e o
 *   ✓ fica apagado enquanto a foto vai, o sucesso nunca fecha a tela com a
 *   foto indo.
 * - Com mudança (o @ mexido que ainda não está "Disponível" inclusive) ou com
 *   a foto indo, o X, o voltar do Android e o gesto do iOS (desligado)
 *   perguntam antes de sair.
 */
function ProfileForm({ profile, fallbackName, online }: ProfileFormProps) {
  const insets = useSafeAreaInsets();
  const now = useNow();
  const update = useUpdateProfileMutation();
  const pendingSaves = useIsMutating({ mutationKey: profileMutationKeys.update });
  const pendingPhotos = useIsMutating({ mutationKey: profileMutationKeys.photo });
  const pendingRemovals = useIsMutating({ mutationKey: profileMutationKeys.removePhoto });
  const saving = update.isPending || pendingSaves > 0;
  const photoBusy = pendingPhotos + pendingRemovals > 0;
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const [tooSoon, setTooSoon] = useState(false);
  const [refusedSuspended, setRefusedSuspended] = useState(false);
  const [photoSaved, setPhotoSaved] = useState(false);
  const suspended = Boolean(profile.suspendedAt) || refusedSuspended;
  const editable = !saving && !suspended;

  const defaults = formValuesOf(profile, fallbackName);
  const {
    control,
    formState,
    getFieldState,
    getValues,
    handleSubmit,
    resetField,
    setError,
    setFocus,
    setValue,
    trigger,
  } = useForm<EditProfileFormInput, unknown, EditProfileForm>({
    resolver: zodResolver(editProfileSchema),
    defaultValues: defaults,
  });
  const values = useWatch({ control }) as EditProfileFormInput;
  const touched: TouchedFields = formState.dirtyFields;
  const isDirty = formState.isDirty;

  // O perfil vivo: o campo que o fã não mexeu recebe o valor novo (a bio que a
  // Moderação apagou, o @ que ela trocou, o que outro aparelho salvou). O
  // mexido fica com o rascunho, mas passa a ser comparado com o valor novo:
  // com o padrão da abertura, voltar ao texto de antes o daria por não mexido,
  // fora do corpo do ✓ e do diálogo, com a tela mostrando o que o servidor não
  // tem mais.
  const applied = useRef(defaults);
  useEffect(() => {
    const previous = applied.current;
    applied.current = defaults;
    for (const field of ALL_FIELDS) {
      const live = defaults[field];
      if (Object.is(live, previous[field])) continue;
      if (!getFieldState(field).isDirty) {
        resetField(field, { defaultValue: live });
        continue;
      }
      const draft = getValues(field);
      resetField(field, { defaultValue: live, keepError: true, keepTouched: true });
      setValue(field, draft, { shouldDirty: true });
    }
  });

  // O @: o prazo de 30 dias pelo perfil e pelo relógio do aparelho, ou pela
  // recusa do servidor (o relógio do aparelho adiantado).
  const changeableAt = profile.usernameChangeableAt ?? null;
  const lockedUntil =
    changeableAt && Date.parse(changeableAt) > now.getTime() ? changeableAt : null;
  const usernameLocked = Boolean(lockedUntil) || tooSoon;
  const currentUsername = profile.username ?? '';
  const automatic = isAutomaticUsername(currentUsername);
  const check = useUsernameCheck({
    draft: values.username ?? '',
    current: currentUsername,
    enabled: !usernameLocked && !suspended,
  });

  // O prazo que começa com a tela aberta (pela escuta, quando outro aparelho
  // trocou o @, ou pela recusa do servidor) volta o campo ao @ de agora: só
  // leitura, ele mostraria um rascunho que o fã não consegue apagar.
  const wasLocked = useRef(usernameLocked);
  useEffect(() => {
    const was = wasLocked.current;
    wasLocked.current = usernameLocked;
    if (usernameLocked && !was) resetField('username', { defaultValue: currentUsername });
  });

  const changes = changesOf(values, touched, profile, { sendUsername: check.sendable });
  const pending = hasChanges(changes);
  const canSave = pending && !check.blocking && online && !saving && !photoBusy && !suspended;
  // O @ mexido que ainda não vai no corpo (conferindo, sem conferência,
  // indisponível) também pergunta: sair fecharia sem aviso o que o fã digitou.
  const leaveAsks = isDirty && (pending || (Boolean(touched.username) && check.changed));

  const lockedText = (date: string | null): string =>
    date
      ? t('editProfile.username.lockedUntil', { date: formatLongDate(date) })
      : t('editProfile.username.tooSoon');
  const usernameLine: { text: string; error: boolean } = lockedUntil
    ? { text: lockedText(lockedUntil), error: false }
    : tooSoon
      ? { text: lockedText(changeableAt), error: false }
      : check.changed && check.status && check.status !== 'current'
        ? {
            text: t(USERNAME_STATUS_TEXT[check.status]),
            error: USERNAME_ERROR_STATUSES.has(check.status),
          }
        : {
            text: t(automatic ? 'editProfile.username.automaticHint' : 'editProfile.username.rule'),
            error: false,
          };
  const usernameIcon =
    check.changed && check.status === 'available' ? (
      <Icon icon={CircleCheck} size={STATUS_ICON_SIZE} color={colors.text} />
    ) : check.changed &&
      (check.status === 'taken' || check.status === 'reserved' || check.status === 'invalid') ? (
      <Icon icon={CircleX} size={STATUS_ICON_SIZE} color={colors.danger} />
    ) : !check.changed && automatic ? (
      <Pill
        label={t('editProfile.username.automatic')}
        tone="accentStrong"
        size="xs"
        testID="edit-profile-username-automatic"
      />
    ) : null;

  const notice: Notice | null = suspended
    ? { text: t('editProfile.info.suspended'), tone: 'info' }
    : message && (pending || !message.uncertain)
      ? { text: t(message.key), tone: 'error' }
      : null;

  const askLeave = (): void => {
    if (saving) return;
    if (photoBusy) {
      Alert.alert(
        t('editProfile.leavePhoto.title'),
        t(
          leaveAsks
            ? 'editProfile.leavePhoto.messageWithChanges'
            : 'editProfile.leavePhoto.message',
        ),
        [
          { text: t('editProfile.discard.keep'), style: 'cancel' },
          { text: t('editProfile.leavePhoto.confirm'), style: 'destructive', onPress: goBack },
        ],
      );
      return;
    }
    if (leaveAsks) {
      Alert.alert(
        t('editProfile.discard.title'),
        t(photoSaved ? 'editProfile.discard.messagePhoto' : 'editProfile.discard.message'),
        [
          { text: t('editProfile.discard.keep'), style: 'cancel' },
          { text: t('editProfile.discard.confirm'), style: 'destructive', onPress: goBack },
        ],
      );
      return;
    }
    goBack();
  };

  const stayMode: StayOnScreenMode = saving
    ? 'locked'
    : photoBusy || leaveAsks
      ? 'confirm'
      : 'free';
  useStayOnScreen(stayMode, askLeave);

  const failWith = (text: string): void => {
    AccessibilityInfo.announceForAccessibility(text);
    haptics.trigger('error');
  };

  /** A recusa do ✓: nada foi gravado, e os campos ficam com o rascunho. */
  const refuse = (error: unknown, body: ProfileChanges): void => {
    const code = apiErrorCode(error);
    const refused = refusedUsernameStatus(error);
    if (refused && body.username !== undefined) {
      // O hook pôs a recusa no retrato da disponibilidade: a linha do @ a mostra.
      check.markAnnounced(body.username, refused);
      failWith(t(USERNAME_STATUS_TEXT[refused]));
      return;
    }
    if (code === 'username_change_too_soon') {
      // O efeito do prazo volta o campo ao @ de agora.
      setTooSoon(true);
      failWith(lockedText(changeableAt));
      return;
    }
    if (code === 'profile_invalid') {
      const field = SERVER_FIELD_TO_FORM[apiErrorDetail(error, 'field') ?? ''];
      // O gênero não tem texto de erro na linha: o aviso fica embaixo do header.
      if (field === 'gender') {
        setMessage({ key: 'editProfile.fieldInvalid', uncertain: false });
        failWith(t('editProfile.fieldInvalid'));
        return;
      }
      if (field) {
        setError(
          field,
          { type: 'server', message: t('editProfile.fieldInvalid') },
          { shouldFocus: true },
        );
        failWith(t('editProfile.fieldInvalid'));
        return;
      }
    }
    if (code === 'too_many_requests' && apiErrorDetail(error, 'action') === 'name') {
      setError(
        'name',
        { type: 'server', message: t('editProfile.tooManyNames') },
        { shouldFocus: true },
      );
      failWith(t('editProfile.tooManyNames'));
      return;
    }
    if (code === 'account_suspended') {
      // A escuta traz o `suspendedAt`; até lá, a tela já fica a do suspenso.
      setRefusedSuspended(true);
      failWith(t('editProfile.info.suspended'));
      return;
    }
    const next: SaveMessage =
      code === 'too_many_requests' && apiErrorDetail(error, 'action') === 'profile'
        ? { key: 'editProfile.tooManySaves', uncertain: false }
        : isUncertainFailure(error)
          ? { key: 'editProfile.uncertain', uncertain: true }
          : { key: 'editProfile.error', uncertain: false };
    setMessage(next);
    failWith(t(next.key));
  };

  const submit = (): void => {
    if (!canSave) return;
    void handleSubmit(
      () => {
        const body = changesOf(getValues(), formState.dirtyFields, profile, {
          sendUsername: check.sendable,
        });
        if (!hasChanges(body)) return;
        setMessage(null);
        update.mutate(body, {
          onSuccess: (edited) => {
            const text =
              body.username !== undefined && edited.username
                ? t('editProfile.savedWithUsername', { username: edited.username })
                : t('editProfile.saved');
            AccessibilityInfo.announceForAccessibility(text);
            haptics.trigger('success');
            goBack();
          },
          onError: (error) => refuse(error, body),
        });
      },
      (errors) => announceFirstError(errors, EDIT_PROFILE_FIELD_ORDER),
    )();
  };

  /** Ao sair do campo, o link colado vira o usuário; o que não passa vira o erro do campo. */
  const settleSocial = (network: SocialNetwork): void => {
    const raw = getValues(network);
    const result = normalizeSocialHandle(network, raw);
    if (!result.ok) {
      void trigger(network);
      return;
    }
    const handle = result.handle ?? '';
    if (handle !== raw) setValue(network, handle, { shouldDirty: true, shouldValidate: true });
    // O erro de antes sai quando o fã corrige o campo.
    else if (getFieldState(network).error) void trigger(network);
  };

  return (
    <Screen
      scroll
      bottomInset={insets.bottom}
      header={
        <EditProfileHeader
          onClose={askLeave}
          closeDisabled={saving}
          save={{ onPress: submit, disabled: !canSave, busy: saving }}
          notice={notice}
        />
      }
    >
      <View style={styles.photo}>
        <EditPhotoSection
          uid={profile.uid}
          name={values.name || fallbackName}
          photoURL={profile.photoURL}
          mode={suspended ? 'suspended' : 'edit'}
          online={online}
          locked={saving}
          onPhotoSaved={() => setPhotoSaved(true)}
        />
      </View>

      <SectionLabel style={styles.firstLabel}>{t('editProfile.basic.section')}</SectionLabel>
      <FormGroup testID="edit-profile-basic">
        <Controller
          control={control}
          name="name"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <TextInput
              ref={ref}
              variant="bare"
              label={t('editProfile.basic.name')}
              labelHidden
              placeholder={t('editProfile.basic.namePlaceholder')}
              leadingIcon={User}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={formState.errors.name?.message}
              editable={editable}
              autoComplete="name"
              textContentType="name"
              autoCapitalize="words"
              returnKeyType="next"
              onSubmitEditing={() => setFocus('username')}
              testID="edit-profile-name"
            />
          )}
        />
        <Controller
          control={control}
          name="username"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <TextInput
              ref={ref}
              variant="bare"
              label={t('editProfile.basic.username')}
              labelHidden
              placeholder={t('editProfile.basic.usernamePlaceholder')}
              prefix="@"
              value={value}
              onChangeText={(text) => onChange(normalizeUsername(text))}
              onBlur={onBlur}
              invalid={usernameLine.error}
              accessibilityStatus={usernameLine.text}
              editable={editable && !usernameLocked}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              keyboardType="ascii-capable"
              maxLength={64}
              returnKeyType="next"
              onSubmitEditing={() => setFocus('bio')}
              trailing={
                usernameIcon ? (
                  <View
                    pointerEvents="none"
                    accessible={false}
                    importantForAccessibility="no-hide-descendants"
                    accessibilityElementsHidden
                    style={styles.status}
                    testID="edit-profile-username-icon"
                  >
                    {usernameIcon}
                  </View>
                ) : undefined
              }
              testID="edit-profile-username-input"
            />
          )}
        />
        <Controller
          control={control}
          name="bio"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <BioInput
              inputRef={ref}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={formState.errors.bio?.message}
              editable={editable}
            />
          )}
        />
      </FormGroup>
      {/* O mesmo texto chega pelo campo do @, na dica: aqui fica fora do leitor. */}
      <View style={styles.usernameLine}>
        <Text
          variant="caption"
          color={usernameLine.error ? colors.danger : colors.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.usernameText}
          testID="edit-profile-username-status"
        >
          {usernameLine.text}
        </Text>
        {check.changed && check.status === 'unchecked' ? (
          <TextLink
            label={t('common.retry')}
            accessibilityLabel={t('editProfile.username.recheck')}
            onPress={check.recheck}
            disabled={!online}
            testID="edit-profile-username-recheck"
          />
        ) : null}
      </View>

      <SectionLabel>{t('editProfile.details.section')}</SectionLabel>
      <FormGroup testID="edit-profile-details">
        <Controller
          control={control}
          name="city"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <TextInput
              ref={ref}
              variant="bare"
              label={t('editProfile.details.city')}
              labelHidden
              placeholder={t('editProfile.details.cityPlaceholder')}
              leadingIcon={MapPin}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={formState.errors.city?.message}
              editable={editable}
              autoComplete="postal-address-locality"
              textContentType="addressCity"
              autoCapitalize="words"
              returnKeyType="done"
              testID="edit-profile-city"
            />
          )}
        />
        <Controller
          control={control}
          name="gender"
          render={({ field: { onChange, value } }) => (
            <GenderField
              value={value}
              onChange={(gender) => {
                if (editable) onChange(gender);
              }}
              readOnly={suspended}
            />
          )}
        />
        {/* Pelo Controller, como o gênero: campo não registrado não acompanha
            o perfil vivo (o `resetField` sai sem fazer nada). */}
        <Controller
          control={control}
          name="privateAccount"
          render={({ field: { onChange, value } }) => (
            <PrivateAccountRow
              value={value}
              readOnly={suspended}
              onToggle={() => {
                if (editable) onChange(!value);
              }}
            />
          )}
        />
      </FormGroup>

      <SectionLabel>{t('editProfile.socials.section')}</SectionLabel>
      <FormGroup testID="edit-profile-socials">
        {SOCIAL_NETWORKS.map((network, index) => (
          <Controller
            key={network}
            control={control}
            name={network}
            render={({ field: { ref, onChange, onBlur, value } }) => (
              <TextInput
                ref={ref}
                variant="bare"
                label={t(SOCIAL_LABEL_KEYS[network])}
                labelHidden
                placeholder={t(
                  network === 'linkedin'
                    ? 'editProfile.socials.linkedinPlaceholder'
                    : 'editProfile.socials.placeholder',
                )}
                leadingGlyph={network}
                prefix={SOCIAL_PREFIX[network]}
                value={value}
                onChangeText={onChange}
                onBlur={() => {
                  onBlur();
                  settleSocial(network);
                }}
                error={formState.errors[network]?.message}
                editable={editable}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                keyboardType={network === 'linkedin' ? 'default' : 'url'}
                maxLength={SOCIAL_INPUT_MAX}
                returnKeyType="next"
                onSubmitEditing={() => {
                  const next = SOCIAL_NETWORKS[index + 1];
                  if (next) setFocus(next);
                }}
                testID={`edit-profile-social-${network}`}
              />
            )}
          />
        ))}
      </FormGroup>
      <Text variant="caption" color={colors.textMuted} style={styles.footnote}>
        {t('editProfile.socials.hint')}
      </Text>
      {values.privateAccount ? null : (
        <Text
          variant="caption"
          color={colors.textSecondary}
          style={styles.footnote}
          testID="edit-profile-public-hint"
        >
          {t('editProfile.socials.publicHint')}
        </Text>
      )}
    </Screen>
  );
}

interface PrivateAccountRowProps {
  value: boolean;
  onToggle: () => void;
  readOnly: boolean;
}

/**
 * A conta privada: a linha inteira é a chave (papel `switch` e o `checked`),
 * com o `Switch` desenhado à direita e fora do leitor. O toque muda o
 * formulário; grava no ✓.
 */
function PrivateAccountRow({ value, onToggle, readOnly }: PrivateAccountRowProps) {
  const title = t('editProfile.details.privateAccount');
  const meta = t('editProfile.details.privateAccountMeta');
  const common = {
    title,
    meta,
    leading: <Icon icon={Lock} size={ICON_SIZE} color={colors.textMuted} />,
    variant: 'divided' as const,
    trailing: <Switch value={value} />,
    style: styles.row,
    testID: 'edit-profile-private',
  };
  if (readOnly) {
    const state = t(
      value ? 'editProfile.details.privateAccountOn' : 'editProfile.details.privateAccountOff',
    );
    return <ListRow {...common} accessibilityLabel={`${title}. ${state}. ${meta}`} />;
  }
  return (
    <ListRow
      {...common}
      onPress={onToggle}
      haptic="selection"
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={`${title}. ${meta}`}
    />
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
 * Editar perfil (seção 28 de docs/arquitetura-api.md, sobre o bloco 9): fora
 * das abas, na pilha raiz, com o header fixo (X, título e ✓), a foto grande e
 * os grupos "Informações básicas", "Detalhes" e "Redes sociais". Aberta pelos
 * Ajustes e pelo hero do Perfil. O perfil atualiza pela escuta que já existe.
 *
 * Sem a API (`sourceOf('profile')`), a tela é só leitura: os valores como
 * texto, sem campos e sem ✓, e o X fecha sem pergunta. Sem o perfil (ainda não
 * criado, ou a leitura que falhou), o aviso com "Tentar de novo", e não o
 * indicador sem fim; a escuta troca pelo formulário se ele nascer depois.
 */
export function EditProfileScreen() {
  useWatchMyProfile();
  const insets = useSafeAreaInsets();
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

  if (profile && withApi) {
    return (
      <ProfileForm
        key={profile.uid}
        profile={profile}
        fallbackName={identity.name}
        online={online}
      />
    );
  }

  return (
    <Screen
      scroll
      bottomInset={insets.bottom}
      header={
        <EditProfileHeader
          notice={profile ? { text: t('editProfile.readOnly'), tone: 'info' } : null}
        />
      }
    >
      {profile ? (
        <>
          <View style={styles.photo}>
            <EditPhotoSection
              uid={profile.uid}
              name={identity.name}
              photoURL={profile.photoURL}
              mode="readOnly"
              online={online}
            />
          </View>
          <ProfileReadOnly profile={profile} name={identity.name} />
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
  notice: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  photo: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  // A foto já deixa o espaço embaixo: a primeira sobrelinha não soma o dela em cima.
  firstLabel: {
    paddingTop: 0,
  },
  row: {
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 0,
  },
  status: {
    paddingRight: spacing.md,
  },
  counter: {
    alignSelf: 'flex-end',
  },
  usernameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  usernameText: {
    flexShrink: 1,
  },
  footnote: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  loading: {
    marginTop: spacing.xl,
  },
});
