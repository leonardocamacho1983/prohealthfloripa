# Implantação executada — Conselho de elite ProHealth

**Produção:** 20 de agosto de 2026  
**Schema:** versão 20 validada no Neon de produção  
**Estratégia:** migrations aditivas e recursos novos desligados por padrão.

## Entregas

| Gate | Resultado implantado |
|---|---|
| A — workflow | eventos estruturados, versionamento de ownership, transferência atômica, “Aguardando cliente”, conflito seguro e rascunho local |
| B — operação | outbox observável, tentativas de entrega, saúde do notificador, calendário útil, SLA e centro de ação priorizado |
| C — CX | desfechos canônicos, pesquisa amostral com opt-in operacional, promessas com prazo e reabertura relacionada |
| D — conhecimento | change sets, avaliação bloqueante, versão ativa consumida pelo agente, publicação e rollback transacional |
| E — experiência | tokens semânticos, foco e motion acessíveis, vocabulário central, mobile mestre-detalhe e suíte E2E |
| F — workforce | conta Clerk ativa, horário, presença, exceções, competências, capacidade, prontidão e distribuição segura |

## Administração

- `/admin/features` — ativação controlada e kill switches;
- `/admin/workforce` — capacidade, competências e exceções de escala;
- `/admin/knowledge` — publicação, histórico e rollback;
- `/admin/cx` — amostragem e janela de pesquisa;
- `/admin/reasons` — motivos de passagem e encerramento;
- `/admin/maintenance` — validação idempotente do schema;
- `/profile` — escala, segundo WhatsApp, teste de notificação e presença.

## Evidências de validação

- `npm run verify`: aprovado;
- 389 testes unitários: aprovados;
- 65 casos do corpus de avaliação: aprovados;
- build Next.js de produção: aprovado;
- E2E público desktop e mobile: 4 aprovados;
- E2E autenticado: 4 cenários instalados, executáveis com sessão exclusiva de teste;
- integração de migrations: runner isolado instalado; exige `TEST_DATABASE_URL` e nunca usa produção;
- smoke autenticado em produção: Atendimento, Recursos, Workforce, Conhecimento e Perfil carregados;
- schema de produção: validado na versão 20.

## Ativação operacional segura

1. manter todas as flags novas desligadas após o deploy;
2. configurar o atendente de teste e entregar a notificação de teste;
3. ativar `conversation_transfer` e `awaiting_customer` para validar ownership;
4. ativar `sla_engine` e observar prazos;
5. ativar `promises`;
6. manter `cx_surveys` com amostragem zero até aprovação do texto;
7. publicar conhecimento somente após o corpus aprovar;
8. ativar `workforce_routing` somente quando ao menos um perfil estiver pronto;
9. desligar a flag correspondente como primeiro rollback operacional.
