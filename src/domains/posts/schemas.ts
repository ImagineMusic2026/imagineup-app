import { z } from 'zod';

import { t } from '@/i18n';

export const COMMENT_MAX_LENGTH = 500;

export const commentSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, { error: t('validation.commentEmpty') })
    .max(COMMENT_MAX_LENGTH, { error: t('validation.commentMax', { max: COMMENT_MAX_LENGTH }) }),
});

export type CommentForm = z.infer<typeof commentSchema>;
