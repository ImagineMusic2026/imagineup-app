import { z } from 'zod';

import { t } from '@/i18n';
import { cleanMultiline, isVisibleMultiline } from '@/utils/visible-line';

/** Limite do comentário, em unidades de UTF-16, como o `maxLength` do campo e o servidor. */
export const COMMENT_MAX_LENGTH = 500;

/**
 * O comentário limpo e validado igual ao servidor (`parseCommentText`,
 * docs/arquitetura-api.md, 21.1, decisão 20): `cleanMultiline` e, depois, de 1
 * a 500 unidades de UTF-16 (num `refine`: o `.max()` do zod 4 conta pontos de
 * código) com toda linha visível. O texto limpo é o que vai e o que a linha
 * local mostra.
 */
export const commentSchema = z.object({
  text: z
    .string()
    .transform(cleanMultiline)
    .pipe(
      z
        .string()
        .min(1, { error: t('validation.commentEmpty') })
        .refine((text) => text.length <= COMMENT_MAX_LENGTH, {
          error: t('validation.commentMax', { max: COMMENT_MAX_LENGTH }),
        })
        .refine(isVisibleMultiline, { error: t('validation.commentInvisible') }),
    ),
});

export type CommentForm = z.infer<typeof commentSchema>;
