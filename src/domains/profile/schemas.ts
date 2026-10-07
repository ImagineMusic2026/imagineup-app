import { z } from 'zod';

import { nameField } from '@/domains/auth/schemas';
import { t } from '@/i18n';
import { CITY_MAX, cleanLine, isVisibleLine } from '@/utils/visible-line';

/**
 * A cidade com as regras do `firestore.rules` (`validCity()`): opcional (vazia
 * vira `null`, que limpa o campo), uma linha visível de até 80 em UTF-16. O
 * texto colado perde os isolantes bidi e os espaços das pontas, como o nome.
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
 * Nome e cidade da tela "Editar perfil" (bloco 9), com as mesmas regras das
 * regras do Firestore: o nome é o campo do cadastro, sem cópia. O schema e as
 * regras andam juntos (`visible-line`): o `permission-denied` com valores que
 * passaram aqui é a trava de 10 s.
 */
export const editProfileSchema = z.object({
  name: nameField,
  city: cityField,
});

/** O que o formulário guarda (texto cru) e o que o envio recebe (já limpo). */
export type EditProfileFormInput = z.input<typeof editProfileSchema>;
export type EditProfileForm = z.output<typeof editProfileSchema>;
