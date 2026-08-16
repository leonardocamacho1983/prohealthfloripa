# ProHealth Floripa

Aplicação Next.js com WhatsApp via Zernio, respostas pelo Vercel AI Gateway, memória persistente no Neon Postgres e contexto de clientes em modo somente leitura pela Nextfit.

## Desenvolvimento local

```bash
npm install
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000). O endpoint de saúde está disponível em `GET /api/health`.

Crie um `.env.local` a partir do `.env.example` e preencha localmente:

- `AI_GATEWAY_API_KEY`: chave do Vercel AI Gateway. Na Vercel, reutilize a Shared Environment Variable existente; não crie outra chave.
- `DATABASE_URL`: conexão server-only criada automaticamente pela integração Neon. Não exponha no cliente.
- `NEXTFIT_API_KEY`: chave da API pública da Nextfit. É usada somente no servidor pelo cabeçalho `X-Api-Key`.
- `ZERNIO_API_KEY`: chave de API da Zernio com permissão de escrita no Inbox.
- `ZERNIO_WEBHOOK_SECRET`: segredo forte definido por você e repetido na configuração do webhook da Zernio.
- `HANDOFF_ACCESS_SECRET`: chave forte usada pela Bia para entrar na caixa de atendimentos em `/handoff`.
- `HANDOFF_ATTENDANT_PHONE`: telefone da Bia em formato internacional, sem espaços (ex.: `55...`).
- `ZERNIO_HANDOFF_TEMPLATE_NAME`: nome do template aprovado para avisar a Bia sobre um novo atendimento.
- `ZERNIO_HANDOFF_TEMPLATE_LANGUAGE`: idioma do template; por padrão, `pt_BR`.
- `APP_URL`: URL pública da aplicação, por exemplo `https://prohealthfloripa.vercel.app`.

## Verificação

```bash
npm run lint
npm test
npm run build
```

## Deploy na Vercel

Vincule `AI_GATEWAY_API_KEY`, conecte o banco Neon para fornecer `DATABASE_URL`, cadastre as variáveis Zernio e faça um novo deploy. A aplicação aplica a evolução idempotente de `migrations/0002_handoffs.sql` automaticamente no primeiro acesso; o arquivo permanece versionado para auditoria e execução manual, se desejado.

## Zernio Sandbox

1. No dashboard da Zernio, ative uma sessão da WhatsApp Sandbox para o telefone de teste e responda à mensagem `sandbox_start` recebida. A sessão precisa estar `active`.
2. Crie um webhook com a URL `https://prohealthfloripa.vercel.app/api/webhooks/zernio`.
3. Habilite somente o evento `message.received`.
4. Configure no webhook o mesmo segredo cadastrado como `ZERNIO_WEBHOOK_SECRET` na Vercel.
5. Use o teste de webhook da Zernio para confirmar HTTP 200.
6. Envie uma mensagem de texto do telefone ativado para o número compartilhado da sandbox. Dentro da janela de atendimento de 24 horas, a mensagem receberá uma resposta gerada pelo modelo através do AI Gateway.

As 12 mensagens mais recentes formam a memória curta. O Neon guarda contatos, conversas, mensagens e um snapshot normalizado da Nextfit em `customer_profiles`. Em **Vercel → Project → Logs**, filtre por `/api/webhooks/zernio`. Os logs não incluem texto, telefone, payload ou credenciais.

## Contexto Nextfit

A integração usa exclusivamente os endpoints `GET` oficiais:

- `/Pessoa/GetClientes` e `/Pessoa/GetLeads` para identificação por telefone;
- `/ContratoCliente` e `/ContratoBase` para contratos e nomes dos planos;
- `/ContaReceber` para situação financeira objetiva;
- `/Venda` para resumo dos serviços comprados;
- `/Agenda` para última/próxima visita e métricas de presença.

A API não oferece filtro por telefone, portanto clientes e leads são paginados e comparados localmente por número brasileiro normalizado e exato. Resultados ausentes ou ambíguos permanecem `unknown`. Um registro de lead vira `lead`; um cliente com contrato vigente vira `customer`; cliente inativo ou apenas com contratos históricos vira `former_customer`. A API pública atual não sustenta uma classificação distinta de `prospect`, por isso ela não é inventada.

O snapshot geral é reutilizado por 6 horas. Perguntas sobre agenda, contrato ou financeiro podem atualizá-lo depois de 15 minutos. Dados voláteis com mais de 24 horas não são enviados ao modelo. A aplicação não grava nada na Nextfit e continua respondendo se o serviço estiver indisponível.

Para testar, envie uma mensagem pelo número de WhatsApp que também esteja cadastrado na Nextfit. Perguntas como “quando vence meu plano?” ou “quando é minha próxima visita?” usam o snapshot atual quando esses dados existirem. Confirme a execução nos logs da Vercel e, no Neon, verifique `contacts.relationship_status`, `customer_profiles.external_customer_id`, `source` e `synced_at`.

## Atendimento humano

Quando o cliente pede uma pessoa ou a conversa entra em uma regra sensível, o agente confirma a transferência e fica em silêncio. A espera não expira, inclusive fora do horário de atendimento. A Bia responde em `https://prohealthfloripa.vercel.app/handoff`; a mensagem continua saindo pelo número principal da ProHealth. Ao encerrar, o agente volta a atender. Como proteção contra atendimentos esquecidos abertos, somente uma conversa já assumida expira após 12 horas sem atividade.

A caixa atualiza automaticamente a cada 15 segundos, separa conversas aguardando e assumidas, destaca novas mensagens e exige confirmação antes de devolver o atendimento ao agente. As ações de solicitar, assumir, responder e encerrar são registradas como eventos operacionais sem copiar o conteúdo das mensagens para o log de auditoria.

Para receber o aviso no WhatsApp da Bia, crie na Zernio um template utilitário com quatro variáveis, nesta ordem: **nome do cliente**, **motivo**, **resumo** e **link da conversa**. Cadastre o nome e o idioma nas variáveis acima. A notificação é opcional: mesmo sem o template, as conversas aparecem na caixa protegida.
