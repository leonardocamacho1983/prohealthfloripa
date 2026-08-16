# ProHealth Floripa

Aplicação Next.js com webhook para validar mensagens da sandbox de WhatsApp da Zernio.

## Desenvolvimento local

```bash
npm install
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000). O endpoint de saúde está disponível em `GET /api/health`.

Crie um `.env.local` a partir do `.env.example` e preencha localmente:

- `ZERNIO_API_KEY`: chave de API da Zernio com permissão de escrita no Inbox.
- `ZERNIO_WEBHOOK_SECRET`: segredo forte definido por você e repetido na configuração do webhook da Zernio.

## Verificação

```bash
npm run lint
npm test
npm run build
```

## Deploy na Vercel

Cadastre `ZERNIO_API_KEY` e `ZERNIO_WEBHOOK_SECRET` nas variáveis do ambiente Production e faça um novo deploy.

## Zernio Sandbox

1. No dashboard da Zernio, ative uma sessão da WhatsApp Sandbox para o telefone de teste e responda à mensagem `sandbox_start` recebida. A sessão precisa estar `active`.
2. Crie um webhook com a URL `https://prohealthfloripa.vercel.app/api/webhooks/zernio`.
3. Habilite somente o evento `message.received`.
4. Configure no webhook o mesmo segredo cadastrado como `ZERNIO_WEBHOOK_SECRET` na Vercel.
5. Use o teste de webhook da Zernio para confirmar HTTP 200.
6. Envie uma mensagem de texto do telefone ativado para o número compartilhado da sandbox. Dentro da janela de atendimento de 24 horas, a resposta será `ProHealth teste recebido: <mensagem>`.

Em **Vercel → Project → Logs**, filtre por `/api/webhooks/zernio`. Os logs registram apenas IDs e o resultado do envio, sem texto, telefone, payload ou credenciais. No dashboard da Zernio, consulte **Webhook logs** para confirmar a entrega do evento e o Inbox da conversa para confirmar a mensagem enviada.
