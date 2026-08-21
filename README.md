# ProHealth Floripa

Aplicação Next.js com WhatsApp via Zernio, respostas pelo Vercel AI Gateway, memória persistente no Neon Postgres e contexto de clientes em modo somente leitura pela Nextfit.

## Desenvolvimento local

```bash
npm install
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000). O endpoint de saúde está disponível em `GET /api/health`.

Crie um `.env.local` a partir do `.env.example` e preencha localmente:

- `AI_GATEWAY_API_KEY`: chave do Vercel AI Gateway para execução fora da Vercel. Em produção, o deploy usa automaticamente `VERCEL_OIDC_TOKEN`.
- `WHATSAPP_AI_MODEL` e `WHATSAPP_AI_FALLBACK_MODELS`: modelo principal de resposta e cadeia de reserva, separados por vírgula. O padrão usa GPT-5.4 mini com Gemini 3 Flash como reserva.
- `SEMANTIC_AI_MODEL` e `SEMANTIC_AI_FALLBACK_MODELS`: modelo principal e reservas da interpretação semântica. O padrão tenta GPT-5.4 mini, Gemini 3 Flash e GPT-5.4 nano.
- `DATABASE_URL`: conexão server-only criada automaticamente pela integração Neon. Não exponha no cliente.
- `NEXTFIT_API_KEY`: chave da API pública da Nextfit. É usada somente no servidor pelo cabeçalho `X-Api-Key`.
- `NEXTFIT_BOOKING_URL`: opcional; URL HTTPS do site oficial de agendamentos da Nextfit. Quando presente, pedidos de agendamento são conduzidos para a disponibilidade e confirmação oficiais, sem o agente inventar vagas.
- `ZERNIO_API_KEY`: chave de API da Zernio com permissão de escrita no Inbox.
- `ZERNIO_WEBHOOK_SECRET`: segredo forte definido por você e repetido na configuração do webhook da Zernio.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: chave publicável do Clerk, sincronizada automaticamente pela integração Clerk da Vercel.
- `CLERK_SECRET_KEY`: chave server-only do Clerk, sincronizada automaticamente pela integração Clerk da Vercel. Nunca a exponha no cliente.
- `ZERNIO_HANDOFF_TEMPLATE_NAME`: opcional; sobrescreve o nome padrão do modelo aprovado para avisar sobre um novo atendimento.
- `ZERNIO_SHIFT_DIGEST_TEMPLATE_NAME`: opcional; sobrescreve o nome padrão do modelo do resumo de início do turno.
- `ZERNIO_HANDOFF_TEMPLATE_LANGUAGE`: idioma do template; por padrão, `pt_BR`.
- `APP_URL`: URL pública da aplicação, por exemplo `https://prohealthfloripa.vercel.app`.
- `CRON_SECRET`: segredo forte usado pela Vercel para autenticar as rotinas de catálogo e início de turno.
- `JOURNEY_ENGINE_MODE`: opcional; aceita `off`, `shadow` ou `active`. Sem valor explícito, previews e desenvolvimento usam `active`, enquanto produção usa `shadow` para observar a nova jornada sem alterar a resposta enviada.
- `SEMANTIC_PLANNER_MODE`: opcional; aceita `off`, `shadow` ou `active`. Em `shadow`, registra o plano sem alterar a precedência atual; em `active`, o plano semântico e o gerador natural respondem antes dos templates da jornada. O padrão é `active` em Preview/desenvolvimento e `shadow` em produção.

## Verificação

```bash
npm run lint
npm test
npm run test:integration
npm run test:evaluation
npm run test:e2e
npm run build
```

Os testes de integração exigem `TEST_DATABASE_URL` e criam um schema efêmero isolado; nunca reutilizam `DATABASE_URL`. Os cenários públicos E2E rodam sem credenciais. Para validar a caixa autenticada, informe `PLAYWRIGHT_STORAGE_STATE` com uma sessão exclusiva de teste.

## Deploy na Vercel

Use Node.js 22 ou superior. Fora da Vercel, configure `AI_GATEWAY_API_KEY`; nos deployments da Vercel, a autenticação OIDC é automática. Conecte o banco Neon para fornecer `DATABASE_URL`, mantenha a integração Clerk conectada aos ambientes desejados, cadastre as variáveis Zernio e `CRON_SECRET` e faça um novo deploy. A integração Clerk fornece `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` e `CLERK_SECRET_KEY`; não crie cópias dessas chaves. A Vercel provisiona os consumidores de Queue descritos em `vercel.json`; não é necessária uma credencial adicional para as filas. A aplicação aplica de forma idempotente as evoluções operacionais de banco até `migrations/0021_conversation_burst_batching.sql` no primeiro uso. Administradores também podem validar explicitamente o schema em `/admin/maintenance`.

## Zernio Sandbox

1. No dashboard da Zernio, ative uma sessão da WhatsApp Sandbox para o telefone de teste e responda à mensagem `sandbox_start` recebida. A sessão precisa estar `active`.
2. Crie um webhook com a URL `https://prohealthfloripa.vercel.app/api/webhooks/zernio`.
3. Habilite somente o evento `message.received`.
4. Configure no webhook o mesmo segredo cadastrado como `ZERNIO_WEBHOOK_SECRET` na Vercel.
5. Use o teste de webhook da Zernio para confirmar HTTP 200.
6. Envie uma mensagem de texto do telefone ativado para o número compartilhado da sandbox. Dentro da janela de atendimento de 24 horas, a mensagem receberá uma resposta gerada pelo modelo através do AI Gateway.

As mensagens recebidas em sequência usam uma janela adaptativa: saudações podem ser acolhidas rapidamente, enquanto frases curtas ou incompletas aguardam mais tempo para reunir uma rajada. Cada mensagem nova reinicia essa janela. O Neon controla revisões, lease e idempotência; a Vercel Queue executa o turno com retry. Uma resposta calculada para uma revisão antiga é descartada antes do envio, inclusive durante a margem final anterior ao envio, e a revisão nova considera todos os pedidos acumulados. Em **Vercel → Project → Logs**, filtre por `/api/webhooks/zernio` para ingestão e `/api/queues/whatsapp-turn` para processamento. Os logs não incluem texto, telefone, payload ou credenciais.

A jornada comercial guarda somente estado estruturado e minimizado — objetivo, serviço escolhido, fatos já informados, oferta e preferência de agenda — sem copiar a queixa bruta. Respostas críticas de recomendação, valor, primeira banheira e coleta de agenda usam política determinística; dúvidas abertas continuam no modelo com contexto seletivo. O modo `shadow` registra a decisão candidata, mas preserva integralmente a resposta do fluxo anterior.

## Modo de treinamento

Um administrador pode vincular uma conversa existente como treinador. A partir daí, textos e áudios desse contato são processados em uma fila isolada, sem consulta à Nextfit e sem alterar automaticamente o atendimento. Cada entrada vira uma proposta comentada. O comando exato `TREINAMENTO CONCLUÍDO` congela o lote e abre uma janela de revisão de até 8 horas. Áudios são baixados pela API autenticada da Zernio e transcritos pelo Vercel AI Gateway; nenhuma chave adicional é necessária.

## Contexto Nextfit

A integração usa exclusivamente os endpoints `GET` oficiais:

- `/Pessoa/GetClientes` e `/Pessoa/GetLeads` para identificação por telefone;
- `/ContratoCliente` e `/ContratoBase` para contratos e nomes dos planos;
- `/ContaReceber` para situação financeira objetiva;
- `/Venda` para resumo dos serviços comprados;
- `/Agenda` para última/próxima visita e métricas de presença.

A API não oferece filtro por telefone, portanto clientes e leads são paginados e comparados localmente por número brasileiro normalizado e exato. Resultados ausentes ou ambíguos permanecem `unknown`. Um registro de lead vira `lead`; um cliente com contrato vigente vira `customer`; cliente inativo ou apenas com contratos históricos vira `former_customer`. A API pública atual não sustenta uma classificação distinta de `prospect`, por isso ela não é inventada.

O snapshot geral é reutilizado por 6 horas. Perguntas sobre agenda, contrato ou financeiro podem atualizá-lo depois de 15 minutos. Dados voláteis com mais de 24 horas não são enviados ao modelo. A aplicação não grava nada na Nextfit e continua respondendo se o serviço estiver indisponível.

A API pública contratada da Nextfit é somente leitura. O endpoint `/Agenda` é usado para compromissos do cliente, mas a aplicação não deriva vagas livres sem capacidade e regras oficiais. Quando `NEXTFIT_BOOKING_URL` estiver configurada, o agente direciona a pessoa ao site oficial para consultar a disponibilidade atual e concluir a reserva. Sem esse link, oferece handoff interno; nunca declara um horário reservado nem manda o cliente para o mesmo número em que já está falando.

Os nomes ativos de contratos/produtos são copiados para um cache derivado no Neon, mantendo a Nextfit como fonte oficial. A sincronização ocorre diariamente pela Vercel Cron e pode ser antecipada pelo botão **Atualizar catálogo** na caixa de atendimento. Como a API pública atual da Nextfit não documenta webhook de alteração de catálogo, nenhum payload de webhook foi inventado. O cache confirma somente nome e existência; preço, duração e benefício continuam vindo de dados explicitamente confirmados.

Para testar, envie uma mensagem pelo número de WhatsApp que também esteja cadastrado na Nextfit. Perguntas como “quando vence meu plano?” ou “quando é minha próxima visita?” usam o snapshot atual quando esses dados existirem. Confirme a execução nos logs da Vercel e, no Neon, verifique `contacts.relationship_status`, `customer_profiles.external_customer_id`, `source` e `synced_at`.

## Acesso da equipe

Acesse `https://prohealthfloripa.vercel.app/sign-in` e entre pelo método habilitado no Clerk. O e-mail primário verificado `leonardocamacho@gmail.com` recebe a função inicial de administrador no primeiro acesso caso ainda não tenha uma função definida. Depois disso, administradores podem convidar usuários e definir as funções **atendente**, **administrador** e, quando permitido, **proprietário** em `/admin/users`. Convites pendentes oferecem um link direto e a opção **Reenviar**, caso o e-mail transacional não chegue.

As permissões são verificadas no servidor. Atendentes operam a caixa; administradores e proprietários também gerenciam usuários, sincronizam o catálogo e acessam os indicadores. Alterações administrativas e ações de atendimento geram auditoria operacional sem conteúdo das mensagens, telefones ou credenciais.

## Atendimento humano

Quando o cliente pede uma pessoa ou a conversa entra em uma regra sensível, o agente confirma a transferência e fica em silêncio. A espera não expira, inclusive fora do horário de atendimento. A atendente entra com sua conta individual do Clerk e responde em `https://prohealthfloripa.vercel.app/handoff`; a mensagem continua saindo pelo número principal da ProHealth. Ao encerrar, o agente volta a atender. Como proteção contra atendimentos esquecidos abertos, somente uma conversa já assumida expira após 12 horas sem atividade.

Cada pessoa configura em `/profile` o segundo WhatsApp e seu horário semanal em `America/Sao_Paulo`. Novos handoffs são distribuídos somente entre atendentes em expediente; fora dele, nenhum aviso externo é enviado. Ao salvar o perfil, o agente notificador agenda o próximo início de turno na fila durável; após executar, agenda o turno seguinte. A rotina periódica permanece somente como reconciliação de segurança. O resumo é enviado no máximo uma vez por turno, com as conversas pendentes ordenadas da maior para a menor espera. O texto enviado ao segundo número usa apenas o motivo estruturado do handoff, sem copiar o histórico da conversa.

A caixa atualiza automaticamente a cada 15 segundos, inclui busca por nome ou telefone, filtros de não lidas e paradas, ordenação por tempo de espera, respostas rápidas, notas internas e um painel do cliente com o contexto disponível na Nextfit. Ela separa conversas do agente, aguardando, assumidas e encerradas, destaca novas mensagens e exige um motivo estruturado antes de devolver o atendimento ao agente. Quando o cliente sinaliza satisfação, o agente automático pede autorização explícita antes de encerrar; uma nova mensagem cria automaticamente um episódio relacionado e ativo.

O painel `/metrics` mostra volume, latências p50/p95, cobertura, handoffs, falhas de entrega, saúde do catálogo e alertas operacionais. Valores comerciais aparecem apenas como eventos associados com evidência; não são atribuídos causalmente ao agente. Indicadores de intenção, reparo, duplicação e ordem permanecem explicitamente indisponíveis enquanto a instrumentação correspondente não tiver amostras.

Os recursos novos são liberados por flags seguras em `/admin/features`. Transferência, “Aguardando cliente”, SLA, pesquisas de CX, promessas, conhecimento publicado, nova interface e roteamento por workforce começam desligados. A escala avançada, capacidade, competências e exceções ficam em `/admin/workforce`; versões de conhecimento, avaliações e rollback ficam em `/admin/knowledge`.

Alertas de novos handoffs também são registrados no painel. Administradores podem usar **Meu perfil → Criar ou verificar modelos** para cadastrar programaticamente na Zernio os modelos utilitários `prohealth_handoff_alert_v1` e `prohealth_shift_digest_v1`. A operação é idempotente: modelos existentes são preservados e modelos novos ficam pendentes até a aprovação da Meta. Mesmo sem a notificação externa, as conversas continuam visíveis na caixa protegida.
