# Conselho de elite — avaliação da plataforma ProHealth

**Data:** 20 de agosto de 2026  
**Escopo:** UI/UX, CS/CX, operação de atendimento, design conversacional e evolução estratégica para substituir gradualmente a NexFit.  
**Base de evidência:** inspeção da aplicação publicada e autenticada, leitura do código e do modelo de dados, métricas operacionais exibidas na plataforma e documentação pública da NexFit, ANPD, W3C e NIST.

## Resumo executivo

A plataforma já possui uma base acima da média para um MVP: fila ordenada por espera, histórico conversacional, handoff com resumo, contexto do cliente vindo da NexFit, notas internas, respostas rápidas, perfis com horário de trabalho e WhatsApp secundário, RBAC, logs e métricas que não fingem ter dados indisponíveis. A engenharia conversacional também demonstra preocupação real com idempotência, concorrência, respostas obsoletas, validação e privacidade.

O principal risco não é visual. É operacional: hoje a plataforma parece uma central de atendimento, mas ainda não garante com rigor **quem é o responsável**, **por que um atendimento foi transferido ou encerrado**, **qual compromisso ficou pendente** e **se a notificação realmente chegou**. Sem essas garantias, melhorar apenas a interface deixaria o produto mais bonito sem torná-lo confiável.

A tese recomendada para o futuro é: **não copiar a NexFit tela a tela**. A ProHealth deve primeiro se tornar o sistema irreplicável da experiência e do relacionamento — conversa, contexto, promessas, recuperação e coordenação humano–IA — e depois assumir, um domínio por vez, agenda, contratos, presença e finanças. Em cada domínio deve existir apenas um sistema escritor.

## O que já está forte

- Fila padrão por maior espera, com busca, filtros, não lidas e conversas paradas.
- Identidade e papel do usuário aparecem no cabeçalho da operação.
- Handoff contém motivo, origem e resumo; o atendente recebe contexto sem reler toda a conversa.
- Painel do cliente reúne snapshot da NexFit, notas internas e respostas rápidas.
- Perfil contempla segundo WhatsApp e grade semanal de trabalho.
- A notificação evita copiar o transcript completo para o número pessoal, o que é correto por privacidade.
- Métricas distinguem associação de causalidade e sinalizam instrumentação ausente.
- O pipeline de IA possui batching, lease, revisão, idempotência, supressão de resposta obsoleta, fallbacks e validação.
- Há RBAC e trilha de auditoria.
- A landing page pública transmite posicionamento premium e tem boa hierarquia visual.

## Prioridade zero: tornar a operação confiável

### 1. Responsável real pelo atendimento

Existe `assigned_attendant_user_id`, mas a responsabilidade não está plenamente exposta nem protegida no fluxo. Tomar, responder e encerrar não validam de forma suficiente se o ator é o dono atual; mensagens do humano também não preservam claramente a autoria individual.

**Recomendação:** claim atômico com conflito `409`, responsável visível, filas “Minhas”, “Sem responsável” e “Equipe”, transferência explícita e autoria em cada mensagem/ação. O sistema deve impedir duas pessoas de atenderem simultaneamente sem perceber.

### 2. Taxonomias obrigatórias e distintas

O encerramento atual não exige motivo estruturado, apesar de o texto operacional já pedir que o atendente escolha um. Isso cria uma promessa quebrada e inviabiliza aprendizado.

Criar três taxonomias administráveis:

1. **Motivo de transferência ao humano:** marcação de horário, solicitação do cliente, exceção comercial, dúvida clínica/segurança, falha de automação, cobrança e outros.
2. **Motivo de encerramento humano:** resolvido, orientação concluída, agendamento concluído, desistência, duplicidade, sem possibilidade de atendimento, retornará depois e outros.
3. **Motivo de encerramento automático:** inatividade do cliente, confirmação de satisfação e permissão para encerrar, duplicidade técnica e outros.

Os motivos padrão devem poder ser editados, inativados e complementados. O motivo deve ser obrigatório, com nota opcional e trilha de auditoria. Evitar exclusão física quando já houver histórico.

### 3. Ciclo de vida claro: aberto, aguardando, encerrado e reaberto

Hoje existe retorno automático do controle humano ao agente após prazo fixo, mas não existe o ciclo solicitado de encerramento por inatividade em X minutos, com motivo, nem relação explícita entre o atendimento encerrado e o episódio reaberto.

**Recomendação:** definir estados e relógios de negócio, pedir permissão para encerrar quando o cliente indicar satisfação, encerrar automaticamente por inatividade configurável e, quando o cliente voltar, criar/reabrir um episódio relacionado mantendo histórico, motivo e SLA separados.

### 4. Corrigir o conceito de “visualizado”

A primeira conversa pode ser marcada como visualizada durante a renderização/atualização automática, mesmo sem leitura real do atendente. No celular o risco é maior, pois a conversa pode estar abaixo da dobra.

**Recomendação:** marcar como lida somente quando o painel estiver realmente visível e focado, com evento explícito do cliente e registro do usuário.

### 5. Transformar a notificação em agente notificador durável

Faz sentido criar um agente notificador, mas ele não deve ser apenas um LLM disparando mensagens. Ele deve ser um serviço orientado a eventos, com outbox, tentativas, fila de falhas, idempotência, comprovante de entrega e escalonamento.

Responsabilidades:

- notificar o atendente somente dentro do horário configurado;
- ao início exato do turno, enviar resumo dos pendentes por maior espera;
- avisar novo handoff com nome do cliente, motivo, resumo mínimo e link seguro;
- exigir confirmação ou detectar tomada do atendimento;
- relembrar e escalar conforme SLA;
- não copiar dados sensíveis ou transcript completo para WhatsApp pessoal;
- registrar entrega, leitura quando disponível e falha.

O cron pode continuar como rede de segurança, mas o mecanismo principal deve reagir a eventos e agendar um despertar durável para o início individual de cada turno.

### 6. Tratar mídia não textual sem silêncio

Áudio, imagem e documento de clientes comuns podem chegar sem resposta útil. Em saúde, silêncio operacional aumenta ansiedade.

**Recomendação:** transcrever áudio quando permitido; para mídia não suportada, acusar recebimento, explicar a limitação e oferecer encaminhamento humano. Nunca ignorar silenciosamente.

### 7. Governança do treinamento

A tela de treinamento apresenta layout quebrado e propostas atrasadas; as propostas visíveis estão marcadas como fallback e não há fluxo completo de aprovar, rejeitar, publicar, versionar e reverter.

**Recomendação:** nenhuma conversa de treinamento deve alterar conhecimento de produção diretamente. Toda proposta precisa de evidência, fonte, risco, dono, versão, revisão humana e rollback. Em temas de saúde, acrescentar categoria de risco e revisão por responsável autorizado.

### 8. Alertas no lugar onde o trabalho acontece

Os alertas vivem principalmente na página de métricas, enquanto o atendente trabalha na fila.

**Recomendação:** badges de SLA, vencimento, falha de notificação e ação requerida dentro da própria caixa de entrada, com um pequeno centro de ação.

## Oportunidades para nível mundial

### Cockpit humano de alta performance

- SLA calculado em horário útil, com prazo, envelhecimento, abandono e escalonamento.
- Presença operacional: em turno, pausa, ausência, férias, capacidade e competências.
- Roteamento por habilidade, unidade, prioridade e carga; não apenas atribuição genérica.
- Atualização em tempo real que preserve rascunho, posição de leitura e foco; evitar refresh integral a cada 15 segundos.
- Notas privadas como eventos compactos dentro da timeline, não como blocos que competem com as mensagens.
- Busca por cliente, telefone, intenção, motivo, compromisso, protocolo e desfecho.
- Acessibilidade WCAG 2.2: foco consistente, contraste, alvos maiores, redução de movimento e navegação completa por teclado.
- Mobile operacional de verdade: lista → conversa em tela cheia → contexto em gaveta, com voltar e compositor fixo. O empilhamento atual é contingencial, não um produto móvel.

### Customer 360 orientado a próximos passos

Substituir o “snapshot” por uma linha do tempo unificada: conversa, intenção, promessa, agendamento, presença, contrato, cobrança, consentimento, notas e próxima ação. O valor não está em mostrar mais dados, mas em permitir que qualquer atendente entenda em segundos:

1. quem é a pessoa;
2. o que ela quer agora;
3. o que já foi prometido;
4. qual risco ou restrição existe;
5. qual é a próxima melhor ação.

### Métricas de experiência, não só de infraestrutura

As métricas atuais mostram velocidade e handoff, mas ainda não mostram se o cliente teve sucesso.

Adicionar:

- CSAT e CES pós-atendimento;
- resolução no primeiro contato e reabertura;
- abandono antes do atendimento humano;
- repetição de informações e esforço do cliente;
- aderência à promessa e tempo até solução real;
- conversão de agendamento, comparecimento, no-show e recuperação;
- retenção, renovação e risco de churn;
- qualidade do handoff: correto, necessário, no momento certo e com contexto suficiente;
- scorecards de qualidade para IA e humanos, com amostra calibrada.

**North Star sugerida:** necessidades resolvidas com baixo esforço e compromissos cumpridos. Velocidade e automação são guardrails, não a finalidade.

### Design conversacional

O índice exibido de handoff é 66,7%. Isso não é necessariamente ruim em um piloto; sem motivos e desfechos, porém, não é possível saber se o encaminhamento foi adequado.

Princípios recomendados:

- identidade transparente: o cliente sabe quando fala com assistente automático e como pedir uma pessoa;
- respostas curtas para WhatsApp: conclusão primeiro, uma pergunta por vez e detalhes progressivos;
- confirmação explícita antes de ações críticas;
- recibos de ação: “solicitação enviada” não pode parecer “agendamento confirmado”;
- memória de promessas e tarefas, com dono e vencimento;
- reparo elegante: reconhecer falha, explicar o próximo passo e não fazer o cliente repetir tudo;
- pedir permissão para encerrar quando houver sinal de satisfação;
- segurança: nunca improvisar orientação clínica, preço, disponibilidade ou confirmação sem fonte confiável;
- handoff “quente”: motivo, resumo, sentimento, o que já foi tentado e ação esperada do humano.

Avaliar conversas por acurácia, resolução, esforço, repetição, contexto preservado, segurança, conversão e cumprimento de promessas. Criar corpus ouro com conversas reais aprovadas, regressão antes de deploy, shadow/canary, red team e amostragem de produção.

### Sistema visual e arquitetura da informação

As telas atuais repetem cabeçalhos e CSS, o que já produz inconsistências. Consolidar uma App Shell e um design system com tokens, estados, componentes, acessibilidade e conteúdo padrão.

Arquitetura futura sugerida:

- Atendimento
- Agenda
- Clientes
- Serviços
- Comercial
- Financeiro
- Equipe
- Insights
- Configurações

Padronizar também a linguagem: “Atendimento automático”, “Aguardando atendente” e “Com Leonardo” são mais claros que misturar “agente”, “humano” e “em atendimento”.

## Alinhamento com a substituição da NexFit

### Tese estratégica

“Ter um agente de IA no WhatsApp” não é vantagem sustentável por si só; a própria NexFit já comunica agentes de IA para agendar, vender, assinar e cobrar. A vantagem defensável da ProHealth deve ser:

- grafo longitudinal do cliente;
- coordenação humano–IA de alta qualidade;
- jornada fechada da necessidade ao resultado;
- recuperação e retenção específicas de recuperação física/Pilates;
- promessas rastreáveis;
- governança, privacidade e auditabilidade.

### Domínios que um substituto real precisa cobrir

1. Pessoa, identidade, contatos, consentimento e relacionamento.
2. Catálogo, preços, regras e unidades.
3. Agenda, profissionais, salas/equipamentos, capacidade, lista de espera, cancelamento e conflito.
4. Contratos, planos, créditos, congelamentos, renovação e cancelamento.
5. Cobrança, recebíveis, pagamentos, estornos e conciliação.
6. Presença, check-in, no-show, consumo de crédito e controle de acesso.
7. CRM, oportunidades, campanhas, tarefas e ciclo de vida.
8. Atendimento omnichannel, casos, promessas e conhecimento.
9. Permissões, auditoria, privacidade e analytics.
10. Se necessário, prontuário/evolução/documentos em um contexto clínico separado e com governança própria.

O modelo atual deve evoluir de “telefone único” para `person`, `contact_point` e `external_identity`, e receber `organization_id` e `unit_id` antes de assumir domínios operacionais. Os papéis globais owner/admin/attendant não bastam para financeiro, clínico e múltiplas unidades.

### Estratégia de migração

Não usar dual-write casual. Para cada domínio:

1. definir fonte de verdade e dono;
2. fazer carga inicial;
3. sincronizar deltas;
4. reconciliar;
5. executar shadow mode;
6. cortar o escritor;
7. operar hypercare;
8. manter rollback testado.

A API pública documentada da NexFit é de leitura. Escritas exigirão acordo de integração privada, importação/exportação formal ou corte completo do domínio. A camada atual de snapshots JSON é aceitável para contexto derivado enquanto a NexFit é fonte operacional, mas não deve virar o modelo transacional definitivo.

## Roadmap recomendado

### Fase 0 — 0 a 6 semanas: fundação e decisão

- Censo real de uso da NexFit: módulos, pessoas, exceções e planilhas paralelas.
- Matriz de fonte de verdade por domínio.
- Modelo-alvo de organização, unidade, pessoa, contato e identidade externa.
- Taxonomias de transferência e encerramento.
- SLOs em horário útil, política LGPD, retenção e incidentes.

### Fase 1 — 6 a 12 semanas: operação confiável

- Ownership atômico e autoria.
- Motivos obrigatórios, inatividade e reabertura.
- Agente notificador durável.
- Fallback de mídia.
- Governança do treinamento.
- CSAT/CES, FCR, reabertura e scorecard de QA.

### Fase 2 — 3 a 6 meses: ProHealth assume CRM/CS

- Leads, oportunidades, tarefas, ciclo de vida, campanhas e Customer 360.
- NexFit continua dona de agenda, contratos, presença e finanças.

### Fase 3 — 6 a 12 meses: agenda e operação

- Assumir agenda por serviço/unidade em migração controlada.
- Recursos, capacidade, lista de espera, cancelamento, remarcação e no-show.
- Integrar controle de acesso/hardware; não construir hardware próprio.

### Fase 4 — 12 a 18 meses: contratos e finanças

- Contratos, créditos, congelamentos, cobrança, conciliação e fiscal.
- PSP e provedor fiscal licenciados; ledger imutável, idempotência e reconciliação.

### Fase 5 — 18 a 24 meses: ecossistema próprio

- Aplicativo/portal do cliente e do profissional.
- Contexto clínico separado, apenas se estiver explicitamente no escopo estratégico e regulatório.

## Perguntas que o conselho levaria à direção

1. O objetivo é um sistema interno excepcional ou um SaaS vertical multiunidade?
2. “Substituir a NexFit” inclui prontuário e operação clínica ou apenas comercial/operacional?
3. Quais módulos da NexFit são usados hoje, por quem e com quais exceções manuais?
4. O que significa “encerrado”: resolvido, pausado, devolvido ao agente ou novo episódio?
5. A propriedade da conversa será por atribuição, equipe ou primeiro atendente que assumir?
6. Quais SLAs e escalonamentos valem por motivo, prioridade, unidade e horário?
7. Quem governa as taxonomias de transferência, contato e encerramento?
8. Mobile é canal primário de trabalho ou contingência?
9. Quais primeiras ações da NexFit devem acontecer dentro da conversa: agendar, remarcar, cancelar, vender plano, cobrar ou registrar presença?
10. O que será construído e o que será parceiro: pagamentos, fiscal, assinatura e controle de acesso?
11. Quais dados podem aparecer na fila e no WhatsApp secundário? Qual retenção e processo de direito do titular?
12. Qual tolerância de indisponibilidade, divergência e rollback durante a migração?

## Leitura das telas auditadas

1. **Entrada pública — saudável, mas desconectada do funil operacional.** Boa proposta de valor e hierarquia; conversão termina em WhatsApp ou na área de vendas da NexFit. A oportunidade é um funil conversacional único com disponibilidade, seleção, agendamento, pagamento, instruções e acompanhamento.
2. **Fila de atendimento — base funcional, governança incompleta.** A fila por maior espera é correta; faltam ownership protegido, autoria, estados/língua consistentes e SLA acionável.
3. **Métricas — honesta, ainda técnica.** A página mostra limitações e qualidade operacional, mas carece de resolução, esforço, satisfação, resultado e compromisso cumprido.
4. **Perfil — estrutura certa, ativação fraca.** Horário e WhatsApp secundário existem, mas a configuração pendente não é transformada em onboarding ou alerta operacional claro.
5. **Usuários — MVP suficiente.** Convite e papel existem; faltam disponibilidade, carga atual, último acesso, suspensão, cancelamento de convite e histórico.
6. **Treinamento — estado crítico.** Layout quebrado, fila atrasada e ausência de governança de aprovação/publicação/rollback.

## Evidência e limites

- Auditoria visual feita na versão publicada com sessão autenticada atual.
- Leitura de código e esquema confirma os principais fluxos e lacunas descritos.
- Métricas refletem a janela exibida de sete dias, não uma série histórica suficiente para conclusão causal.
- Não houve teste com atendentes, clientes reais, leitor de tela ou dispositivo móvel físico nesta rodada.
- A tentativa de captura móvel não produziu viewport confiável; as observações mobile vêm do CSS e da arquitetura da página e precisam de QA em dispositivo real.
- Não foi executada escrita transacional na NexFit nem auditoria jurídica; decisões financeiras, clínicas e de LGPD exigem responsáveis qualificados.

## Referências externas

- [W3C — WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [NIST — Artificial Intelligence Risk Management Framework: Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)
- [ANPD — Perguntas frequentes](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes)
- [ANPD — Direitos dos titulares](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1)
- [NextFit — API](https://ajuda.nextfit.com.br/support/solutions/articles/69000875320-como-ativar-e-utilizar-a-api-do-next-fit-)
- [NextFit — CRM](https://ajuda.nextfit.com.br/support/solutions/articles/69000850977-como-configurar-e-utilizar-o-crm-completo-geral-)
- [NextFit — aplicativo do aluno](https://ajuda.nextfit.com.br/support/solutions/articles/69000555043-como-utilizar-o-aplicativo-do-aluno-geral-)
- [NextFit — aplicativo Next Fit Pro](https://ajuda.nextfit.com.br/support/solutions/articles/69000794099-aplicativo-next-fit-pro)
- [NextFit — agentes de IA](https://ajuda.nextfit.com.br/support/solutions/articles/69000878504-como-ativar-e-configurar-os-agentes-de-ia-do-next-fit-)
