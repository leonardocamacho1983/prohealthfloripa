# Plano de execução — Conselho de elite ProHealth

**Data-base:** 20 de agosto de 2026  
**Responsável técnico:** Codex  
**Modelo:** execução contínua por dependências, critérios de aceite e gates de publicação — sem estimativas em semanas.  
**Fonte estratégica:** `docs/plano-acoes-conselho-elite-2026-08-20.md`  
**Fora de escopo:** substituição da NexFit. A NexFit continua como fonte de verdade operacional.

## 1. Objetivo de execução

Transformar a plataforma atual em uma operação de atendimento confiável, mensurável, acessível e evolutiva, sem interromper o atendimento existente e sem depender de um cronograma artificial.

O trabalho avança somente quando a dependência anterior estiver comprovada por:

1. código e migração compatíveis;
2. autorização e minimização de dados;
3. testes automatizados;
4. lint e build;
5. deploy de produção;
6. verificação operacional do fluxo crítico;
7. evidência de observabilidade e caminho de rollback.

## 2. Papéis

### Codex

- detalhar cada unidade de execução;
- implementar banco, APIs, filas, interface e conteúdo;
- preservar alterações existentes no repositório;
- criar e executar testes;
- publicar os lotes aprovados pelo gate técnico;
- documentar comportamento, configuração e rollback;
- registrar riscos e decisões pendentes sem interromper tarefas independentes.

### Direção/Operação ProHealth

Participa somente de decisões que alteram política de atendimento ou risco de negócio:

- tempo de inatividade automática;
- SLA por categoria e horário útil;
- regras de transferência entre atendentes;
- amostragem e texto de CSAT/CES;
- responsáveis por revisão clínica, comercial e operacional;
- regras de pausas, ausências e escalonamento.

### Atendentes-piloto

- executar os cenários reais de aceite;
- apontar linguagem ambígua e esforço desnecessário;
- validar desktop, mobile, teclado e WhatsApp secundário.

## 3. Estado de partida

### Já publicado

- autenticação, convite e perfis de atendente;
- horário semanal e WhatsApp secundário;
- fila com busca, filtros, ordenação por maior espera e estados operacionais;
- assunção atômica, ownership e autoria humana;
- motivo estruturado de transferência e encerramento;
- encerramento humano obrigatório com motivo;
- encerramento automático após consentimento explícito do cliente;
- encerramento por inatividade configurável, desativado até aprovação de política;
- reabertura em novo episódio relacionado;
- leitura individual por atendente;
- notas internas dentro da conversa;
- agente notificador durável com retentativa e agenda de início de turno;
- cron apenas como reconciliação do notificador;
- tratamento explícito de mídia não interpretada;
- aprovação e rejeição mínima do treinamento;
- métricas e alertas operacionais já existentes;
- 381 testes automatizados, lint e build aprovados no último deploy.

### Lacunas conhecidas

- transferência explícita entre atendentes e gestão de conflitos durante edição;
- estado visível e completo de “Aguardando cliente”;
- SLA em horário útil e escalonamento dentro da própria fila;
- status operacional detalhado de cada notificação;
- CSAT, CES, FCR, reabertura e abandono consolidados;
- gestão de promessas e próximas ações;
- publicação, versionamento e rollback do conhecimento aprovado;
- corpus ouro e gate de qualidade da IA;
- design system consolidado, acessibilidade completa e fluxo mobile dedicado;
- pausas, ausências, capacidade e competências dos atendentes.

## 4. Estratégia de releases

Cada release deve ser pequeno o suficiente para rollback e completo o suficiente para entregar um comportamento utilizável.

### Gate técnico

- migração aditiva e idempotente;
- testes de regra crítica e concorrência;
- lint sem avisos;
- build de produção;
- nenhuma credencial ou conteúdo sensível em logs;
- feature flag quando houver mudança relevante de comportamento.

### Gate operacional

- cenário feliz validado;
- falha e retentativa validadas;
- mensagem e estado compreensíveis para o atendente;
- ação reversível ou procedimento de recuperação documentado;
- evento disponível para auditoria e métricas.

### Publicação

1. implementar em lote isolado;
2. rodar a suíte completa;
3. publicar em produção;
4. executar smoke test autenticado do fluxo alterado;
5. acompanhar erros e filas;
6. corrigir ou reverter antes de iniciar o próximo gate dependente.

## 5. Ordem de execução

## Gate A — consolidar a fila confiável

**Dependência:** base já publicada.  
**Resultado:** nenhuma ação humana ocorre sem dono, motivo e registro inequívocos.

### A1. Transferência entre atendentes

**Implementação Codex**

- criar comando atômico de transferência;
- exigir atendente de destino e motivo;
- registrar origem, destino, ator, nota e timestamp;
- notificar o novo responsável respeitando o turno;
- cancelar lembretes destinados ao responsável anterior;
- adicionar ação e histórico interno na conversa;
- impedir resposta do antigo responsável após a transferência;
- preservar texto em edição e avisar quando ownership mudar.

**Aceite**

- somente o responsável atual consegue enviar;
- duas transferências concorrentes têm um único resultado;
- histórico e auditoria explicam quem transferiu, para quem e por quê;
- nenhuma mensagem interna fica visível ao cliente.

### A2. Aguardando cliente

**Implementação Codex**

- tornar “Aguardando cliente” um estado operacional explícito;
- registrar início, responsável e prazo de inatividade;
- separar tempo do atendente de tempo do cliente nas métricas;
- pausar ou manter SLA conforme a política aprovada;
- permitir retorno manual ao estado em atendimento;
- cancelar o temporizador quando o cliente responder;
- encerrar pelo motivo de inatividade quando a política estiver habilitada.

**Decisão necessária**

- valor de X minutos;
- contagem contínua ou apenas em horário de atendimento.

**Aceite**

- não há fechamento automático antes de X;
- nova mensagem invalida o fechamento pendente;
- fechamento e reabertura ficam ligados e auditáveis.

### A3. Validação operacional do notificador

**Implementação Codex**

- mostrar no perfil o próximo turno agendado;
- permitir envio de teste para o WhatsApp secundário;
- exibir último envio, último erro e estado do modelo da Meta;
- registrar tentativas e falhas acionáveis;
- confirmar cancelamento ao assumir ou transferir a conversa;
- validar resumo ordenado por maior espera.

**Aceite**

- nenhum aviso individual é enviado fora do turno;
- o mesmo evento não gera duplicidade;
- o resumo chega uma vez no início do turno;
- falha do WhatsApp não remove a conversa da fila.

## Gate B — SLA e centro de ação

**Dependência:** Gate A.  
**Resultado:** a plataforma indica claramente o que precisa ser feito agora e por quê.

### B1. Motor de SLA

**Implementação Codex**

- criar política de SLA por motivo, prioridade e horário útil;
- calcular prazo usando calendário operacional;
- registrar pausas justificadas;
- materializar estados `normal`, `atenção`, `vencido` e `pausado`;
- recalcular de forma idempotente a cada evento relevante;
- criar testes de borda para noite, fim de semana e mudança de turno.

### B2. Centro de ação dentro da fila

**Implementação Codex**

- ordenar por risco de SLA e maior espera;
- destacar conversas sem responsável, vencidas e com falha de notificação;
- incluir filtros “Minhas”, “Sem responsável”, “Equipe” e “Aguardando cliente”;
- levar alertas acionáveis de Métricas para a fila;
- oferecer próxima ação explícita em cada alerta;
- evitar badges e cores sem significado operacional.

**Aceite do Gate B**

- toda violação de SLA aparece na fila;
- a ordenação permanece determinística;
- pausas não escondem conversas abandonadas;
- um atendente identifica sua próxima ação sem abrir várias telas.

## Gate C — desfecho, CX e promessas

**Dependência:** motivos e estados confiáveis, Gate B.  
**Resultado:** medir resolução e esforço, não apenas volume e velocidade.

### C1. Modelo de desfecho

**Implementação Codex**

- consolidar evento de encerramento com origem, motivo, responsável e duração;
- calcular FCR e reabertura por episódio relacionado;
- distinguir abandono, encerramento humano, automático e técnico;
- separar tempo total, tempo do cliente e tempo da equipe;
- expor cobertura e qualidade dos dados em cada métrica.

### C2. CSAT e CES

**Implementação Codex**

- criar pesquisa curta pós-atendimento com amostragem configurável;
- impedir pesquisas duplicadas no mesmo episódio;
- respeitar opt-out e janela de contato;
- armazenar nota, comentário opcional e vínculo mínimo com o episódio;
- criar recuperação de detratores para a fila, sem responder automaticamente a conteúdo sensível;
- disponibilizar relatório por motivo e tipo de atendimento.

### C3. Promessas e próximas ações

**Implementação Codex**

- criar compromisso com descrição curta, responsável e prazo;
- registrar origem automática ou humana;
- exibir pendências no cabeçalho da conversa e no centro de ação;
- alertar prazo próximo e vencido;
- exigir conclusão, cancelamento ou reagendamento com motivo;
- medir compromissos cumpridos.

**Aceite do Gate C**

- reabertura e FCR são reproduzíveis a partir dos eventos;
- pesquisa nunca bloqueia a conversa;
- detratores ficam visíveis e atribuídos;
- nenhuma promessa desaparece sem desfecho.

## Gate D — aprendizagem governada

**Dependência:** desfechos e métricas do Gate C.  
**Resultado:** melhorar o agente com evidência, aprovação e rollback.

### D1. Workflow completo de conhecimento

**Implementação Codex**

- ampliar estados para proposta, ajuste solicitado, aprovada, publicada e revertida;
- exigir fonte, evidência, categoria, risco e justificativa;
- criar revisão reforçada para saúde, preço, disponibilidade e promessa;
- versionar cada publicação;
- implementar preview do impacto e diff;
- publicar somente artefatos aprovados;
- criar rollback testado e auditado.

### D2. Corpus ouro e avaliação contínua

**Implementação Codex**

- criar conjunto anonimizado de casos críticos;
- incluir segurança, precisão, repetição, ordem, handoff e encerramento;
- executar avaliação em alterações de prompt, conhecimento e política;
- definir limiares bloqueantes para regressões críticas;
- registrar resultado comparável entre versões.

### D3. Scorecard humano e IA

**Implementação Codex**

- criar critérios comuns de acolhimento, precisão, resolução, esforço e compromisso;
- permitir amostragem e revisão calibrada;
- separar falha de processo, conhecimento, ferramenta e execução;
- alimentar o backlog com problemas recorrentes.

**Aceite do Gate D**

- nenhuma proposta altera produção sem publicação explícita;
- toda publicação possui versão e rollback;
- regressão crítica impede deploy da mudança de IA;
- avaliações mantêm rastreabilidade sem expor dados desnecessários.

## Gate E — experiência consistente e acessível

**Dependência:** fluxos operacionais estabilizados.  
**Resultado:** reduzir esforço cognitivo e sustentar evolução sem fragmentar a interface.

### E1. App Shell e design system

**Implementação Codex**

- consolidar navegação e identificação da conta ativa;
- criar tokens semânticos de cor, tipografia, espaçamento, borda e movimento;
- padronizar botões, inputs, selects, diálogos, badges, alertas e estados vazios;
- consolidar linguagem dos estados da conversa;
- remover CSS duplicado de alto impacto;
- documentar componentes e exemplos de uso.

### E2. Acessibilidade

**Implementação Codex**

- corrigir contraste e foco visível;
- garantir operação por teclado;
- ajustar nomes acessíveis e anúncios de atualização;
- respeitar `prefers-reduced-motion`;
- validar diálogos, compositor e filtros com leitor de tela;
- verificar alvos de toque conforme WCAG 2.2.

### E3. Mobile operacional

**Implementação Codex**

- adotar fluxo lista → conversa → contexto;
- manter compositor e ação principal acessíveis;
- preservar rascunho ao navegar;
- mostrar responsável, SLA e estado sem depender de hover;
- tratar teclado virtual, anexos e rede instável;
- validar em aparelho real.

**Aceite do Gate E**

- tarefas críticas funcionam por teclado e mobile;
- estado e responsável permanecem visíveis;
- não há perda de rascunho durante atualização ou mudança de painel;
- componentes equivalentes têm comportamento e linguagem equivalentes.

## Gate F — maturidade operacional

**Dependência:** centro de ação e experiência consistente.  
**Resultado:** distribuir trabalho com justiça e previsibilidade.

### F1. Disponibilidade real

- pausas, ausências e exceções de agenda;
- retorno de pausa e resumo de pendências;
- substituição temporária e cobertura de turno;
- status operacional visível para administração.

### F2. Capacidade e competências

- limite de conversas simultâneas;
- competências por categoria;
- distribuição por disponibilidade, capacidade e maior espera;
- regra explícita de fallback quando ninguém elegível estiver disponível;
- métricas de carga sem ranking punitivo.

### F3. Administração e onboarding

- checklist de ativação do atendente;
- teste de notificação;
- convite, reenvio, cancelamento e suspensão;
- último acesso, disponibilidade e configuração pendente;
- trilha de auditoria para todas as alterações de acesso.

**Aceite do Gate F**

- distribuição nunca escolhe alguém indisponível;
- capacidade não gera conversa sem responsável;
- administração identifica configuração incompleta antes do primeiro turno;
- mudanças de acesso são reversíveis e auditáveis.

## 6. Fila imediata do Codex

Esta é a ordem concreta dos próximos lotes:

1. transferência entre atendentes e proteção de rascunho;
2. estado completo “Aguardando cliente”;
3. painel de saúde e teste do agente notificador;
4. motor de SLA em horário útil;
5. centro de ação dentro da fila;
6. eventos consolidados de desfecho, FCR e reabertura;
7. CSAT/CES e recuperação de detratores;
8. promessas e próximas ações;
9. publicação/versionamento/rollback do conhecimento;
10. corpus ouro e gate de qualidade;
11. app shell e design system;
12. acessibilidade e mobile;
13. pausas, ausências, capacidade e competências;
14. onboarding e administração operacional completos.

As tarefas independentes dentro do mesmo lote podem ser executadas em paralelo. A ordem entre lotes só muda se uma descoberta técnica ou operacional revelar uma dependência real.

## 7. Decisões abertas sem bloquear trabalho independente

| Decisão | Padrão seguro enquanto não decidida | Gate afetado |
|---|---|---|
| X minutos de inatividade | recurso desativado | A |
| Contagem de inatividade fora do expediente | não encerrar automaticamente | A |
| SLA por motivo | apenas medir, sem prometer prazo | B |
| Transferência forçada por administrador | exigir motivo e auditoria | A/F |
| Amostragem de CSAT/CES | não enviar pesquisa | C |
| Revisor de conteúdo clínico | bloquear publicação | D |
| Limite de conversas simultâneas | não limitar distribuição | F |

## 8. Evidências exigidas por lote

- identificador do deploy;
- lista das migrações aplicadas;
- testes adicionados e resultado da suíte;
- captura ou roteiro do smoke test;
- eventos e métricas gerados;
- riscos conhecidos;
- configuração ou decisão ainda pendente;
- instrução de rollback.

## 9. Condição de conclusão do programa

O plano será considerado executado quando:

- todos os Gates A–F atenderem seus critérios;
- os fluxos críticos tiverem testes automatizados e validação operacional;
- a plataforma medir resolução, esforço, SLA e compromissos com cobertura explícita;
- conhecimento de produção possuir aprovação, versão e rollback;
- desktop e mobile sustentarem as tarefas críticas com acessibilidade;
- notificações e filas possuírem retentativa, auditoria e recuperação;
- nenhuma integração passar a substituir ou inventar dados da NexFit.
