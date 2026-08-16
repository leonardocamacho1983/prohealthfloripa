# Customer Intelligence Engine

Camada determinística e recalculável. O LLM não define métricas, estados ou recomendações.

## Estados

- `new_lead`: cadastro identificado como lead, sem contrato ativo.
- `active_customer`: ao menos um contrato ativo, sem evidência suficiente para outro estado.
- `engaged_customer`: contrato ativo e pelo menos 4 presenças nos últimos 30 dias.
- `declining_engagement`: contrato ativo, ao menos 4 presenças somadas nos períodos comparados, ao menos 2 entre 31–60 dias e queda de 50% ou mais nos últimos 30 dias.
- `at_risk`: contrato ativo e última presença há 45–89 dias.
- `inactive`: contrato ativo e última presença há 90 dias ou mais.
- `former_customer`: relacionamento anterior e nenhum contrato ativo.
- `neutral`: dados insuficientes para classificação segura.

As regras têm precedência na ordem: lead/ex-cliente, inativo, risco, queda, engajado e ativo.

## Recomendações

Cada recomendação contém `reason`, `confidence` e `evidence`. Renovação exige vencimento em até 30 dias; pacote de massagem e recovery exigem ao menos 3 registros; aniversário pessoal ou de relacionamento exige proximidade de até 7 dias; pendência vencida gera somente acompanhamento humano. Na ausência de evidência, retorna `no_action`.

O engine não envia mensagens, não concede descontos, não decide condutas clínicas e não escreve no Nextfit.
