import { zodResolver } from '@hookform/resolvers/zod';
import { useIsMutating } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Plus, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Dimensions,
  Keyboard,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type TextInput as NativeTextInput,
  type ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { goBack } from '@/components/header';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { RemoteImage } from '@/components/remote-image';
import { Screen } from '@/components/screen';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { TextLink } from '@/components/text-link';
import type { ComposerSelection } from '@/domains/posts';
import {
  PhotoPickError,
  pickPhoto,
  prepareFanClubPhoto,
  SuspensionContact,
  useMyProfileQuery,
  type PreparedFanClubPhoto,
} from '@/domains/profile';
import { useIsOnline } from '@/hooks/use-is-online';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey, type TranslationParams } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { borderWidths, colors, isLargeText, layout, motion, radii, spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import { ClubMark } from '../components/club-mark';
import { FanClubNotice } from '../components/fan-club-notice';
import { MentionSuggestions } from '../components/mention-suggestions';
import { FAN_CLUB_PENDING_MAX, FAN_CLUB_POST_TEXT_MAX } from '../consts';
import { fanClubErrorText } from '../describe';
import { fanClubStageOf } from '../entry';
import { mentionDraftAt, sameDraft, type MentionDraft } from '../mentions';
import {
  fanClubMutationKeys,
  useCreateFanClubPostMutation,
  useFanClubMentionsQuery,
  useShownFanClub,
} from '../queries';
import { postSchema, type PostFormInput } from '../schemas';
import type { MentionSuggestion, MyFanClubClub } from '../types';

const SKELETON_HEIGHT = 160;
// A foto em 4:5 e o quadro tracejado do lado, na altura da 4b. A altura vai
// fixa: com o `aspectRatio`, a fileira com quebra deixava o quadro achatado
// no Android.
const TILE_WIDTH = 80;
const TILE_HEIGHT = (TILE_WIDTH * 5) / 4;
const REMOVE_CIRCLE = 26;
const REMOVE_ICON = 14;
const REMOVE_STROKE = 2.4;
const ADD_ICON = 20;
// A folga entre a barra das sugestões do @ e o teclado.
const REVEAL_GAP = spacing.md;

/** A rolagem com o `getInnerViewRef`, que o React Native tem e o tipo dele não declara. */
type ScrollWithInner = ScrollView & { getInnerViewRef?: () => View | null };

/**
 * Rola a tela só o que falta para o nó aparecer inteiro acima do teclado (a
 * barra das sugestões do @, 37.9, item 9): o `Screen scroll` não tem pé
 * acima do teclado (no iOS, ele usa o `automaticallyAdjustKeyboardInsets`; o
 * `KeyboardAvoidingView` dele só liga no Android). Mede onde o nó está na
 * janela e, se ele passa do topo do teclado, soma a diferença à rolagem de
 * agora.
 */
function revealAboveKeyboard(scroll: ScrollWithInner, node: View, animated: boolean): void {
  const inner = scroll.getInnerViewRef?.();
  const frame = scroll.getNativeScrollRef();
  if (!inner || !frame) return;
  node.measureInWindow((_x, top, _width, height) => {
    const keyboardTop = Keyboard.metrics()?.screenY ?? Dimensions.get('window').height;
    const overflow = top + height + REVEAL_GAP - keyboardTop;
    if (overflow <= 0) return;
    frame.measureInWindow((_frameX, frameTop) => {
      node.measureLayout(inner, (_left, contentTop) => {
        scroll.scrollTo({ y: frameTop + contentTop - top + overflow, animated });
      });
    });
  });
}

interface PhotoThumbProps {
  photo: PreparedFanClubPhoto | null;
  /** A foto sendo preparada: o lugar dela, com o indicador. */
  preparing: boolean;
  disabled: boolean;
  onRemove: () => void;
}

/**
 * A foto escolhida, no recorte 4:5 que vai, com o "×" no canto, que tira a
 * foto. O alvo do "×" tem 44 e fica dentro da miniatura, porque o toque fora
 * do pai não chega no Fabric do iOS; o círculo é menor, no canto.
 */
function PhotoThumb({ photo, preparing, disabled, onRemove }: PhotoThumbProps) {
  if (!photo) {
    // Chaves diferentes: reaproveitada, a view da espera levava o rótulo dela
    // para a da foto no leitor de tela do Android.
    return preparing ? (
      <View
        key="waiting"
        accessible
        accessibilityLabel={t('fanClub.newPost.preparing')}
        style={[styles.tile, styles.tileWaiting]}
        testID="fan-club-post-preparing"
      >
        <ActivityIndicator color={colors.textMuted} />
      </View>
    ) : null;
  }
  return (
    <View key="photo" style={styles.tile}>
      <RemoteImage
        uri={photo.photo.uri}
        fallback={{ kind: 'surface', seed: photo.photo.uri }}
        accessibilityLabel={t('fanClub.newPost.photoLabel')}
        style={styles.tileImage}
        testID="fan-club-post-preview"
      />
      <PressableScale
        onPress={onRemove}
        disabled={disabled}
        accessibilityLabel={t('fanClub.newPost.removePhoto')}
        style={styles.removeTarget}
        testID="fan-club-post-remove-photo"
      >
        <View style={styles.removeCircle}>
          <Icon icon={X} size={REMOVE_ICON} color={colors.text} strokeWidth={REMOVE_STROKE} />
        </View>
      </PressableScale>
    </View>
  );
}

/**
 * "Revisada pela equipe" (no lugar do "Alcance previsto" da 4b): a equipe
 * confere antes de ir ao ar, as em análise e as vagas que sobram das 3. Um
 * foco só.
 */
function ReviewCard({ club }: { club: MyFanClubClub }) {
  const pending = Math.min(club.pendingPosts, FAN_CLUB_PENDING_MAX);
  const free = FAN_CLUB_PENDING_MAX - pending;
  const freeWord = t(free === 1 ? 'fanClub.newPost.reviewFreeOne' : 'fanClub.newPost.reviewFree');
  const label = t('fanClub.newPost.reviewLabel', {
    title: t('fanClub.newPost.reviewTitle'),
    body: t('fanClub.newPost.lead'),
    slots: t('fanClub.newPost.reviewSlots', {
      pending,
      max: FAN_CLUB_PENDING_MAX,
      free,
      freeWord,
    }),
  });
  return (
    <Card accessible accessibilityLabel={label} style={styles.review} testID="fan-club-post-review">
      <Text variant="overline" color={colors.textMuted}>
        {t('fanClub.newPost.reviewTitle')}
      </Text>
      <Text variant="body" color={colors.textSecondary}>
        {t('fanClub.newPost.lead')}
      </Text>
      <View style={styles.slots}>
        <View style={styles.slot}>
          <Text variant="numberDate">{pending}</Text>
          <Text variant="caption" color={colors.textMuted}>
            {t('fanClub.newPost.reviewPending')}
          </Text>
        </View>
        <View style={styles.slot}>
          <Text variant="numberDate" color={colors.points}>
            {free}
          </Text>
          <Text variant="caption" color={colors.textMuted}>
            {freeWord}
          </Text>
        </View>
      </View>
    </Card>
  );
}

interface ComposerHeaderProps {
  /** Padrão: volta ao "Meu fã-clube" (ou troca por ele, aberta a frio). */
  onCancel?: () => void;
  /** Sem ele, o "Enviar" não aparece (a tela sem o formulário). */
  onSend?: () => void;
  sendDisabled?: boolean;
  sending?: boolean;
}

/**
 * O topo da 4b, fixo: "Cancelar", "Nova publicação" no meio, com o papel de
 * cabeçalho, e o "Enviar" rosa. Enquanto o envio vai, os dois ficam presos.
 */
function ComposerHeader({
  onCancel = leave,
  onSend,
  sendDisabled = false,
  sending = false,
}: ComposerHeaderProps) {
  // Com a fonte grande, o título não cabe entre as pontas sem quebrar no meio
  // da palavra: ele desce para a linha de baixo.
  const large = isLargeText(useWindowDimensions().fontScale);
  const title = (
    <Text
      variant="button"
      accessibilityRole="header"
      style={large ? styles.headerTitleBelow : styles.headerTitle}
    >
      {t('fanClub.newPost.title')}
    </Text>
  );
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <TextLink
          label={t('fanClub.newPost.cancel')}
          tone="text"
          underline={false}
          onPress={onCancel}
          disabled={sending}
          style={styles.headerSide}
          testID="fan-club-post-cancel"
        />
        {large ? null : title}
        <View style={[styles.headerSide, styles.headerEnd]}>
          {onSend ? (
            <Button
              label={t('fanClub.newPost.send')}
              size="sm"
              onPress={onSend}
              loading={sending}
              disabled={sendDisabled}
              haptic="confirm"
              testID="fan-club-post-submit"
            />
          ) : null}
        </View>
      </View>
      {large ? title : null}
    </View>
  );
}

/** A recusa que fica no pé, embaixo do card da revisão. */
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
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const reducedMotion = usePrefersReducedMotion();
  // O @ de quem publica (decisão 3 de 36.1); antes de o perfil chegar, o nome do fã-clube.
  const username = useMyProfileQuery().data?.username ?? null;
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

  const { control, handleSubmit, setError, setValue } = useForm<PostFormInput>({
    resolver: zodResolver(postSchema),
    defaultValues: { text: '' },
  });
  const text = useWatch({ control, name: 'text' });

  // A sugestão do @ no texto (37.9, item 9), no molde da do campo de
  // comentário: o @ que está sendo digitado antes do cursor, a conversa (sem
  // publicação: o artista do fã-clube) pedida uma vez, no primeiro foco, e a
  // busca a partir de 2 letras. O texto e o cursor ficam em refs: o aviso do
  // cursor pode vir antes ou depois do texto novo (muda com a plataforma).
  const input = useRef<NativeTextInput | null>(null);
  const scroll = useRef<ScrollView>(null);
  const bar = useRef<View>(null);
  const latestText = useRef('');
  const selection = useRef<ComposerSelection>({ start: 0, end: 0 });
  const selectionSeen = useRef(false);
  const pendingCursor = useRef<number | null>(null);
  const latestDraft = useRef<MentionDraft | null>(null);
  const [draft, setDraft] = useState<MentionDraft | null>(null);
  const [mentionsOpened, setMentionsOpened] = useState(false);
  const conversation = useFanClubMentionsQuery(club.id, null, mentionsOpened);

  const updateDraft = (value: string): void => {
    const { start, end } = selection.current;
    const next = start === end ? mentionDraftAt(value, end) : null;
    if (sameDraft(next, latestDraft.current)) return;
    latestDraft.current = next;
    setDraft(next);
  };

  // O cursor que a escolha de uma sugestão pediu vai ao campo depois de o texto novo chegar a ele.
  useEffect(() => {
    const cursor = pendingCursor.current;
    const node = input.current;
    if (cursor === null || !node) return;
    pendingCursor.current = null;
    // O campo de teste não tem o `setSelection`.
    if (typeof node.setSelection === 'function') node.setSelection(cursor, cursor);
  }, [text]);

  // Escolher troca o @ digitado pelo @ inteiro e um espaço, com o foco no campo.
  const pickMention = (item: MentionSuggestion): void => {
    const current = latestDraft.current;
    if (!current) return;
    const value = latestText.current;
    const replacement = `@${item.username} `;
    const next = `${value.slice(0, current.start)}${replacement}${value.slice(current.end)}`;
    if (next.length > FAN_CLUB_POST_TEXT_MAX) return;
    const cursor = current.start + replacement.length;
    latestText.current = next;
    selection.current = { start: cursor, end: cursor };
    pendingCursor.current = cursor;
    // Sem validar aqui: depois de um envio, a tecla do @ já validou o texto, que só cresce.
    setValue('text', next, { shouldDirty: true });
    updateDraft(next);
    input.current?.focus();
    // O foco do teclado não leva o do leitor de tela, que estava na linha que sumiu com a barra.
    setTimeout(() => {
      const node = input.current;
      if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
    }, motion.duration.fast);
  };

  // A barra apareceu (ou cresceu): a tela rola até ela, se o teclado a cobre.
  const revealBar = (event: LayoutChangeEvent): void => {
    if (event.nativeEvent.layout.height === 0) return;
    if (scroll.current && bar.current) {
      revealAboveKeyboard(scroll.current, bar.current, !reducedMotion);
    }
  };
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
            // De volta ao modo gestor, em Publicações, com a nova em análise
            // (aberta a frio, troca por ele).
            router.dismissTo({
              pathname: '/meu-fa-clube',
              params: { aba: 'publicacoes', filtro: 'em-analise' },
            });
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

  const header = (
    <ComposerHeader
      onSend={() => void submit()}
      sendDisabled={!online || create.isPending || preparing || blocked}
      sending={create.isPending}
    />
  );

  return (
    <Screen scroll header={header} bottomInset={insets.bottom} scrollRef={scroll}>
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
      <View style={styles.composer}>
        <ClubMark name={club.name} />
        <View style={styles.composerBody}>
          <Text variant="labelSmall" color={colors.textMuted} testID="fan-club-post-posting-as">
            {username
              ? t('fanClub.newPost.postingAsHandle', { username })
              : t('fanClub.newPost.postingAs', { name: club.name })}
          </Text>
          <View style={styles.field}>
            <Controller
              control={control}
              name="text"
              render={({ field: { ref, value, onChange, onBlur }, fieldState }) => (
                <TextInput
                  ref={(node) => {
                    ref(node);
                    input.current = node;
                  }}
                  label={t('fanClub.newPost.text')}
                  labelHidden
                  variant="bare"
                  value={value}
                  onChangeText={(next) => {
                    // O fã digitou: o cursor que uma escolha deixou pedido não vale mais.
                    pendingCursor.current = null;
                    const previous = latestText.current;
                    if (!selectionSeen.current || selection.current.end >= previous.length) {
                      selection.current = { start: next.length, end: next.length };
                    }
                    latestText.current = next;
                    onChange(next);
                    updateDraft(next);
                  }}
                  onSelectionChange={(event) => {
                    selectionSeen.current = true;
                    selection.current = event.nativeEvent.selection;
                    updateDraft(latestText.current);
                  }}
                  onFocus={() => setMentionsOpened(true)}
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
                      color={
                        text.length >= FAN_CLUB_POST_TEXT_MAX ? colors.danger : colors.textMuted
                      }
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                      style={styles.counter}
                    >
                      {t('fanClub.apply.counter', {
                        count: text.length,
                        max: FAN_CLUB_POST_TEXT_MAX,
                      })}
                    </Text>
                  }
                  testID="fan-club-post-text"
                />
              )}
            />
          </View>
          {draft ? (
            // Logo embaixo do campo, dentro da rolagem (37.9, item 9).
            <View ref={bar} collapsable={false} onLayout={revealBar}>
              <MentionSuggestions
                clubId={club.id}
                postId={null}
                draft={draft}
                conversation={conversation.data?.items ?? []}
                onPick={pickMention}
                style={styles.mentions}
              />
            </View>
          ) : null}
          {club.photosAllowed ? (
            <View style={styles.photos}>
              <PhotoThumb
                photo={photo}
                preparing={preparing}
                disabled={create.isPending || preparing}
                onRemove={() => setPhoto(null)}
              />
              {/* A foto entra pelo quadro tracejado da 4b, só com fotos: a
                  galeria do sistema, sem o recorte dele. */}
              <PressableScale
                onPress={() => void choose()}
                disabled={create.isPending || preparing}
                accessibilityLabel={t(
                  photo ? 'fanClub.newPost.changePhoto' : 'fanClub.newPost.pickPhoto',
                )}
                accessibilityHint={t('fanClub.newPost.pickHint')}
                style={[styles.tile, styles.addTile]}
                testID="fan-club-post-pick-photo"
              >
                <Icon icon={Plus} size={ADD_ICON} color={colors.textMuted} />
                <Text variant="caption" color={colors.textMuted}>
                  {t(photo ? 'fanClub.newPost.changePhoto' : 'fanClub.newPost.addPhoto')}
                </Text>
              </PressableScale>
            </View>
          ) : (
            <Text variant="caption" color={colors.textMuted} style={styles.textOnly}>
              {t('fanClub.newPost.textOnly')}
            </Text>
          )}
          {club.photosAllowed && photoError ? (
            <Text
              variant="caption"
              color={colors.danger}
              style={styles.photoError}
              testID="fan-club-post-photo-error"
            >
              {t(photoError)}
            </Text>
          ) : null}
        </View>
      </View>
      <ReviewCard club={club} />
      {failure ? (
        <View style={styles.failure} testID="fan-club-post-error">
          <Text variant="caption" color={colors.danger} style={styles.center}>
            {t(failure.key, failure.params)}
          </Text>
          {failure.contact ? <SuspensionContact align="center" /> : null}
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * Nova publicação (`/meu-fa-clube/nova-publicacao`, 34.9, item 6), na pilha
 * raiz, por causa do teclado, aberta pelo "+" do modo gestor, no visual da 4b
 * (34.24): "Cancelar", "Nova publicação" e "Enviar" no topo; "Publicando como"
 * com o ícone do fã-clube; o texto de 1 a 1.000; só com o `photosAllowed`, a
 * foto da galeria (o seletor do sistema, sem permissão e sem o recorte dele),
 * com a prévia do recorte 4:5 que o `prepareFanClubPhoto` faz (a foto em 1080
 * × 1350 e a miniatura em 480 × 600, em JPEG, sem EXIF); e o card "Revisada
 * pela equipe", com as vagas. Sem vídeo, enquete, música, evento, missão,
 * nível, fixar, agendar ou comentários. O envio é a vaga, os dois arquivos e o
 * `POST`, com a tentativa guardada; confirma com "Enviado para revisão" e
 * volta ao modo gestor, em "Em análise". Só abre com o fã-clube no ar para o
 * gestor; senão (e antes da abertura do programa), diz que não dá e não chama
 * mais nada.
 */
export function NewFanClubPostScreen() {
  const insets = useSafeAreaInsets();
  const { query, mine } = useShownFanClub();
  const sending = useIsMutating({ mutationKey: fanClubMutationKeys.post }) > 0;
  const [failure, setFailure] = useState<Failure | null>(null);
  const stage = mine ? fanClubStageOf(mine) : null;
  const club = stage?.kind === 'club' && stage.club.available ? stage.club : null;

  if (club) return <NewPostForm club={club} failure={failure} onFailure={setFailure} />;

  let body;
  if (mine && failure) {
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
    <Screen
      scroll
      // Sem o estado (antes da abertura, a frio), o "Cancelar" vai ao início,
      // como o "Voltar": o "Meu fã-clube" diria de novo que não está disponível.
      header={<ComposerHeader onCancel={mine ? leave : goBack} sending={sending} />}
      bottomInset={insets.bottom}
    >
      <View style={styles.unavailable}>{body}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // A linha de baixo do topo vai de ponta a ponta, como na 4b.
  header: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    marginHorizontal: -spacing.gutter,
    paddingHorizontal: spacing.gutter,
    borderBottomWidth: borderWidths.default,
    borderBottomColor: colors.divider,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.minTouchTarget,
  },
  // As pontas ficam do tamanho delas e crescem por igual, para o título ficar
  // no meio; com a fonte grande, quem quebra é o título, e não o "Enviar".
  headerSide: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    alignItems: 'flex-start',
  },
  headerEnd: {
    alignItems: 'flex-end',
  },
  headerTitle: {
    flexShrink: 1,
    textAlign: 'center',
  },
  headerTitleBelow: {
    paddingTop: spacing.xs,
  },
  notice: {
    marginTop: spacing.lg,
  },
  composer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.lg,
  },
  composerBody: {
    flex: 1,
    minWidth: 0,
  },
  // O campo sem caixa (`bare`) tem o recuo de 16 dentro: a margem negativa
  // alinha o texto ao "Publicando como".
  field: {
    marginTop: spacing.xs,
    marginHorizontal: -spacing.lg,
  },
  counter: {
    alignSelf: 'flex-end',
  },
  mentions: {
    marginTop: spacing.xs,
  },
  photos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.tileGap,
    marginTop: spacing.md,
  },
  tile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  tileWaiting: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  addTile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: borderWidths.default,
    borderStyle: 'dashed',
    borderColor: colors.borderDashed,
  },
  removeTarget: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'flex-end',
    padding: spacing.xs,
  },
  removeCircle: {
    width: REMOVE_CIRCLE,
    height: REMOVE_CIRCLE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassDarkStrong,
  },
  textOnly: {
    marginTop: spacing.md,
  },
  photoError: {
    marginTop: spacing.sm,
  },
  review: {
    marginTop: spacing.sectionTop,
    gap: spacing.sm,
  },
  slots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xl,
    marginTop: spacing.xs,
  },
  slot: {
    gap: spacing.xxs,
  },
  failure: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  center: {
    textAlign: 'center',
  },
  unavailable: {
    paddingTop: spacing.lg,
  },
});
