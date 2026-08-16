import type {
  NextfitAgenda, NextfitApi, NextfitContract, NextfitContractBase,
  NextfitOpportunity, NextfitPerson, NextfitReceivable, NextfitSale,
} from "./types.ts";

const NEXTFIT_API_BASE_URL = "https://integracao.nextfit.com.br/api/v1";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

type Paged<T> = { items?: T[] | null; temProximaPagina: boolean };

export class NextfitClient implements NextfitApi {
  constructor(private readonly apiKey: string) {}

  private async getPage<T>(path: string, params: URLSearchParams): Promise<Paged<T>> {
    try {
      const response = await fetch(`${NEXTFIT_API_BASE_URL}${path}?${params}`, {
        headers: { "X-Api-Key": this.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (!response.ok) {
        const responseText = await response.text();
        const validation = responseText.slice(0, 400)
          .replace(/(api[-_ ]?key|authorization|token)[^,}\]]*/gi, "$1:[redacted]")
          .replace(/[\r\n]+/g, " ");
        console.warn("Nextfit API request rejected", { endpoint: path, status: response.status,
          ...(validation ? { validation } : {}) });
        throw new Error(`Nextfit HTTP ${response.status}`);
      }
      return response.json() as Promise<Paged<T>>;
    } catch (error) {
      if (!(error instanceof Error && error.message.startsWith("Nextfit HTTP"))) {
        console.warn("Nextfit API request failed", { endpoint: path, error: error instanceof Error ? error.name : "UnknownError" });
      }
      throw error;
    }
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
