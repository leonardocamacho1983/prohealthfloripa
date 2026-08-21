# Plano de ações — Conselho de elite ProHealth

**Data:** 20 de agosto de 2026  
**Modelo de execução:** sequência contínua por dependências e critérios de aceite, sem estimativas em semanas  
**Escopo:** UI/UX, CX/CS, operação de atendimento, notificações, design conversacional, qualidade e governança.  
**Fora de escopo:** substituição da NexFit. A NexFit permanece como fonte de verdade operacional; a ProHealth continua usando dados derivados e cache com minimização de dados.

## Resultado esperado ao fim do ciclo

Ao concluir os marcos deste plano, a plataforma deve garantir que:

1. toda conversa tenha estado, responsável e autoria inequívocos;
2. toda transferência e encerramento tenha motivo rastreável;
3. inatividade, encerramento e reabertura sigam regras explícitas;
4. notificações respeitem o turno e sejam entregues com retentativa e auditoria;
5. mídia não suportada nunca fique sem resposta;
6. alterações de conhecimento passem por aprovação, versão e rollback;
7. operação e liderança acompanhem SLA, resolução, esforço e qualidade;
8. as principais telas tenham linguagem, componentes e acessibilidade consistentes.

## Princípios de execução

- Corrigir garantias operacionais antes do polimento visual.
- Um único estado canônico por conversa; não inferir estado apenas pela interface.
- Eventos importantes são auditáveis e idempotentes.
- Motivos usados no histórico são inativados, não apagados fisicamente.
- Notificações pessoais contêm o mínimo de dados necessário.
- Conhecimento de produção nunca é alterado diretamente por uma conversa de treinamento.
- A NexFit continua como fonte de verdade operacional durante todo este plano.
- Cada entrega inclui instrumentação, teste e critério de rollback.

## Responsabilidade de execução

O Codex implementa os marcos na ordem de dependência, preservando as mudanças existentes no repositório. Cada marco só avança depois de testes, lint, build e verificação proporcional ao risco. Operação e direção participam apenas das decisões de política que não podem ser inferidas com segurança, como o tempo de inatividade e as regras de escalonamento.

## Fase 0 — decisões e linha de base

**Entrada:** início do programa  
**Objetivo:** remover ambiguidades antes de alterar dados e fluxos.

### Ações

- Nomear Product Owner operacional e responsável pelas taxonomias.
- Definir a política de ownership: atribuição automática, primeiro a assumir ou fila de equipe.
- Definir os estados canônicos da conversa.
- Definir o significado de “encerrado” e de “reaberto”.
- Aprovar os motivos padrão de transferência e encerramento.
- Definir X minutos de inatividade e regras por horário útil.
- Definir SLA por prioridade e motivo.
- Definir conteúdo permitido no WhatsApp secundário.
- Medir baseline: volume, handoff, tempo até assumir, tempo até resolver, reabertura, falhas de entrega e cobertura de dados.
- Selecionar 20 conversas reais para corpus inicial de QA, com anonimização.

### Decisões que bloqueiam a implementação

1. Conversa atribuída pode ser assumida por outra pessoa sem transferência?
2. Encerramento devolve o cliente ao agente automático imediatamente?
3. A inatividade conta somente dentro do horário de atendimento?
4. O resumo de início de turno deve incluir toda a equipe ou apenas conversas atribuídas?
5. Quais categorias exigem revisão de alguém responsável por saúde/segurança?

### Critério de saída

- Políticas registradas e aprovadas.
- Taxonomias versão 1 definidas.
- Eventos e estados desenhados.
- Dashboard de baseline ou consulta reproduzível disponível.

## Fase 1 — fila confiável

**Entrada:** políticas e taxonomias mínimas definidas  
**Objetivo:** eliminar ambiguidade de responsabilidade, estado e encerramento.

### Epic 1. Ownership e autoria

**Backend e dados**

- Tornar claim/assunção atômico.
- Retornar conflito quando a conversa já estiver com outra pessoa.
- Validar ownership ao responder, transferir e encerrar.
- Registrar ator em mensagens e eventos humanos.
- Criar evento de transferência com origem, destino, motivo e nota.
- Adicionar auditoria de claim, transferência e liberação.

**Interface**

- Mostrar responsável no cabeçalho e na lista.
- Criar filtros “Minhas”, “Sem responsável” e “Equipe”.
- Exibir claramente “Atendimento automático”, “Aguardando atendente” e “Com [nome]”.
- Preservar rascunho e avisar quando a conversa mudar de responsável.

**Critérios de aceite**

- Duas pessoas tentando assumir simultaneamente produzem apenas um vencedor.
- Uma pessoa sem ownership não responde sem assumir ou receber transferência.
- Toda mensagem humana mostra autor.
- Toda transferência aparece no histórico interno e no log de auditoria.

### Epic 2. Motivos e ciclo de vida

**Dados e administração**

- Criar catálogos separados de transferência, encerramento humano e encerramento automático.
- Pré-cadastrar motivos padrão.
- Permitir criar, editar, ordenar e inativar.
- Impedir remoção física de motivo já utilizado.
- Registrar motivo, nota, ator, timestamp e origem automática/manual.

**Fluxos**

- Tornar motivo obrigatório antes de encerrar.
- Adicionar confirmação contextual, evitando `confirm()` genérico do navegador.
- Implementar “Aguardando cliente”.
- Encerrar automaticamente por inatividade configurável.
- Relacionar reabertura ao episódio anterior.
- Corrigir “visualizado”: registrar somente quando o painel estiver efetivamente visível/focado.

**Critérios de aceite**

- Não existe encerramento sem motivo válido.
- Motivos inativados permanecem legíveis no histórico.
- A inatividade gera motivo automático e evento de auditoria.
- Nova mensagem do cliente reabre/cria episódio relacionado sem perder o histórico.
- Atualização automática da página não marca conversa como lida.

### Marco 1

**Fila confiável:** responsabilidade, autoria, transferência, encerramento e reabertura funcionam de ponta a ponta.

## Fase 2 — notificação e resiliência conversacional

**Entrada:** fila confiável validada  
**Objetivo:** garantir que nenhum atendimento ou mídia fique silenciosamente perdido.

### Epic 3. Agente notificador durável

**Arquitetura**

- Criar outbox de notificações e histórico de tentativas.
- Separar criação da notificação de sua entrega no WhatsApp.
- Garantir idempotência por evento, destinatário e tipo.
- Implementar retentativas com backoff e fila de falhas.
- Registrar status: pendente, enviado, entregue quando disponível, falhou, cancelado e reconhecido.
- Manter cron apenas como reconciliação/rede de segurança.

**Regras**

- Respeitar horário, fuso, dias ativos, pausas e ausência.
- Enviar resumo no início individual do turno, por maior espera.
- Não notificar fora do turno; acumular para o resumo seguinte.
- Cancelar lembrete quando a conversa for assumida.
- Escalar quando SLA estiver próximo de vencer.
- Não incluir transcript completo ou dado sensível no número secundário.

**Mensagem base**

> Oi, {nome_do_atendente}. Um cliente foi transferido para você.\n\nNecessidade: {resumo_mínimo}.\nMotivo: {motivo_da_transferência}.\nTempo de espera: {tempo}.\n\nAbra a plataforma para assumir o atendimento. Ao concluir, selecione o motivo e use “Encerrar atendimento” para devolver o contato ao atendimento automático.

**Critérios de aceite**

- Reiniciar o worker não perde notificações.
- A mesma transferência não gera mensagens duplicadas.
- Fora do turno não há envio individual.
- O resumo de início de turno respeita maior espera.
- Falhas ficam visíveis e podem ser reprocessadas.

### Epic 4. Mídia, reparo e fechamento conversacional

- Transcrever áudio quando houver base legal, consentimento/regra adequada e suporte técnico.
- Para imagem/documento não interpretado, acusar recebimento e explicar a próxima ação.
- Encaminhar ao humano quando a mídia for necessária para resolver.
- Quando houver sinal de satisfação, perguntar se pode encerrar.
- Criar respostas curtas: conclusão primeiro, uma pergunta por vez.
- Diferenciar “solicitação enviada” de “ação confirmada”.
- Registrar promessas com dono, prazo e status.

**Critérios de aceite**

- Todo tipo de mídia suportado pelo webhook recebe resposta ou handoff explícito.
- O cliente nunca recebe confirmação de ação ainda não concluída.
- Fechamento por satisfação exige confirmação ou regra documentada.

### Marco 2

**Nenhum atendimento perdido:** notificações são duráveis e nenhuma mídia fica sem retorno.

## Fase 3 — qualidade, treinamento e CX

**Entrada:** notificações e ciclo de vida instrumentados  
**Objetivo:** criar um ciclo seguro de melhoria e medir sucesso do cliente.

### Epic 5. Governança do treinamento

- Corrigir o layout do formulário e da lista.
- Criar estados: proposta, em revisão, aprovada, rejeitada, publicada e revertida.
- Adicionar aprovar, rejeitar, solicitar ajuste, publicar e rollback.
- Exigir fonte, evidência, categoria, risco e justificativa.
- Registrar autor, revisor e versão.
- Definir SLA de revisão e alertar item vencido.
- Criar revisão reforçada para conteúdo clínico, preço, disponibilidade e promessa operacional.
- Impedir que `analysis_fallback` seja publicado sem revisão explícita.

**Critérios de aceite**

- Nenhuma proposta altera produção sem aprovação.
- Toda publicação tem versão, responsável e rollback testado.
- Itens vencidos aparecem no centro de ação.

### Epic 6. Métricas de CX e qualidade

- Instrumentar tempo até assumir, tempo até resolver e abandono.
- Instrumentar FCR, reabertura e motivo de handoff/encerramento.
- Implementar CSAT e CES pós-atendimento com amostragem apropriada.
- Medir repetição de informação e cumprimento de promessas.
- Criar scorecard de QA para IA e humano.
- Avaliar corpus ouro em cada alteração relevante da IA.
- Levar alertas operacionais para a fila, não apenas para Métricas.

**North Star**

> Necessidades resolvidas com baixo esforço e compromissos cumpridos.

**Guardrails**

- segurança e precisão;
- CSAT/CES;
- FCR e reabertura;
- handoff correto;
- tempo dentro do SLA;
- falhas e duplicidade;
- opt-out e reclamações.

**Critérios de aceite**

- Cada atendimento encerrado alimenta os indicadores de desfecho.
- Métricas distinguem cobertura de instrumentação e resultado.
- Uma regressão crítica no corpus impede publicação da mudança de IA.

### Marco 3

**Ciclo de melhoria seguro:** a ProHealth aprende com evidência, aprovação e resultado medido.

## Fase 4 — experiência consistente e acessível

**Entrada:** garantias operacionais e métricas principais estabilizadas  
**Objetivo:** reduzir esforço cognitivo e criar base de escala visual.

### Epic 7. App Shell e design system

- Consolidar navegação, cabeçalhos e identidade da conta.
- Criar tokens de cor, tipografia, espaçamento, borda, sombra e movimento.
- Padronizar botões, inputs, chips, badges, alertas, estados vazios e diálogos.
- Criar glossário de estados e ações.
- Remover duplicação de CSS de alto impacto.
- Documentar componentes e critérios de uso.

### Epic 8. Acessibilidade e mobile

- Corrigir contraste, foco, teclado e alvos de toque conforme WCAG 2.2.
- Respeitar `prefers-reduced-motion`.
- Validar leitura por leitor de tela nas tarefas críticas.
- Redesenhar mobile como fluxo lista → conversa → contexto, não como três colunas empilhadas.
- Manter compositor fixo e navegação de retorno clara.
- Testar em aparelhos reais e com rede instável.

### Epic 9. Onboarding operacional

- Transformar telefone secundário e horário pendentes em checklist de ativação.
- Exibir status de notificações no perfil.
- Permitir teste de envio.
- Mostrar último acesso, disponibilidade e carga na gestão de usuários.
- Adicionar suspensão de acesso e cancelamento/reenvio de convite.

**Critérios de aceite**

- Tarefas críticas funcionam por teclado.
- Estados e ações têm o mesmo nome em todas as telas.
- Perfil mostra claramente se o atendente pode receber notificações.
- Fluxo mobile é validado em dispositivo real por atendente.

### Marco 4

**Produto coerente:** operação principal consistente, acessível e preparada para novos módulos sem fragmentação.

## Backlog priorizado

### P0 — iniciar agora

1. Ownership atômico e autoria.
2. Catálogos de motivos.
3. Encerramento, inatividade e reabertura.
4. Correção do “visualizado”.
5. Outbox do agente notificador.
6. Resposta segura para mídia não textual.
7. Governança mínima do treinamento.

### P1 — após as garantias operacionais

8. SLA em horário útil e alertas na fila.
9. CSAT, CES, FCR e reabertura.
10. Promessas e próximas ações.
11. Scorecards e corpus ouro.
12. Onboarding de perfil e usuários.
13. Atualizações em tempo real preservando rascunho/foco.

### P2 — escala e refinamento

14. App Shell e design system.
15. Mobile operacional.
16. Workforce: pausas, ausências, capacidade e competências.
17. Customer 360 mais amplo, continuando a usar a NexFit como fonte operacional.

## Sequência técnica de entrega

Para cada epic:

1. decisão de produto e mapa de estados;
2. evento/modelo de dados e migração compatível;
3. API idempotente e autorização;
4. interface e conteúdo;
5. instrumentação e auditoria;
6. testes unitários, integração e fluxo crítico;
7. ativação por feature flag;
8. piloto com admin e um atendente;
9. rollout gradual;
10. monitoramento e rollback.

## Ritual do conselho

### Revisão operacional recorrente

- SLAs vencidos e atendimentos abandonados.
- Falhas de notificação e duplicidade.
- Conversas reabertas e promessas vencidas.
- Incidentes de segurança, privacidade ou conteúdo.
- Bloqueios do roadmap.

### Calibração de qualidade recorrente

- Revisar cinco conversas da IA e cinco humanas.
- Calibrar scorecard de qualidade.
- Revisar detratores e reclamações.
- Aprovar mudanças de taxonomia e conhecimento.

### Conselho de produto e experiência

- North Star e guardrails.
- Decisões de priorização.
- Pesquisa com atendentes e clientes.
- Dívida operacional, técnica e de experiência.

## Definition of Done geral

Uma ação só é concluída quando:

- comportamento e estado estão documentados;
- autorização e privacidade foram revisadas;
- existe log/auditoria para ações sensíveis;
- métricas de sucesso e falha estão disponíveis;
- testes automatizados cobrem regras críticas;
- fluxo foi validado por alguém da operação;
- acessibilidade básica foi verificada;
- existe plano de rollout e rollback;
- documentação operacional foi atualizada.

## Decisão de início recomendada

Executar primeiro o marco **Fila confiável**, contendo:

1. ownership e autoria;
2. motivos administráveis;
3. encerramento, inatividade e reabertura;
4. correção de visualização/leitura;
5. instrumentação básica dos novos eventos.

Esse pacote resolve o maior risco atual e cria a base necessária para o agente notificador, métricas de CX e treinamento governado.
