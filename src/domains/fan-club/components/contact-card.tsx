import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type TextInput as NativeTextInput,
} from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { useMyContactQuery, useUpdateContactMutation } from '@/domains/profile';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, type TranslationKey } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { maskWhatsapp, parseWhatsapp, whatsappFieldValue } from '@/utils/whatsapp';

import { fanClubErrorText } from '../describe';

/**
 * A frase da troca do número: fora do formato (o 400 com o campo), a recusa do
 * fã-clube (o `contact_required`), o suspenso, o ritmo, ou a genérica.
 */
function contactErrorKey(error: unknown): TranslationKey {
  if (error instanceof ApiError && error.details?.field === 'whatsapp') {
    return 'rewards.errors.whatsappInvalid';
  }
  const refused = fanClubErrorText(error);
  if (refused) return refused.key;
  const refusal = actionRefusal(error, 'profile');
  return refusal.type === 'suspended' || refusal.type === 'rateLimited'
    ? refusal.key
    : 'fanClub.mine.contact.error';
}

/**
 * "WhatsApp para a equipe" (34.9, item 5, e decisão 14): o número guardado no
 * contato do fã, com o `+55` na frente, e "Editar", que abre o campo com a
 * máscara, "Salvar" e "Cancelar" (`PUT /me/contact`). Apagar não está aqui: o
 * servidor recusa enquanto o fã tem fã-clube (o `contact_required`), porque
 * é o canal dos prêmios. A finalidade fica escrita embaixo.
 */
export function ContactCard() {
  const online = useIsOnline();
  const contact = useMyContactQuery();
  const update = useUpdateContactMutation();
  const inputRef = useRef<NativeTextInput>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const stored = contact.data?.whatsapp ?? null;
  const shown = stored
    ? `${t('rewards.confirm.whatsapp.prefix')} ${whatsappFieldValue(stored)}`
    : null;

  const startEditing = () => {
    setValue(whatsappFieldValue(stored));
    setError(undefined);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const save = () => {
    const number = parseWhatsapp(value);
    if (number === null) {
      const message = t(
        value.trim() === ''
          ? 'rewards.confirm.whatsapp.required'
          : 'rewards.errors.whatsappInvalid',
      );
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    update.mutate(number, {
      onSuccess: () => {
        setEditing(false);
        haptics.trigger('success');
        AccessibilityInfo.announceForAccessibility(t('fanClub.mine.contact.saved'));
      },
      onError: (failure) => {
        const message = t(contactErrorKey(failure));
        setError(message);
        haptics.trigger('error');
        AccessibilityInfo.announceForAccessibility(message);
      },
    });
  };

  return (
    <Card variant="compact" style={styles.card} testID="fan-club-contact">
      {editing ? (
        <>
          <TextInput
            ref={inputRef}
            label={t('fanClub.mine.contact.title')}
            prefix={t('rewards.confirm.whatsapp.prefix')}
            value={value}
            onChangeText={(text) => setValue(maskWhatsapp(text))}
            placeholder={t('rewards.confirm.whatsapp.placeholder')}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            returnKeyType="done"
            onSubmitEditing={save}
            editable={!update.isPending}
            error={error}
            hint={t('fanClub.apply.whatsappHint')}
            testID="fan-club-contact-input"
          />
          <View style={styles.actions}>
            <Button
              label={t('fanClub.mine.contact.save')}
              size="md"
              onPress={save}
              loading={update.isPending}
              disabled={!online || update.isPending}
              testID="fan-club-contact-save"
            />
            <Button
              label={t('fanClub.mine.contact.cancel')}
              size="md"
              variant="ghost"
              onPress={() => setEditing(false)}
              disabled={update.isPending}
              testID="fan-club-contact-cancel"
            />
          </View>
        </>
      ) : (
        <>
          <View
            accessible
            accessibilityLabel={`${
              shown
                ? t('fanClub.mine.contact.label', { number: shown })
                : `${t('fanClub.mine.contact.title')}. ${t('fanClub.mine.contact.empty')}`
            }. ${t('fanClub.apply.whatsappHint')}`}
          >
            <Text variant="label">{t('fanClub.mine.contact.title')}</Text>
            <Text variant="body" color={colors.textSecondary} style={styles.number}>
              {shown ?? t('fanClub.mine.contact.empty')}
            </Text>
            <Text variant="caption" color={colors.textMuted} style={styles.hint}>
              {t('fanClub.apply.whatsappHint')}
            </Text>
          </View>
          <Button
            label={t('fanClub.mine.contact.edit')}
            variant="secondary"
            size="sm"
            onPress={startEditing}
            accessibilityHint={t('fanClub.mine.contact.editHint')}
            style={styles.edit}
            testID="fan-club-contact-edit"
          />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  number: {
    marginTop: spacing.xs,
  },
  hint: {
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  edit: {
    alignSelf: 'flex-start',
  },
});
