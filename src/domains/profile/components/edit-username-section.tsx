import { Check } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Pill } from '@/components/pill';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { TextLink } from '@/components/text-link';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useNow } from '@/hooks/use-now';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { formatLongDate } from '@/utils/date';

import { USERNAME_CHECK_DEBOUNCE_MS } from '../consts';
import {
  apiErrorCode,
  refusedUsernameStatus,
  useChangeUsernameMutation,
  useUsernameAvailabilityQuery,
} from '../queries';
import type { UsernameStatus } from '../types';
import { isAutomaticUsername, isUsernameFormat, normalizeUsername } from '../username';

const STATUS_ICON_SIZE = 14;

/**
 * O que aparece embaixo do campo: o status do @ digitado, "Conferindo..." ou
 * `unchecked` (a consulta ao servidor falhou: rede, 5xx).
 */
type FieldStatus = UsernameStatus | 'checking' | 'unchecked' | null;

/** Os status que o campo mostra como erro. */
const ERROR_TEXT: Partial<Record<NonNullable<FieldStatus>, TranslationKey>> = {
  taken: 'editProfile.username.taken',
  reserved: 'editProfile.username.reserved',
  invalid: 'editProfile.username.invalid',
  unchecked: 'editProfile.username.checkError',
};

/** Os status que o campo mostra como informação (sem erro). */
const INFO_TEXT: Partial<Record<NonNullable<FieldStatus>, TranslationKey>> = {
  checking: 'editProfile.username.checking',
  available: 'editProfile.username.available',
  current: 'editProfile.username.current',
};

/** A recusa da troca, até o fã mexer no campo; a definitiva segura o "Trocar @". */
type Refusal = { text: string; final: boolean };

/**
 * A recusa da troca no campo, e se ela é definitiva (repetir o mesmo @ não
 * muda nada). O `username_invalid` que chega ao app é de reservado ou
 * automático (o formato é conferido antes), e o `toApiError` não lê o motivo.
 * Antes do prazo (`username_change_too_soon`: a troca em outro aparelho que a
 * escuta ainda não trouxe, ou o relógio do aparelho adiantado), a data do
 * perfil, quando ele tem, e sem ela o texto do prazo, sem "tente de novo". O
 * resto é falha incerta (rede, servidor): o mesmo @ pode ir de novo.
 */
function submitRefusal(code: string | null, changeableAt: string | null): Refusal {
  if (code === 'username_taken') return { text: t('editProfile.username.taken'), final: true };
  if (code === 'username_invalid') {
    return { text: t('editProfile.username.reserved'), final: true };
  }
  if (code === 'username_change_too_soon') {
    const text = changeableAt
      ? t('editProfile.username.lockedUntil', { date: formatLongDate(changeableAt) })
      : t('editProfile.username.tooSoon');
    return { text, final: true };
  }
  return { text: t('editProfile.username.error'), final: false };
}

export interface EditUsernameSectionProps {
  /** O @ de agora, sem a arroba. */
  username: string | null;
  /** ISO: a partir de quando o fã troca de novo (do perfil), ou `null`. */
  changeableAt: string | null;
  /** Com a API: o campo e a troca; sem ela (fixtures), o @ como texto (24.1, decisão 12). */
  editable: boolean;
  online: boolean;
}

/**
 * O @ da tela "Editar perfil" (bloco 9). O campo normaliza o que o fã digita
 * (minúsculas, sem o @ do começo) e, 400 ms depois da última tecla, mostra o
 * status: "Conferindo...", "Disponível", "É o seu @ de agora", ou o erro (de
 * outro fã, reservado, fora do formato, este conferido no aparelho sem pedir
 * ao servidor). A consulta que falhou (rede, servidor) diz que não deu para
 * conferir, com "Tentar de novo". O automático leva o selo "Automático" e a
 * dica para trocar. Com o prazo de 30 dias correndo, o campo fica só de
 * leitura, com a data. O "Trocar @" só liga com o @ livre, e uma recusa
 * definitiva o segura até o fã mexer no campo. O status final é anunciado uma
 * vez.
 */
export function EditUsernameSection({
  username,
  changeableAt,
  editable,
  online,
}: EditUsernameSectionProps) {
  const current = username ?? '';
  const now = useNow();
  const lockedUntil =
    changeableAt && Date.parse(changeableAt) > now.getTime() ? changeableAt : null;
  const automatic = isAutomaticUsername(current);

  const [draft, setDraft] = useState(current);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // O @ de agora mudou (a troca deu certo, ou chegou pela escuta): o campo segue.
  const shown = useRef(current);
  useEffect(() => {
    if (shown.current === current) return;
    shown.current = current;
    setDraft(current);
  }, [current]);

  const normalized = normalizeUsername(draft);
  const debounced = useDebouncedValue(normalized, USERNAME_CHECK_DEBOUNCE_MS);
  const settled = debounced === normalized;
  const isCurrent = normalized === current;
  const formatOk = isUsernameFormat(normalized);
  const availability = useUsernameAvailabilityQuery(
    debounced,
    editable && !lockedUntil && settled && formatOk && !isCurrent,
  );
  const change = useChangeUsernameMutation();

  let status: FieldStatus = null;
  if (isCurrent) status = 'current';
  else if (!settled) status = 'checking';
  else if (!formatOk) status = 'invalid';
  else if (availability.data?.username === normalized) status = availability.data.status;
  else if (availability.isFetching) status = 'checking';
  else if (availability.isError) status = 'unchecked';

  // O status final, uma vez por @ (o "Conferindo..." e o @ de agora não).
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!editable || !status || status === 'checking' || isCurrent) return;
    const key = `${normalized}:${status}`;
    if (announced.current === key) return;
    announced.current = key;
    const text = ERROR_TEXT[status] ?? INFO_TEXT[status];
    if (text) AccessibilityInfo.announceForAccessibility(t(text));
  }, [editable, status, normalized, isCurrent]);
  const errorOf = (value: FieldStatus): TranslationKey | null =>
    value && value !== 'checking' ? (ERROR_TEXT[value] ?? null) : null;

  // Conferir de novo anuncia o resultado outra vez, mesmo que seja a mesma falha.
  const recheck = (): void => {
    announced.current = null;
    void availability.refetch();
  };

  if (!editable) {
    return (
      <View testID="edit-profile-username">
        <Text variant="labelSmall" color={colors.textSecondary}>
          {t('editProfile.username.label')}
        </Text>
        <Text variant="body" color={colors.textBody} style={styles.readonly}>
          {current ? `@${current}` : ''}
        </Text>
      </View>
    );
  }

  const lockedHint = lockedUntil
    ? t('editProfile.username.lockedUntil', { date: formatLongDate(lockedUntil) })
    : null;
  const hint =
    lockedHint ?? t(automatic ? 'editProfile.username.automaticHint' : 'editProfile.username.rule');
  // Com o prazo correndo, o campo é só de leitura e a dica diz a data.
  const statusError = errorOf(status);
  const errorText = lockedUntil ? null : (refusal?.text ?? (statusError ? t(statusError) : null));
  const infoKey = lockedUntil || refusal || !status ? null : (INFO_TEXT[status] ?? null);
  const canSubmit =
    status === 'available' && online && !change.isPending && !lockedUntil && !refusal?.final;

  const submit = (): void => {
    if (!canSubmit) return;
    setRefusal(null);
    change.mutate(normalized, {
      onSuccess: (result) => {
        AccessibilityInfo.announceForAccessibility(
          t('editProfile.username.changed', { username: result.username }),
        );
        haptics.trigger('success');
      },
      onError: (error) => {
        const next = submitRefusal(apiErrorCode(error), changeableAt);
        setRefusal(next);
        // A recusa de @ com dono ou reservado também vira o status do campo (o
        // hook a põe no retrato da disponibilidade): anunciada aqui, não de novo.
        const refused = refusedUsernameStatus(error);
        if (refused) announced.current = `${normalized}:${refused}`;
        AccessibilityInfo.announceForAccessibility(next.text);
        haptics.trigger('error');
      },
    });
  };

  return (
    <View testID="edit-profile-username">
      {automatic ? (
        <View
          style={styles.badge}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Pill
            label={t('editProfile.username.automatic')}
            tone="accentStrong"
            size="xs"
            testID="edit-profile-username-automatic"
          />
        </View>
      ) : null}
      <TextInput
        label={t('editProfile.username.label')}
        value={draft}
        onChangeText={(text) => {
          setRefusal(null);
          setDraft(normalizeUsername(text));
        }}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        keyboardType="ascii-capable"
        maxLength={64}
        editable={!lockedUntil && !change.isPending}
        error={errorText ?? undefined}
        hint={hint}
        returnKeyType="done"
        onSubmitEditing={submit}
        testID="edit-profile-username-input"
      />
      {status === 'unchecked' && !lockedUntil && !refusal ? (
        <TextLink
          label={t('common.retry')}
          accessibilityLabel={t('editProfile.username.recheck')}
          onPress={recheck}
          disabled={!online}
          style={styles.recheck}
          testID="edit-profile-username-recheck"
        />
      ) : null}
      {infoKey ? (
        <View
          style={styles.status}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="edit-profile-username-status"
        >
          {status === 'available' ? (
            <Icon icon={Check} size={STATUS_ICON_SIZE} color={colors.textSecondary} />
          ) : null}
          <Text variant="caption" color={colors.textSecondary}>
            {t(infoKey)}
          </Text>
        </View>
      ) : null}
      <Button
        label={t('editProfile.username.submit')}
        variant="secondary"
        size="md"
        onPress={submit}
        loading={change.isPending}
        disabled={!canSubmit}
        style={styles.submit}
        testID="edit-profile-username-submit"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  readonly: {
    marginTop: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.iconLabelGap,
    marginTop: spacing.xs,
  },
  recheck: {
    alignSelf: 'flex-start',
  },
  submit: {
    marginTop: spacing.md,
  },
});
