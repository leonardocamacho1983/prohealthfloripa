export type NextfitPerson = {
  id: number;
  nome?: string | null;
  dataCadastro: string;
  dataNascimento?: string | null;
  dddFone?: string | null;
  fone?: string | null;
  inativo: boolean;
};

export type NextfitContract = {
  id: number;
  codigoCliente: number;
  codigoContratoBase: number;
  dataInicio: string;
  dataValidade: string;
  dataEncerramento?: string | null;
  valorTotal?: number;
  recorrente?: boolean;
  status: "Ativo" | "Cancelado" | "Encerrado" | "Suspenso" | "Bloqueado" | "Agendado" | "Erro";
  modalidades?: Array<{ tipo: "Periodo" | "Sessao" | "PacoteAulas"; codigoModalidade: number }> | null;
};

export type NextfitContractBase = { id: number; descricao?: string | null };
export type NextfitReceivable = {
  id: number; codigoCliente: number; dataVencimento: string; dataHora?: string;
  valor?: number; descricao?: string | null;
  receberRecebimento?: { dataRecebimento: string; valorRecebido: number } | null;
  status: "Aberto" | "Recebido" | "Cancelado" | "Renegociado" | "EmAndamento";
};
export type NextfitSale = {
  id: number; codigoCliente: number; data: string; descricao?: string | null;
  status: "Concluida" | "Cancelada" | "Pendente" | "Agendada" | "Erro" | "Processando";
};
export type NextfitAgenda = {
  id: number; dataInicial: string; dataFinal: string; descricao?: string | null;
  participantes?: Array<{
    codigoCliente?: number | null;
    status: "Reservado" | "Presente" | "Falta" | "FaltaJustificada" | "Bloqueado" | "Suspenso" | "Cancelado" | "Desistente";
  }> | null;
};
export type NextfitOpportunity = { id: number; codigoPessoa: number; status: "EmAberta" | "Ganhou" | "Perdeu"; inativo: boolean };

export interface NextfitApi {
  listCustomers(): Promise<NextfitPerson[]>;
  listLeads(): Promise<NextfitPerson[]>;
  listContracts(customerId: number): Promise<NextfitContract[]>;
  listContractBases(): Promise<NextfitContractBase[]>;
  listReceivables(customerId: number): Promise<NextfitReceivable[]>;
  listSales(customerId: number): Promise<NextfitSale[]>;
  listAgenda(from: Date, to: Date): Promise<NextfitAgenda[]>;
  listOpportunities(personId: number): Promise<NextfitOpportunity[]>;
}

export type NextfitLookup =
  | { kind: "not_found" }
  | { kind: "ambiguous"; count: number }
  | { kind: "match"; personType: "customer" | "lead"; person: NextfitPerson };

export type NextfitSnapshot = {
  externalCustomerId?: string;
  source: "nextfit";
  relationshipStatus: "unknown" | "lead" | "customer" | "former_customer";
  firstName?: string;
  customerSince?: string;
  dateOfBirth?: string;
  financialStatus?: string;
  lastVisitAt?: string;
  nextVisitAt?: string;
  activeContracts?: unknown;
  consumedServicesSummary?: unknown;
  attendanceMetrics?: unknown;
  relationshipMetrics?: unknown;
  syncedAt: string;
};
