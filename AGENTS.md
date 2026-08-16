<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Regras permanentes do projeto

- A Nextfit será o source of truth operacional.
- O Neon guarda memória própria, dados derivados e cache; não substitui a Nextfit.
- Nunca duplicar dados desnecessariamente nem inventar dados ausentes.
- Separar WhatsApp, IA, conhecimento, customer context e integrações.
- Preservar privacidade e aplicar minimização de dados.
- Rodar testes, lint e build antes de cada conclusão.
- Manter a arquitetura simples e evitar dependências sem necessidade.
