import { z } from 'zod';

import { nameField } from '@/domains/auth/schemas';
import { t, type TranslationKey } from '@/i18n';
import {
  CITY_MAX,
  cleanLine,
  cleanMultiline,
  isVisibleLine,
  isVisibleMultiline,
} from '@/utils/visible-line';

import {
  BIO_MAX,
  BIO_MAX_LINES,
  GENDERS,
  normalizeSocialHandle,
  SOCIAL_NETWORKS,
  type SocialHandleResult,
} from './details';
import type { FanProfile, FanSocials, Gender, ProfileChanges, SocialNetwork } from './types';
import { isUsernameFormat, normalizeUsername } from './username';

/**
 * A cidade como o servidor confere (`PUT /me/profile`, com o `FAN_CITY_MAX`
 * de 80): opcional (vazia vira `null`, que limpa o campo), uma linha visível
 * de até 80 em UTF-16. O texto colado perde os isolantes bidi e os espaços das
 * pontas, como o nome.
 */
const cityField = z
  .string()
  .transform(cleanLine)
  .pipe(
    z
      .string()
      .refine((city) => city.length <= CITY_MAX, {
        error: t('validation.cityMax', { max: CITY_MAX }),
      })
      .refine((city) => city === '' || isVisibleLine(city), {
        error: t('validation.cityInvalid'),
      }),
  )
  .transform((city) => (city === '' ? null : city));

/**
 * A bio pela limpeza do comentário (`cleanMultiline`): vazia vira `null`, até
 * 200 em UTF-16 (o `.max()` do zod 4 conta pontos de código, por isso a
 * conta à mão) e 6 linhas no texto limpo, com toda linha visível.
 */
const bioField = z
  .string()
  .transform(cleanMultiline)
  .pipe(
    z
      .string()
      .refine((bio) => bio.length <= BIO_MAX, { error: t('validation.bioMax', { max: BIO_MAX }) })
      .refine((bio) => bio.split('\n').length <= BIO_MAX_LINES, {
        error: t('validation.bioLines', { max: BIO_MAX_LINES }),
      })
      .refine(isVisibleMultiline, { error: t('validation.bioInvalid') }),
  )
  .transform((bio) => (bio === '' ? null : bio));

/**
 * O @ normalizado (minúsculas, sem o @ do começo). O formato é conferido no
 * aparelho pela linha de status do @, que segura o ✓; aqui fica a última
 * barreira (o vazio passa: é o @ que o fã apagou, e a linha já o mostra).
 */
const usernameField = z
  .string()
  .transform(normalizeUsername)
  .pipe(
    z.string().refine((username) => username === '' || isUsernameFormat(username), {
      error: t('editProfile.username.invalid'),
    }),
  );

/** O nome de cada rede nos textos ("Instagram", "X (Twitter)"). */
export const SOCIAL_LABEL_KEYS: Readonly<Record<SocialNetwork, TranslationKey>> = {
  instagram: 'editProfile.socials.instagram',
  tiktok: 'editProfile.socials.tiktok',
  linkedin: 'editProfile.socials.linkedin',
  x: 'editProfile.socials.x',
};

/** A mensagem do campo da rede recusada: link de outro domínio ou usuário fora do formato. */
export function socialErrorMessage(network: SocialNetwork, result: SocialHandleResult): string {
  if (result.ok) return '';
  return t(result.reason === 'host' ? 'editProfile.socials.host' : 'editProfile.socials.format', {
    network: t(SOCIAL_LABEL_KEYS[network]),
  });
}

/** Uma rede: o que o fã digitou ou colou vira o usuário (`null` vazia), ou o erro do campo. */
const socialField = (network: SocialNetwork) =>
  z.string().transform((raw, ctx) => {
    const result = normalizeSocialHandle(network, raw);
    if (result.ok) return result.handle;
    ctx.addIssue({ code: 'custom', message: socialErrorMessage(network, result) });
    return z.NEVER;
  });

/**
 * O formulário da tela "Editar perfil" (seção 28), achatado: as redes ficam no
 * primeiro nível de propósito, porque o `announceFirstError` e o
 * `firstErrorMessage` só leem `errors[campo]`, e uma rede dentro de
 * `socials` nunca seria anunciada. As regras são as do servidor
 * (`parseProfileChanges` de `functions/src/fan-profile/details.ts`): o nome é
 * o campo do cadastro, sem cópia. Quem decide é o servidor; o aparelho confere
 * antes para o fã ver o erro no campo.
 */
export const editProfileSchema = z.object({
  name: nameField,
  username: usernameField,
  bio: bioField,
  city: cityField,
  gender: z.enum(GENDERS).nullable(),
  privateAccount: z.boolean(),
  instagram: socialField('instagram'),
  tiktok: socialField('tiktok'),
  linkedin: socialField('linkedin'),
  x: socialField('x'),
});

/** O que o formulário guarda (texto cru) e o que o envio recebe (já limpo). */
export type EditProfileFormInput = z.input<typeof editProfileSchema>;
export type EditProfileForm = z.output<typeof editProfileSchema>;
export type EditProfileField = keyof EditProfileFormInput;

/** Os campos na ordem da tela, para o envio inválido anunciar o primeiro erro. */
export const EDIT_PROFILE_FIELD_ORDER = [
  'name',
  'username',
  'bio',
  'city',
  'gender',
  'instagram',
  'tiktok',
  'linkedin',
  'x',
] as const satisfies readonly EditProfileField[];

/**
 * O campo do formulário de cada `details.field` do `profile_invalid` do
 * servidor (`displayName` vira `name`; `socials.x` vira `x`).
 */
export const SERVER_FIELD_TO_FORM: Readonly<Record<string, EditProfileField>> = {
  displayName: 'name',
  bio: 'bio',
  city: 'city',
  gender: 'gender',
  'socials.instagram': 'instagram',
  'socials.tiktok': 'tiktok',
  'socials.linkedin': 'linkedin',
  'socials.x': 'x',
};

/**
 * Os valores do formulário a partir do perfil (o nome do perfil sem nome é o
 * da sessão, `fallbackName`): os textos crus que os campos mostram.
 */
export function formValuesOf(
  profile: FanProfile,
  fallbackName: string | null,
): EditProfileFormInput {
  const socials = profile.socials ?? null;
  return {
    name: profile.displayName ?? fallbackName ?? '',
    username: profile.username ?? '',
    bio: profile.bio ?? '',
    city: profile.city ?? '',
    gender: profile.gender ?? null,
    privateAccount: profile.privateAccount ?? false,
    instagram: socials?.instagram ?? '',
    tiktok: socials?.tiktok ?? '',
    linkedin: socials?.linkedin ?? '',
    x: socials?.x ?? '',
  };
}

/** Os campos que o fã mexeu (o `formState.dirtyFields` do react-hook-form). */
export type TouchedFields = Partial<Readonly<Record<EditProfileField, boolean | undefined>>>;

const emptyToNull = (text: string): string | null => (text === '' ? null : text);

/**
 * A rede como vai no corpo: o usuário normalizado, ou o texto cru quando ele
 * não passa (só para o ✓ acender e o envio mostrar o erro do campo; um texto
 * que não passa nunca é igual a um usuário guardado, que passa).
 */
function socialDraftOf(network: SocialNetwork, raw: string): string | null {
  const result = normalizeSocialHandle(network, raw);
  return result.ok ? result.handle : raw.trim();
}

/**
 * O corpo do ✓ (`PUT /me/profile`): cada campo que o fã mexeu cujo valor limpo
 * difere do perfil de agora, mais o nome no perfil sem nome (como o cadastro
 * deixaria); as redes mexidas que diferem vão no `socials`; o @ só quando
 * `sendUsername` (o @ "Disponível" e o prazo livre). Os campos que o fã não
 * mexeu ficam fora: a tela os acompanha pelo perfil vivo, e comparar o
 * rascunho inteiro regravaria o que a Moderação ou outro aparelho mudou.
 */
export function changesOf(
  draft: EditProfileFormInput,
  touched: TouchedFields,
  profile: FanProfile,
  { sendUsername }: { sendUsername: boolean },
): ProfileChanges {
  const changes: ProfileChanges = {};
  const name = cleanLine(draft.name);
  if ((touched.name || profile.displayName === null) && name !== (profile.displayName ?? '')) {
    changes.displayName = name;
  }
  const username = normalizeUsername(draft.username);
  if (touched.username && sendUsername && username !== (profile.username ?? '')) {
    changes.username = username;
  }
  const bio = emptyToNull(cleanMultiline(draft.bio));
  if (touched.bio && bio !== (profile.bio ?? null)) changes.bio = bio;
  const city = emptyToNull(cleanLine(draft.city));
  if (touched.city && city !== (profile.city ?? null)) changes.city = city;
  const gender: Gender | null = draft.gender ?? null;
  if (touched.gender && gender !== (profile.gender ?? null)) changes.gender = gender;
  if (touched.privateAccount && draft.privateAccount !== (profile.privateAccount ?? false)) {
    changes.privateAccount = draft.privateAccount;
  }
  const socials: Partial<FanSocials> = {};
  for (const network of SOCIAL_NETWORKS) {
    if (!touched[network]) continue;
    const handle = socialDraftOf(network, draft[network]);
    if (handle !== (profile.socials?.[network] ?? null)) socials[network] = handle;
  }
  if (Object.keys(socials).length > 0) changes.socials = socials;
  return changes;
}

/** O corpo tem alguma coisa a gravar. */
export const hasChanges = (changes: ProfileChanges): boolean => Object.keys(changes).length > 0;
