import { z } from 'zod';

import { normalizeSocialHandle } from '@/domains/profile';
import { t } from '@/i18n';
import { cleanLine, cleanMultiline, isVisibleLine, isVisibleMultiline } from '@/utils/visible-line';
import { parseWhatsapp } from '@/utils/whatsapp';

import {
  FAN_CLUB_NAME_MAX,
  FAN_CLUB_NAME_MIN,
  FAN_CLUB_PITCH_MAX,
  FAN_CLUB_PITCH_MIN,
  FAN_CLUB_POST_TEXT_MAX,
} from './consts';

// Os formulários do fã-clube (seção 34, 34.9): a candidatura e a nova
// publicação, com as regras do servidor (`functions/src/fan-clubs/model.ts`:
// o nome pelo `cleanLine`, o texto de divulgação e o da publicação pelo
// `cleanMultiline`, os tamanhos em UTF-16, como o `.length`). Quem decide é o
// servidor (o filtro e o "oficial" moram lá); o aparelho confere antes para o
// fã ver o erro no campo.

/**
 * A palavra "oficial" inteira, sem acento nem caixa, entre separadores certos
 * (o começo, o fim, o espaço e a pontuação comum): o servidor recusa (decisão
 * 10). Os `@ $ ! |` contam como letras no filtro do servidor (o leet), e ele
 * aceita "Clube!Oficial": o aparelho não recusa o que ele aceita, e o resto
 * fica para a recusa do servidor, no campo.
 */
function hasOfficialWord(name: string): boolean {
  const plain = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return /(^|[ \-_.,;:/()])oficial([ \-_.,;:/()]|$)/.test(plain);
}

const nameField = z
  .string()
  .transform(cleanLine)
  .pipe(
    z
      .string()
      .refine(
        (name) =>
          name.length >= FAN_CLUB_NAME_MIN &&
          name.length <= FAN_CLUB_NAME_MAX &&
          isVisibleLine(name),
        { error: t('fanClub.errors.invalid.name') },
      )
      .refine((name) => !hasOfficialWord(name), {
        error: t('fanClub.errors.invalid.nameOfficial'),
      }),
  );

const pitchField = z
  .string()
  .transform(cleanMultiline)
  .pipe(
    z
      .string()
      .refine(
        (pitch) =>
          pitch.length >= FAN_CLUB_PITCH_MIN &&
          pitch.length <= FAN_CLUB_PITCH_MAX &&
          isVisibleMultiline(pitch),
        { error: t('fanClub.errors.invalid.pitch') },
      ),
  );

/** Uma rede: o usuário normalizado como no perfil (`null` vazia), ou o erro do campo. */
const socialField = (network: 'instagram' | 'tiktok') =>
  z.string().transform((raw, ctx) => {
    const result = normalizeSocialHandle(network, raw);
    if (result.ok) return result.handle;
    ctx.addIssue({ code: 'custom', message: t(`fanClub.errors.invalid.${network}`) });
    return z.NEVER;
  });

const whatsappField = z.string().transform((raw, ctx) => {
  if (raw.trim() === '') {
    ctx.addIssue({ code: 'custom', message: t('rewards.confirm.whatsapp.required') });
    return z.NEVER;
  }
  const number = parseWhatsapp(raw);
  if (number !== null) return number;
  ctx.addIssue({ code: 'custom', message: t('rewards.errors.whatsappInvalid') });
  return z.NEVER;
});

/**
 * A candidatura (decisão 8): o artista, o nome proposto, as redes (pelo menos
 * uma, já preenchidas com as do perfil), o WhatsApp (obrigatório, decisão
 * 14), o texto de divulgação e as duas caixas. A falta das duas redes cai no
 * Instagram, o primeiro campo delas, com a frase do `socials`.
 */
export const applySchema = z
  .object({
    artistId: z.string().min(1, { error: t('fanClub.apply.artistRequired') }),
    name: nameField,
    instagram: socialField('instagram'),
    tiktok: socialField('tiktok'),
    whatsapp: whatsappField,
    pitch: pitchField,
    adult: z.boolean().refine((value) => value, { error: t('fanClub.errors.invalid.adult') }),
    rules: z.boolean().refine((value) => value, { error: t('fanClub.apply.rulesRequired') }),
  })
  .superRefine((form, ctx) => {
    if (form.instagram === null && form.tiktok === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['instagram'],
        message: t('fanClub.errors.invalid.socials'),
      });
    }
  });

export type ApplyFormInput = z.input<typeof applySchema>;
export type ApplyForm = z.output<typeof applySchema>;
export type ApplyField = keyof ApplyFormInput;

/** Os campos na ordem da tela, para o foco e o anúncio do primeiro erro. */
export const APPLY_FIELD_ORDER: readonly ApplyField[] = [
  'artistId',
  'name',
  'instagram',
  'tiktok',
  'whatsapp',
  'pitch',
  'adult',
  'rules',
];

/** O texto da publicação (decisão 15): de 1 a 1.000, limpo. */
export const postSchema = z.object({
  text: z
    .string()
    .transform(cleanMultiline)
    .pipe(
      z
        .string()
        .refine(
          (text) =>
            text.length >= 1 && text.length <= FAN_CLUB_POST_TEXT_MAX && isVisibleMultiline(text),
          { error: t('fanClub.errors.invalid.text') },
        ),
    ),
});

export type PostFormInput = z.input<typeof postSchema>;
