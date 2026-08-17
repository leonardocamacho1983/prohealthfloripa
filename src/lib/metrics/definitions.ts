export type MetricDefinition = {
  label: string;
  formula: string;
  source: string;
  limitation: string;
  target?: string;
};

export const METRIC_DEFINITIONS = {
  conversationVolume: {
    label: "Conversas com entrada",
    formula: "Conversas distintas com ao menos uma mensagem recebida na janela.",
    source: "messages",
    limitation: "Não equivale a clientes únicos fora da janela.",
  },
  handoffRate: {
    label: "Taxa de handoff",
    formula: "Pedidos de atendimento humano na janela / conversas com entrada na janela.",
    source: "conversations + messages",
    limitation: "Um pedido pode ocorrer em conversa iniciada antes da janela.",
  },
  firstOutboundLatency: {
    label: "Primeira resposta",
    formula: "Tempo do primeiro inbound da conversa até o primeiro outbound enviado.",
    source: "messages",
    limitation: "Sem outbound, a conversa entra na cobertura, mas não no percentil.",
    target: "p50 até 12 s; p95 até 30 s.",
  },
  humanPickupLatency: {
    label: "Tempo até humano",
    formula: "handoff_requested_at até human_started_at.",
    source: "conversations",
    limitation: "Ainda não desconta períodos fora do horário de atendimento.",
    target: "Referência provisória: p50 até 5 min; p95 até 15 min em horário atendido.",
  },
  turnProcessingLatency: {
    label: "Processamento do turno",
    formula: "completed_at - started_at para turnos concluídos com resposta.",
    source: "conversation_turns",
    limitation: "Não inclui tempo anterior ao início do worker nem atraso de entrega do provider.",
    target: "p50 até 8 s; p95 até 20 s.",
  },
  failures: {
    label: "Falhas operacionais",
    formula: "Turnos failed, entregas outbound failed e eventos instrumentados como failure.",
    source: "conversation_turns + messages + operational_metric_events",
    limitation: "As fontes são exibidas separadamente para evitar dupla contagem.",
  },
  intentCoverage: {
    label: "Cobertura de intenções",
    formula: "Média do valor 0–1 registrado em turn_intent_coverage.",
    source: "operational_metric_events",
    limitation: "Fica indisponível até o orquestrador registrar a intenção esperada e a respondida.",
    target: "Ao menos 95% com amostra instrumentada.",
  },
  repairSuccess: {
    label: "Reparo conversacional",
    formula: "conversation_repair_succeeded / conversation_repair_requested.",
    source: "operational_metric_events",
    limitation: "Mede eventos explicitamente instrumentados, não sentimento inferido.",
    target: "Ao menos 90% com amostra instrumentada.",
  },
  duplicateAndOrder: {
    label: "Duplicação e ordem",
    formula: "Contagem de duplicate_reply_detected e out_of_order_reply_detected.",
    source: "operational_metric_events",
    limitation: "Zero só é conclusivo quando a instrumentação estiver ativa.",
    target: "Zero respostas duplicadas ou fora de ordem.",
  },
  catalogHealth: {
    label: "Saúde do catálogo",
    formula: "Última tentativa, sucesso, falha e idade do último sucesso Nextfit.",
    source: "catalog_sync_runs + catalog_items",
    limitation: "Catálogo saudável confirma sincronização, não correção comercial de cada item.",
    target: "Último sucesso há no máximo 26 h e sem falha posterior.",
  },
  commercialOutcomes: {
    label: "Resultados comerciais observados",
    formula: "Eventos comerciais associados à conversa e documentados por uma fonte de evidência.",
    source: "commercial_outcome_events",
    limitation: "Associação não prova que o agente causou receita, conversão ou recuperação.",
  },
} as const satisfies Record<string, MetricDefinition>;
