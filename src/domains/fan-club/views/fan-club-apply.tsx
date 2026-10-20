import { zodResolver } from '@hookform/resolvers/zod';
import { useIsMutating } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type Ref } from 'react';
import { Controller, useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { goBack, LargeTitleHeader } from '@/components/header';
import { PressableScale } from '@/components/pressable-scale';
import { RemoteImage } from '@/components/remote-image';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { TextLink } from '@/components/text-link';
import { TERMS_URL } from '@/config/links';
import {
  isAutomaticUsername,
  SuspensionContact,
  useMyContactQuery,
  useMyProfileQuery,
} from '@/domains/profile';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey, type TranslationParams } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { openWebPage } from '@/services/web-page';
import { borderWidths, colors, layout, radii, spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';
import { selectionAccessibility } from '@/utils/selection-accessibility';
import { maskWhatsapp, whatsappFieldValue } from '@/utils/whatsapp';

import { CheckRow } from '../components/check-row';
import { FanClubNotice } from '../components/fan-club-notice';
import { FAN_CLUB_NAME_MAX, FAN_CLUB_PITCH_MAX, type FanClubInvalidField } from '../consts';
import { fanClubErrorText } from '../describe';
import { canApplyNow } from '../entry';
import {
  fanClubMutationKeys,
  useApplyForFanClubMutation,
  useFanClubArtistsQuery,
  useShownFanClub,
} from '../queries';
import {
  APPLY_FIELD_ORDER,
  applySchema,
  type ApplyField,
  type ApplyForm,
  type ApplyFormInput,
} from '../schemas';
import type { FanClubArtist, MyFanClub } from '../types';

const ARTIST_THUMB = 40;
const SKELETON_HEIGHT = 56;

/** O campo da tela que recebe o 400 `fan_club_invalid` (a falta das duas redes vai no Instagram). */
const FIELD_OF: Partial<Record<FanClubInvalidField, ApplyField>> = {
  name: 'name',
  pitch: 'pitch',
  instagram: 'instagram',
  tiktok: 'tiktok',
  socials: 'instagram',
  whatsapp: 'whatsapp',
  adult: 'adult',
};

/** A recusa que fica no topo, acima do botão, com o link quando ela pede. */
type Failure = {
  key: TranslationKey;
  params?: TranslationParams;
  /** O suspenso: "Escrever para a equipe". */
  contact?: boolean;
  /** O @ automático: "Editar perfil". */
  editProfile?: boolean;
};

/** Volta ao "/meu-fa-clube", que mostra o estado novo; aberta a frio, troca por ele. */
function leave(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/meu-fa-clube');
}

/** Um contador "12/40" embaixo do campo, fora do leitor (que ouve pela dica do campo). */
function Counter({ count, max }: { count: number; max: number }) {
  return (
    <Text
      variant="caption"
      color={count >= max ? colors.danger : colors.textMuted}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={styles.counter}
    >
      {t('fanClub.apply.counter', { count, max })}
    </Text>
  );
}

interface ArtistPickerProps {
  artists: readonly FanClubArtist[];
  value: string;
  onChange: (artistId: string) => void;
  error?: string;
  /** A primeira linha, que recebe o foco do leitor no envio sem artista. */
  firstRowRef: Ref<View>;
}

/**
 * O artista, de escolha única, entre as centrais do fã que aceitam fã-clubes:
 * uma linha por central, com o papel de rádio no Android e o `selected` no
 * iOS (`selectionAccessibility`). O erro ("Escolha o artista.") entra no
 * rótulo de cada linha, como na caixa de marcar, e o texto embaixo fica fora
 * do leitor.
 */
function ArtistPicker({ artists, value, onChange, error, firstRowRef }: ArtistPickerProps) {
  return (
    <View style={styles.artists} testID="fan-club-apply-artists">
      {artists.map((artist, index) => {
        const selected = artist.artistId === value;
        const { role, state } = selectionAccessibility('radio', selected);
        return (
          <PressableScale
            key={artist.artistId}
            ref={index === 0 ? firstRowRef : undefined}
            onPress={() => onChange(artist.artistId)}
            haptic="selection"
            accessibilityRole={role}
            accessibilityState={state}
            accessibilityLabel={error ? `${artist.name}. ${error}` : artist.name}
            style={[styles.artist, selected && styles.artistSelected]}
            testID={`fan-club-apply-artist-${artist.artistId}`}
          >
            <RemoteImage
              uri={artist.thumbUrl}
              fallback={{ kind: 'initials', seed: artist.artistId, name: artist.name }}
              style={styles.artistThumb}
            />
            <Text variant="label" style={styles.artistName}>
              {artist.name}
            </Text>
            <View style={[styles.radio, selected && styles.radioOn]} />
          </PressableScale>
        );
      })}
      {error ? (
        <Text
          variant="caption"
          color={colors.danger}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Põe no campo a recusa do servidor e anuncia; devolve o campo, ou null sem campo na tela. */
function applyFieldError(
  error: unknown,
  setError: UseFormSetError<ApplyFormInput>,
): ApplyField | null {
  const text = fanClubErrorText(error);
  const field = text?.field ? FIELD_OF[text.field] : undefined;
  if (!text || !field) return null;
  setError(field, { message: t(text.key, text.params) });
  AccessibilityInfo.announceForAccessibility(t(text.key, text.params));
  return field;
}

/** A recusa que não é de um campo: o 409 do fã-clube, o 403, o 429, a rede. */
function topFailure(error: unknown): Failure {
  const text = fanClubErrorText(error);
  if (text) {
    const usernameRequired = text.key === 'fanClub.errors.refused.usernameRequired';
    return { key: text.key, params: text.params, editProfile: usernameRequired };
  }
  const refusal = actionRefusal(error, 'clubApply');
  return { key: refusal.key, contact: refusal.type === 'suspended' };
}

interface ApplyFormBodyProps {
  mine: MyFanClub;
  /** A recusa do pé, guardada na tela: a recusa que muda o estado tira o formulário. */
  failure: Failure | null;
  onFailure: (failure: Failure | null) => void;
}

function ApplyFormBody({ mine, failure, onFailure: setFailure }: ApplyFormBodyProps) {
  const online = useIsOnline();
  const artists = useFanClubArtistsQuery(true);
  const contact = useMyContactQuery();
  const profile = useMyProfileQuery().data;
  const apply = useApplyForFanClubMutation();
  const artistRef = useRef<View>(null);
  const adultRef = useRef<View>(null);
  const rulesRef = useRef<View>(null);
  useStayOnScreen(apply.isPending);

  const { control, handleSubmit, setError, setValue, setFocus, getFieldState } = useForm<
    ApplyFormInput,
    unknown,
    ApplyForm
  >({
    resolver: zodResolver(applySchema),
    // O foco vai à mão (`focusField`): o padrão iria ao primeiro campo de texto,
    // e o artista e as caixas vêm antes ou não têm `focus`.
    shouldFocusError: false,
    defaultValues: {
      artistId: '',
      name: '',
      instagram: profile?.socials?.instagram ?? '',
      tiktok: profile?.socials?.tiktok ?? '',
      whatsapp: whatsappFieldValue(contact.data?.whatsapp),
      pitch: '',
      adult: false,
      rules: false,
    },
  });

  // O que chega depois de a tela abrir preenche o campo que o fã ainda não mexeu.
  const items = artists.data?.items;
  const stored = contact.data?.whatsapp;
  const instagram = profile?.socials?.instagram;
  const tiktok = profile?.socials?.tiktok;
  useEffect(() => {
    if (stored && !getFieldState('whatsapp').isDirty) {
      setValue('whatsapp', whatsappFieldValue(stored));
    }
  }, [stored, getFieldState, setValue]);
  useEffect(() => {
    if (instagram && !getFieldState('instagram').isDirty) setValue('instagram', instagram);
    if (tiktok && !getFieldState('tiktok').isDirty) setValue('tiktok', tiktok);
  }, [instagram, tiktok, getFieldState, setValue]);
  useEffect(() => {
    // Uma central só: já vem escolhida.
    if (items?.length === 1 && !getFieldState('artistId').isDirty) {
      setValue('artistId', items[0]!.artistId);
    }
  }, [items, getFieldState, setValue]);

  const name = useWatch({ control, name: 'name' });
  const pitch = useWatch({ control, name: 'pitch' });
  const regulation = mine.rulesUrl !== null;
  const usernameAutomatic = profile ? isAutomaticUsername(profile.username) : false;

  // O foco do leitor no campo: o de texto pelo `setFocus`; o artista e as
  // caixas, que não são campos de texto, pelo evento de foco no pressável.
  const focusField = (field: ApplyField): void => {
    const target =
      field === 'artistId'
        ? artistRef
        : field === 'adult'
          ? adultRef
          : field === 'rules'
            ? rulesRef
            : null;
    if (!target) {
      setFocus(field);
      return;
    }
    if (target.current) AccessibilityInfo.sendAccessibilityEvent(target.current, 'focus');
  };

  // O `handleSubmit` só no toque: fora dele, o compilador do React veria as refs no render.
  const submit = () =>
    handleSubmit(
      (form) => {
        setFailure(null);
        apply.mutate(
          {
            artistId: form.artistId,
            name: form.name,
            instagram: form.instagram,
            tiktok: form.tiktok,
            whatsapp: form.whatsapp,
            pitch: form.pitch,
            adult: true,
            rulesVersion: mine.rulesVersion,
          },
          {
            onSuccess: () => {
              haptics.trigger('success');
              AccessibilityInfo.announceForAccessibility(t('fanClub.apply.sent'));
              leave();
            },
            onError: (error) => {
              haptics.trigger('error');
              const field = applyFieldError(error, setError);
              if (field) {
                focusField(field);
                return;
              }
              const top = topFailure(error);
              setFailure(top);
              AccessibilityInfo.announceForAccessibility(t(top.key, top.params));
            },
          },
        );
      },
      (errors) => {
        announceFirstError(errors, APPLY_FIELD_ORDER);
        const first = APPLY_FIELD_ORDER.find((field) => errors[field]);
        if (first) focusField(first);
      },
    )();

  return (
    <View>
      <Text variant="bodyLead" color={colors.textSecondary}>
        {t('fanClub.apply.lead')}
      </Text>
      {usernameAutomatic ? (
        <FanClubNotice
          tone="warning"
          body={t('fanClub.errors.refused.usernameRequired')}
          style={styles.notice}
          testID="fan-club-apply-username"
        >
          <TextLink
            label={t('fanClub.apply.editProfile')}
            onPress={() => router.push('/editar-perfil')}
          />
        </FanClubNotice>
      ) : null}

      <SectionLabel>{t('fanClub.apply.artist')}</SectionLabel>
      <Text variant="caption" color={colors.textMuted} style={styles.sectionHint}>
        {t('fanClub.apply.artistHint')}
      </Text>
      {artists.isPending ? (
        <SkeletonGroup>
          <Skeleton height={SKELETON_HEIGHT} tone="surface" />
        </SkeletonGroup>
      ) : artists.isError ? (
        <EmptyState
          tone="error"
          message={t('fanClub.apply.artistsError')}
          actionLabel={t('common.retry')}
          onAction={() => void artists.refetch()}
          actionLoading={artists.isFetching}
        />
      ) : (artists.data?.items.length ?? 0) === 0 ? (
        <View testID="fan-club-apply-no-artists">
          <EmptyState
            title={t('fanClub.apply.noArtists')}
            message={t('fanClub.apply.noArtistsBody')}
            actionLabel={t('fanClub.apply.explore')}
            onAction={() => router.navigate('/explorar')}
          />
        </View>
      ) : (
        <Controller
          control={control}
          name="artistId"
          render={({ field: { value, onChange }, fieldState }) => (
            <ArtistPicker
              artists={artists.data?.items ?? []}
              value={value}
              onChange={onChange}
              error={fieldState.error?.message}
              firstRowRef={artistRef}
            />
          )}
        />
      )}

      <SectionLabel>{t('fanClub.apply.name')}</SectionLabel>
      <Controller
        control={control}
        name="name"
        render={({ field: { ref, value, onChange, onBlur }, fieldState }) => (
          <TextInput
            ref={ref}
            label={t('fanClub.apply.name')}
            labelHidden
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={fieldState.error?.message}
            hint={t('fanClub.apply.nameHint')}
            maxLength={FAN_CLUB_NAME_MAX}
            returnKeyType="next"
            accessibilityStatus={t('fanClub.apply.counterLabel', {
              count: name.length,
              max: FAN_CLUB_NAME_MAX,
            })}
            footer={<Counter count={name.length} max={FAN_CLUB_NAME_MAX} />}
            testID="fan-club-apply-name"
          />
        )}
      />

      <SectionLabel>{t('fanClub.apply.socials')}</SectionLabel>
      <Text variant="caption" color={colors.textMuted} style={styles.sectionHint}>
        {t('fanClub.apply.socialsHint')}
      </Text>
      <View style={styles.fields}>
        {(['instagram', 'tiktok'] as const).map((network) => (
          <Controller
            key={network}
            control={control}
            name={network}
            render={({ field: { ref, value, onChange, onBlur }, fieldState }) => (
              <TextInput
                ref={ref}
                label={t(`fanClub.apply.${network}`)}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={fieldState.error?.message}
                placeholder={t('editProfile.socials.placeholder')}
                leadingGlyph={network}
                prefix="@"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                keyboardType="url"
                returnKeyType="next"
                testID={`fan-club-apply-${network}`}
              />
            )}
          />
        ))}
      </View>

      <SectionLabel>{t('fanClub.apply.whatsapp')}</SectionLabel>
      <Controller
        control={control}
        name="whatsapp"
        render={({ field: { ref, value, onChange, onBlur }, fieldState }) => (
          <TextInput
            ref={ref}
            label={t('fanClub.apply.whatsapp')}
            labelHidden
            prefix={t('rewards.confirm.whatsapp.prefix')}
            value={value}
            onChangeText={(text) => onChange(maskWhatsapp(text))}
            onBlur={onBlur}
            placeholder={t('rewards.confirm.whatsapp.placeholder')}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            error={fieldState.error?.message}
            hint={t('fanClub.apply.whatsappHint')}
            testID="fan-club-apply-whatsapp"
          />
        )}
      />

      <SectionLabel>{t('fanClub.apply.pitch')}</SectionLabel>
      <Controller
        control={control}
        name="pitch"
        render={({ field: { ref, value, onChange, onBlur }, fieldState }) => (
          <TextInput
            ref={ref}
            label={t('fanClub.apply.pitch')}
            labelHidden
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={fieldState.error?.message}
            hint={t('fanClub.apply.pitchHint')}
            multiline
            maxLength={FAN_CLUB_PITCH_MAX}
            accessibilityStatus={t('fanClub.apply.counterLabel', {
              count: pitch.length,
              max: FAN_CLUB_PITCH_MAX,
            })}
            footer={<Counter count={pitch.length} max={FAN_CLUB_PITCH_MAX} />}
            testID="fan-club-apply-pitch"
          />
        )}
      />

      <View style={styles.checks}>
        <Controller
          control={control}
          name="adult"
          render={({ field: { value, onChange }, fieldState }) => (
            <CheckRow
              ref={adultRef}
              label={t('fanClub.apply.adult')}
              checked={value}
              onChange={onChange}
              error={fieldState.error?.message}
              testID="fan-club-apply-adult"
            />
          )}
        />
        <Controller
          control={control}
          name="rules"
          render={({ field: { value, onChange }, fieldState }) => (
            <CheckRow
              ref={rulesRef}
              label={t(regulation ? 'fanClub.apply.rulesRegulation' : 'fanClub.apply.rulesTerms')}
              checked={value}
              onChange={onChange}
              error={fieldState.error?.message}
              testID="fan-club-apply-rules"
            />
          )}
        />
        <TextLink
          label={t(regulation ? 'fanClub.apply.readRegulation' : 'fanClub.apply.readTerms')}
          role="link"
          onPress={() => openWebPage(mine.rulesUrl ?? TERMS_URL)}
          style={styles.read}
          testID="fan-club-apply-read-rules"
        />
      </View>

      <View style={styles.footer}>
        {failure ? (
          <View testID="fan-club-apply-error">
            <Text variant="caption" color={colors.danger} style={styles.error}>
              {t(failure.key, failure.params)}
            </Text>
            {failure.contact ? <SuspensionContact align="center" /> : null}
            {failure.editProfile ? (
              <TextLink
                label={t('fanClub.apply.editProfile')}
                onPress={() => router.push('/editar-perfil')}
                style={styles.centered}
              />
            ) : null}
          </View>
        ) : null}
        <Button
          label={t(online ? 'fanClub.apply.submit' : 'fanClub.apply.submitOffline')}
          onPress={() => void submit()}
          loading={apply.isPending}
          disabled={!online || apply.isPending || (artists.data?.items.length ?? 0) === 0}
          haptic="confirm"
          testID="fan-club-apply-submit"
        />
      </View>
    </View>
  );
}

/**
 * Candidatura (`/meu-fa-clube/candidatura`, 34.9, item 3), na pilha raiz, por
 * causa do teclado: o artista (só as centrais do fã que aceitam fã-clubes,
 * pelo `GET /me/fan-club/artists`; sem nenhuma, o atalho para a Explorar), o
 * nome proposto, o Instagram e o TikTok (já com as redes do perfil), o
 * WhatsApp (já com o do contato do fã, e a finalidade embaixo), o texto de
 * divulgação, os contadores, "Tenho 18 anos ou mais" e o aceite (os Termos de
 * Uso até o regulamento existir, decisão 8). Enviar faz o `POST` com a chave
 * da tentativa; cada recusa vai ao campo dela ou ao pé, e o @ automático leva a
 * "Editar perfil". Só abre quando o fã pode mandar a candidatura agora; senão
 * (e antes da abertura do programa), diz que não dá e não chama mais nada.
 */
export function FanClubApplyScreen() {
  const insets = useSafeAreaInsets();
  const { query, mine } = useShownFanClub();
  const sending = useIsMutating({ mutationKey: fanClubMutationKeys.apply }) > 0;
  const [failure, setFailure] = useState<Failure | null>(null);

  let body;
  if (mine && canApplyNow(mine)) {
    body = <ApplyFormBody mine={mine} failure={failure} onFailure={setFailure} />;
  } else if (mine && failure) {
    // A recusa que mudou o estado do fã (o prazo, a candidatura de outro
    // aparelho, o programa fechado) tira o formulário: a frase dela fica.
    body = (
      <View testID="fan-club-apply-unavailable">
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
        <Skeleton height={SKELETON_HEIGHT * 3} tone="surface" />
      </SkeletonGroup>
    );
  } else {
    body = (
      <View testID="fan-club-apply-unavailable">
        <EmptyState
          message={t(mine ? 'fanClub.apply.unavailable' : 'fanClub.notAvailable')}
          actionLabel={t('common.back')}
          onAction={mine ? leave : goBack}
        />
      </View>
    );
  }

  return (
    <Screen scroll bottomInset={insets.bottom}>
      <LargeTitleHeader title={t('fanClub.apply.title')} showBack backDisabled={sending} />
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: {
    marginTop: spacing.lg,
  },
  sectionHint: {
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
  artists: {
    gap: spacing.sm,
  },
  artist: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.minTouchTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: borderWidths.default,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  artistSelected: {
    borderColor: colors.accent,
  },
  artistThumb: {
    width: ARTIST_THUMB,
    height: ARTIST_THUMB,
    borderRadius: ARTIST_THUMB / 2,
    overflow: 'hidden',
  },
  artistName: {
    flex: 1,
  },
  radio: {
    width: layout.selectMark,
    height: layout.selectMark,
    borderRadius: layout.selectMark / 2,
    borderWidth: borderWidths.strong,
    borderColor: colors.textSecondary,
  },
  radioOn: {
    borderColor: colors.accent,
    borderWidth: layout.selectMark / 3,
  },
  counter: {
    alignSelf: 'flex-end',
    marginTop: spacing.xs,
  },
  fields: {
    gap: spacing.md,
  },
  checks: {
    marginTop: spacing.sectionTop,
    gap: spacing.sm,
  },
  read: {
    alignSelf: 'flex-start',
  },
  footer: {
    marginTop: spacing.sectionTop,
    gap: spacing.listGap,
  },
  error: {
    textAlign: 'center',
  },
  centered: {
    alignSelf: 'center',
  },
});
