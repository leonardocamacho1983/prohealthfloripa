# ProHealth Floripa

Aplicação Next.js com webhook da sandbox de WhatsApp da Zernio, respostas pelo Vercel AI Gateway e memória persistente no Neon Postgres.

## Desenvolvimento local

```bash
npm install
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000). O endpoint de saúde está disponível em `GET /api/health`.

Crie um `.env.local` a partir do `.env.example` e preencha localmente:

- `AI_GATEWAY_API_KEY`: chave do Vercel AI Gateway. Na Vercel, reutilize a Shared Environment Variable existente; não crie outra chave.
- `DATABASE_URL`: conexão server-only criada automaticamente pela integração Neon. Não exponha no cliente.
- `ZERNIO_API_KEY`: chave de API da Zernio com permissão de escrita no Inbox.
- `ZERNIO_WEBHOOK_SECRET`: segredo forte definido por você e repetido na configuração do webhook da Zernio.

## Verificação

```bash
npm run lint
npm test
npm run build
```

## Deploy na Vercel

Vincule `AI_GATEWAY_API_KEY`, conecte o banco Neon para fornecer `DATABASE_URL`, cadastre as variáveis Zernio e faça um novo deploy. Aplique `migrations/0001_customer_context.sql` uma vez no banco antes de testar mensagens.

## Zernio Sandbox

1. No dashboard da Zernio, ative uma sessão da WhatsApp Sandbox para o telefone de teste e responda à mensagem `sandbox_start` recebida. A sessão precisa estar `active`.
2. Crie um webhook com a URL `https://prohealthfloripa.vercel.app/api/webhooks/zernio`.
3. Habilite somente o evento `message.received`.
4. Configure no webhook o mesmo segredo cadastrado como `ZERNIO_WEBHOOK_SECRET` na Vercel.
5. Use o teste de webhook da Zernio para confirmar HTTP 200.
6. Envie uma mensagem de texto do telefone ativado para o número compartilhado da sandbox. Dentro da janela de atendimento de 24 horas, a mensagem receberá uma resposta gerada pelo modelo através do AI Gateway.

As 12 mensagens mais recentes da conversa são usadas como memória curta. O Neon guarda o contato, a conversa e as mensagens; a tabela `customer_profiles` permanece vazia até uma futura integração autorizada com a Nextfit. Em **Vercel → Project → Logs**, filtre por `/api/webhooks/zernio`. Os logs registram apenas IDs e resultado, sem texto, telefone, payload ou credenciais.
