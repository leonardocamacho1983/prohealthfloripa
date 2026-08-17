export const proHealthKnowledge = {
  institutional: {
    name: "PRO HEALTH Saúde e Performance",
    address:
      "Rua Vera Linhares de Andrade, 2063, Córrego Grande, Florianópolis",
    whatsapp: "(48) 99862-1948",
    email: "prohealthfloripa@gmail.com",
    instagram: "@prohealthfloripa",
    cnpj: "65.219.427/0001-20",
  },
  schedule: {
    hours: "segunda a sexta; primeiro horário às 08h; último cliente entra às 20h; encerramento às 21h",
    weekend: "sábado e domingo somente com agendamento prévio para clientes de planos; sem aula experimental e sem serviços avulsos",
    agendas: {
      pilates: "até 3 pessoas",
      atendimentoMassagem: "individual",
      termoterapias: "individual",
    },
  },
  pilates: {
    experimentalClass: "A aula experimental de Pilates é oferecida gratuitamente.",
    single: "R$ 100",
    monthly: {
      oncePerWeek: "R$ 330",
      twicePerWeek: "R$ 420",
      threeTimesPerWeek: "R$ 500",
    },
    semiannual: {
      oncePerWeek: "6x R$ 310 = R$ 1.860",
      twicePerWeek: "6x R$ 390 = R$ 2.340",
      threeTimesPerWeek: "6x R$ 440 = R$ 2.640",
    },
    annual: {
      oncePerWeek: "12x R$ 280 = R$ 3.360",
      twicePerWeek: "12x R$ 360 = R$ 4.320",
      threeTimesPerWeek: "12x R$ 380 = R$ 4.560",
    },
    recurrenceNote: "Planos semestrais e anuais aparecem como recorrentes.",
    freezing: { annual: "até 1 mês", semiannual: "até 15 dias" },
  },
  massages: {
    single: {
      traditional: "R$ 270",
      special: "R$ 300",
    },
    packages: {
      traditional: {
        fiveSessions: "5 sessões / 40 dias: R$ 1.215",
        tenSessions: "10 sessões / 70 dias: R$ 2.430",
      },
      special: {
        fiveSessions: "5 sessões / 40 dias: R$ 1.350",
        tenSessions: "10 sessões / 70 dias: R$ 2.700",
      },
    },
    traditionalTechniques: [
      "Miofascial",
      "Relaxante",
      "Drenagem linfática",
      "Shiatsu",
      "Desportiva",
      "Sueca",
      "Lomi-Lomi",
      "Tuiná",
    ],
    specialTechniques: [
      { name: "Ayurvédica / Thai", duration: "1h" },
      { name: "Abhyanga", duration: "1h" },
      { name: "Shiro Abhyanga", duration: "30 min" },
      { name: "Pada Abhyanga", duration: "30 min" },
      { name: "Shirodhara", duration: "50 min" },
      { name: "Bastis localizados", duration: "1h" },
      { name: "Massagem Indiana, método tatame", duration: "1h" },
    ],
    expressDuration: "30 minutos",
  },
  recovery: {
    iceBath: "Banheira de gelo avulsa: R$ 70",
    hotBath: "Banheira quente avulsa: R$ 70",
    contrast: "Contraste de termoterapias: R$ 100",
    cryotherapyTraditionalMassage:
      "Crioterapia + massagem tradicional: R$ 300",
    cryotherapySpecialMassage: "Crioterapia + massagem especial: R$ 330",
    twicePerWeek: "Termoterapias 2x/semana: 6x R$ 350 = R$ 2.100",
  },
  physiotherapy: {
    appointment: "R$ 270",
  },
  duration: {
    general: "Os atendimentos ocupam 1 hora completa, incluindo todo o atendimento e processo.",
    massageExpress: "Massagem Express: 30 minutos.",
  },
  positioning: {
    audience:
      "Atletas profissionais, amadores e praticantes de atividade física.",
    services: [
      "mobilidade",
      "estabilidade",
      "fortalecimento funcional",
      "preparação física",
      "recovery",
      "termoterapias",
      "massagens",
      "fisioterapia",
      "recuperação e retorno ao esporte",
    ],
    philosophy: "Integra corpo, movimento, recuperação e performance.",
  },
  policies: {
    cancellation: "Cancelamento ou remarcação exige aviso com 24 horas de antecedência.",
    unannouncedAbsence: "Em caso de falta sem aviso, a sessão pode ser remarcada em até 30 dias.",
    refund: "Reembolso é possível mediante atestado ou situação de força maior. Não interpretar automaticamente força maior; em caso de dúvida, encaminhar para a equipe.",
  },
  pendingInformation: [],
  clinicalSafety: {
    guidance:
      "Não diagnosticar, prescrever, prometer alívio nem afirmar aptidão clínica. Dor muscular comum, tensão ou desconforto sem sinal de alarme não impedem a resposta comercial: explique a técnica e diga que o profissional conversa e avalia no início para ajustar ou indicar a opção mais adequada. Encaminhe para avaliação humana quando houver trauma recente, dor súbita ou intensa, perda de força ou sensibilidade, falta de ar, dor no peito, febre, suspeita de trombose, gestação, cirurgia recente, condição médica relevante ou quando a pessoa pedir decisão clínica individual.",
  },
  purchase: {
    plansUrl:
      "https://venda.nextfit.com.br/afda9e7e-af58-4b0f-b882-4be65b5a0bdd/contratos",
  },
} as const;
