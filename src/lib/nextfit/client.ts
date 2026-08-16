import type {
  NextfitAgenda, NextfitApi, NextfitContract, NextfitContractBase,
  NextfitOpportunity, NextfitPerson, NextfitReceivable, NextfitSale,
} from "./types.ts";

const NEXTFIT_API_BASE_URL = "https://integracao.nextfit.com.br/api/v1";
const PAGE_SIZE = 200;
const MAX_PAGES = 100;

type Paged<T> = { items?: T[] | null; temProximaPagina: boolean };

export class NextfitClient implements NextfitApi {
  constructor(private readonly apiKey: string) {}

  private async getPage<T>(path: string, params: URLSearchParams): Promise<Paged<T>> {
    const response = await fetch(`${NEXTFIT_API_BASE_URL}${path}?${params}`, {
      headers: { "X-Api-Key": this.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Nextfit request failed with HTTP ${response.status}`);
    return response.json() as Promise<Paged<T>>;
  }

  private async all<T>(path: string, input: Record<string, string> = {}): Promise<T[]> {
    const results: T[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams(input);
      params.set("Skip", String(page * PAGE_SIZE));
      params.set("Take", String(PAGE_SIZE));
      const response = await this.getPage<T>(path, params);
      results.push(...(response.items ?? []));
      if (!response.temProximaPagina) return results;
    }
    throw new Error("Nextfit pagination safety limit reached");
  }

  listCustomers() { return this.all<NextfitPerson>("/Pessoa/GetClientes"); }
  listLeads() { return this.all<NextfitPerson>("/Pessoa/GetLeads"); }
  listContracts(customerId: number) { return this.all<NextfitContract>("/ContratoCliente", { CodigoCliente: String(customerId) }); }
  listContractBases() { return this.all<NextfitContractBase>("/ContratoBase"); }
  listReceivables(customerId: number) { return this.all<NextfitReceivable>("/ContaReceber", { CodigoCliente: String(customerId) }); }
  listSales(customerId: number) { return this.all<NextfitSale>("/Venda", { CodigoCliente: String(customerId) }); }
  listOpportunities(personId: number) { return this.all<NextfitOpportunity>("/Oportunidade", { CodigoPessoa: String(personId) }); }
  listAgenda(from: Date, to: Date) {
    return this.all<NextfitAgenda>("/Agenda", { DataInicial: from.toISOString(), DataFinal: to.toISOString() });
  }
}
