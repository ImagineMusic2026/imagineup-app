import { z } from 'zod';

// Mensagens padrão do zod em pt-BR. Os schemas dos formulários ainda passam
// mensagens próprias via t(); isto cobre o que não tiver mensagem.
z.config(z.locales.ptBR());
