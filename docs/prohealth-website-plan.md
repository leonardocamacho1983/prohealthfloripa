# Plano do website público da ProHealth Floripa

Status: direção recomendada para aprovação  
Escopo desta versão: website institucional e de conversão, convivendo com a aplicação operacional existente  
Base factual: `src/lib/knowledge/prohealth.ts`, `README.md` e acervo visual recebido em 14/08/2026

## 1. Decisão central

A ProHealth não deve parecer uma academia genérica, uma clínica branca nem um spa temático. O espaço já oferece uma linguagem própria: azul profundo, gelo, madeira aquecida, luz âmbar, metal e reflexos. O website deve transformar essa combinação em uma experiência de marca que comunique três ideias confirmadas:

- movimento;
- recuperação;
- performance.

Direção de posicionamento recomendada:

> Movimento, recuperação e performance. No mesmo lugar.

O público principal continua sendo o que já está confirmado no conhecimento da aplicação: atletas profissionais, amadores e praticantes de atividade física. O site deve receber também quem busca Pilates, fisioterapia, massagem ou recuperação sem exigir que a pessoa se identifique como atleta.

## 2. Objetivos do website

Ordem de prioridade:

1. Gerar conversas qualificadas no WhatsApp.
2. Converter interesse em aula experimental gratuita de Pilates.
3. Explicar rapidamente a combinação de serviços sem fazer promessas clínicas.
4. Mostrar que existe um espaço real, singular e preparado em Florianópolis.
5. Direcionar intenção de compra para o fluxo oficial da Nextfit.
6. Reforçar confiança com endereço, horário, limites de turma e informações institucionais verificadas.

Não usar o website para:

- diagnosticar, prescrever ou afirmar aptidão clínica;
- prometer recuperação, cura ou resultado esportivo;
- publicar disponibilidade específica sem confirmação;
- duplicar tabelas de preço que possam divergir da Nextfit;
- inventar depoimentos, números, certificações ou protocolos.

## 3. Situação técnica atual

A rota pública `/` ainda é um placeholder. A aplicação interna já possui rotas protegidas para atendimento, métricas e administração. O site institucional pode ser implementado na mesma aplicação Next.js, mantendo a separação:

- público: `/`, `/servicos/*`, `/espaco`, `/contato`;
- interno e autenticado: `/handoff`, `/metrics`, `/admin`;
- integrações operacionais: rotas `/api/*` existentes.

Isso evita um segundo projeto e preserva a arquitetura simples. A proteção atual não bloqueia a home pública. Antes de qualquer implementação, ler as instruções da versão instalada do Next.js em `node_modules/next/dist/docs/`, conforme `AGENTS.md`.

## 4. Conceito visual selecionado

### Nome interno

**Cold Precision / Warm Care**

### Paleta funcional

- `Deep Navy`: fundo principal e sensação de precisão.
- `Performance Blue`: ação, links e sinalização de marca.
- `Ice Cyan`: reflexos, linhas e estados de foco.
- `Warm Amber`: acolhimento, madeira e luz humana.
- `Bone White`: superfícies, texto claro e neutralidade.

Os valores hexadecimais devem ser extraídos do logo original e de fotografias aprovadas, não escolhidos por aproximação antes de receber os arquivos oficiais da marca.

### Tipografia

- display: geométrica, firme e levemente técnica;
- texto: sans humanista, muito legível em tela;
- números e informações práticas: variante tabular ou mono apenas em detalhes.

Evitar fontes excessivamente futuristas, itálico esportivo em grandes blocos e estética de e-sports. A tipografia não deve competir com o símbolo ProHealth.

### Movimento

O movimento deve parecer preciso e corporal: aceleração curta, desaceleração suave e microparallax. Evitar partículas gratuitas, glitch, rotação 3D de cartões e scroll que prenda o usuário.

## 5. Abertura cinematográfica

### Storyboard recomendado — 1,8 segundo

| Tempo | Cena | Som |
| --- | --- | --- |
| 0,00–0,30 s | Tela azul-marinho; conteúdo real já carregando atrás. | Sem som automático. |
| 0,30–0,85 s | Uma linha âmbar desenha a geometria angular observada no LED do teto. | — |
| 0,85–1,25 s | A linha se torna azul-gelo, ganha uma refração curta e forma o monograma da marca. | — |
| 1,25–1,80 s | O monograma abre como máscara e revela o hero; headline e CTAs entram em sequência. | — |

Regras:

- executar no máximo uma vez por sessão;
- disponibilizar `Pular` quando a animação ultrapassar 700 ms;
- respeitar `prefers-reduced-motion` e revelar o hero imediatamente;
- nunca esperar vídeo para mostrar título e CTA;
- construir com SVG, CSS e Web Animations API antes de considerar uma dependência;
- não usar áudio automático.

### Hero após a abertura

Eyebrow:

> PRO HEALTH · FLORIANÓPOLIS

Título:

> Movimento, recuperação e performance. No mesmo lugar.

Texto:

> Pilates, fisioterapia, massagens, termoterapias e preparação física para atletas e pessoas ativas.

CTA principal:

> Falar com a ProHealth

CTA secundário:

> Conhecer os serviços

Sinal de conversão:

> Aula experimental de Pilates gratuita.

## 6. Arquitetura da home

### 1. Hero

Objetivo: posicionamento e início de conversa. Usar poster estático forte como LCP; carregar um loop de 5–7 segundos somente depois.

### 2. Escolha seu caminho

Cards editoriais para:

- Pilates;
- Fisioterapia;
- Massagens;
- Recovery e termoterapias;
- Movimento e preparação física.

Cada card deve explicar a modalidade sem benefícios absolutos e levar a uma seção ou página dedicada.

### 3. Uma abordagem integrada

Mostrar como corpo, movimento, recuperação e performance coexistem na proposta da ProHealth. Não apresentar etapas clínicas ou um protocolo universal que ainda não esteja documentado.

### 4. Pilates em grupos de até três pessoas

Seção de alta conversão, com o limite confirmado da agenda e destaque para a aula experimental gratuita. CTA direto para WhatsApp.

### 5. Recovery e termoterapias

Usar a sala de banheira como principal assinatura visual. Explicar banheira de gelo, banho quente e contraste em linguagem prudente, com chamada para confirmação prévia quando houver condição médica ou dúvida de segurança.

### 6. Massagens e fisioterapia

Separar cuidado corporal de promessas terapêuticas. Mostrar ambiente, técnicas confirmadas e atendimento individual. Não despejar a lista completa de técnicas na home; levar para página específica.

### 7. O espaço

Galeria imersiva com três capítulos:

- precisão: equipamentos de Pilates;
- recuperação: termoterapia;
- presença: salas de massagem e detalhes de madeira/luz.

### 8. Para quem é

Atletas profissionais, amadores e pessoas fisicamente ativas. Usar cenas humanas autênticas quando o novo ensaio estiver pronto.

### 9. Informações práticas

- Rua Vera Linhares de Andrade, 2063, Córrego Grande, Florianópolis;
- segunda a sexta, primeiro horário às 08h, último cliente entra às 20h, encerramento às 21h;
- fim de semana somente com agendamento prévio para clientes de planos;
- WhatsApp, e-mail e Instagram confirmados.

Preferir um link para abrir o mapa em vez de um mapa interativo pesado no carregamento inicial.

### 10. FAQ factual

Começar com perguntas de alto valor e respostas verificadas:

- A aula experimental de Pilates é gratuita?
- Quantas pessoas participam de uma aula de Pilates?
- Quanto tempo dura um atendimento?
- A ProHealth atende no fim de semana?
- Onde fica a ProHealth?
- Como confirmar se a termoterapia é adequada para mim?

### 11. CTA final

> Seu próximo passo começa com uma conversa.

Botões: WhatsApp e conhecer planos. O link de compra deve continuar sendo o oficial da Nextfit.

## 7. Páginas recomendadas

MVP:

- `/` — home;
- `/servicos/pilates`;
- `/servicos/fisioterapia`;
- `/servicos/massagens`;
- `/servicos/recovery-termoterapias`;
- `/espaco`;
- `/contato`.

Fase posterior, quando houver conteúdo próprio suficiente:

- `/servicos/preparacao-fisica`;
- páginas de técnicas de massagem com demanda comprovada;
- conteúdo educativo local, revisado para não virar aconselhamento médico genérico.

## 8. Auditoria do acervo visual

### Fotografias

| Arquivo | Avaliação | Uso recomendado | Tratamento |
| --- | --- | --- | --- |
| `15.50.05.jpeg` | A− | Destaque de recovery; origem do frame conceito. | Correção de perspectiva, limpeza localizada, grade azul/âmbar e crop 16:9. |
| `15.50.11 (1).jpeg` | B | Plano geral da sala de Pilates. | Reduzir dominante amarela, controlar janelas, corrigir perspectiva e escolher um recorte menos congestionado. |
| `15.50.11 (2).jpeg` | B− | Detalhe de equipamento e profundidade. | Crop mais fechado, nitidez seletiva e equilíbrio entre armário âmbar e piso azul. |
| `15.50.11.jpeg` | B+ | Transição para área de termoterapia; arquitetura. | Endireitar, remover pequenas distrações e preservar desenho de luz. |
| `15.50.12 (1).jpeg` | A− | Melhor plano amplo do Pilates. | Crop editorial, controle de reflexos e redução de informação nas bordas. |
| `15.50.12 (2).jpeg` | B | Apoio para massagens/recovery e detalhes do espaço. | Organizar visualmente toalhas e objetos; não transformar em hero. |
| `15.50.12 (3).jpeg` | C+ | Referência documental da sala de massagem. | Não publicar como imagem principal; há ventiladores, ring light, utilidades e excesso de informação. Priorizar novo ensaio. |
| `15.50.12.jpeg` | A | Melhor ativo de marca no ambiente. | Usar em reveal, seção do espaço ou transição; preservar logo exatamente. |
| `15.52.38.jpeg` | A− | Motivo de animação e detalhe arquitetônico. | Crop vertical, grade mais fria e uso da geometria do LED como linguagem de movimento. |
| `15.53.27.jpeg` | C | Backup vertical/social. | Resolução menor, fio aparente e utilidades; não usar na home sem edição localizada forte. |

Leitura geral:

- há resolução suficiente em nove das dez fotos para uso web;
- o acervo prova espaço e identidade, mas quase não prova experiência humana;
- os panoramas apresentam deformação e excesso de informação;
- o contraste azul/âmbar é o maior ativo;
- os murais temáticos funcionam melhor como contexto do que como tema literal do site;
- a ausência de pessoas faz o conjunto parecer catálogo de interiores se for usado sozinho.

### Vídeos

| Arquivo | Dados | Decisão |
| --- | --- | --- |
| `15.50.07.mp4` | 17,132 s; vertical; 464×832; passeio pela banheira. | B-roll mobile de 2–3 s após estabilização, redução de ruído e crop. Não usar como hero desktop. |
| `15.50.10.mp4` | 26,065 s; vertical; 464×832; passeio pela sala de massagem. | Fonte de detalhes curtos. Exige limpeza visual e seleção rigorosa; não usar o passeio inteiro. |

Os vídeos foram comprimidos pelo WhatsApp. Upscale pode melhorar percepção, mas não recupera informação óptica inexistente. A melhor solução para o hero é filmagem nova horizontal; a segunda melhor é animar uma fotografia aprovada com movimento de câmera mínimo e sem alterar o espaço.

## 9. Frame conceito produzido

Arquivo:

`docs/assets/prohealth-cold-therapy-hero-concept.png`

O frame foi criado com ChatGPT Image a partir de `15.50.05.jpeg` para validar composição, cor e atmosfera. Ele é direção de arte, não fotografia documental final: houve limpeza e recomposição generativa de áreas. Antes de publicar, comparar com o espaço real e repetir o tratamento com máscaras localizadas se qualquer detalhe tiver sido alterado.

## 10. Pipeline de tratamento cinematográfico

### Camada 1 — seleção documental

- preservar todos os originais;
- escolher crop desktop, tablet e mobile antes de editar;
- classificar cada saída como documental ou conceito;
- não misturar as duas categorias sem sinalização interna.

### Camada 2 — ChatGPT Image

Usar para:

- remover fios, suportes, pequenas utilidades e manchas;
- corrigir perspectiva e expandir bordas quando necessário;
- criar variações de enquadramento;
- validar mood e grade de cor.

Invariantes em todo prompt:

- preservar equipamentos, arquitetura, proporções e materiais;
- não adicionar pessoas;
- não inventar luxo, tecnologia, certificação ou estrutura;
- não alterar logotipo nem texto de marca;
- sem watermark e sem texto gerado.

### Camada 3 — Higgsfield

Após o plugin/CLI estar conectado, usar image-to-video para:

- dolly-in de 3–5 segundos;
- microparallax em água, madeira e reflexos;
- movimento muito sutil de luz;
- estabilização e upscale dos B-rolls verticais;
- variações 16:9 e 9:16 a partir do mesmo shot aprovado.

Regras negativas para vídeo:

- sem água transbordando ou gelo aparecendo do nada;
- sem movimento de equipamentos;
- sem mudar portas, janelas ou dimensões;
- sem pessoas geradas;
- sem câmera impossível, drone interno ou velocidade publicitária exagerada;
- preservar qualquer logo quadro a quadro.

### Camada 4 — acabamento

- grade coerente azul profundo + âmbar controlado;
- redução de ruído e estabilização;
- cortes curtos, sem transições de template;
- poster dedicado para cada vídeo;
- legenda descritiva e alt text para imagens informativas.

### Camada 5 — validação de verdade visual

Checklist obrigatório antes de publicar:

- o ambiente existe assim?
- o equipamento é o mesmo?
- nenhum logo ou texto foi alterado?
- nenhum objeto relevante desapareceu?
- a imagem sugere um serviço que não existe?
- uma pessoa que conhece o espaço reconhece o local sem ressalvas?

## 11. Ensaio complementar necessário

O acervo atual não mostra pessoas. Um ensaio curto de 60–90 minutos pode gerar o que falta:

1. Plano horizontal de movimento controlado no Pilates, com instrutor e cliente reais.
2. Close de mãos ajustando equipamento, sem parecer encenação clínica.
3. Plano de força/mobilidade com expressão concentrada.
4. Entrada na banheira antes da imersão, respeitando privacidade e segurança.
5. Detalhe de água, vapor e textura; banho frio e quente filmados separadamente.
6. Massagem com enquadramento de mãos e materiais, sem rosto se não houver autorização ampla.
7. Fisioterapia em conversa ou movimento, sem simular diagnóstico.
8. Retrato ambiental da equipe.
9. Fachada/chegada e referência do Córrego Grande.
10. Planos vazios limpos em 16:9, 4:5 e 9:16.

Captação recomendada:

- horizontal 4K para hero e páginas;
- vertical 4K para reels e mobile;
- movimentos lentos em tripé, monopé ou gimbal;
- luz existente preservada, com preenchimento discreto;
- todos os cabos, ventiladores, caixas e itens utilitários retirados antes;
- autorizações de imagem arquivadas.

## 12. Orçamento de performance e acessibilidade

Metas do projeto:

- poster do hero em AVIF: até 220 KB por breakpoint;
- loop desktop: até 3 MB, 5–7 s, sem áudio, `muted`, `playsInline`;
- mobile: poster estático por padrão ou loop específico de até 1,2 MB;
- nenhum vídeo como requisito para ler título ou usar CTA;
- animação de abertura sem biblioteca 3D pesada;
- dimensões de imagem declaradas para evitar layout shift;
- foco visível, contraste validado e alvos de toque confortáveis;
- reduced motion completo, não apenas redução de velocidade;
- carregamento diferido de galeria, mapa e mídia abaixo da dobra.

Não servir os MP4s originais do WhatsApp diretamente. Eles somam cerca de 8,7 MB e entregam apenas 464×832.

## 13. Conversão, mensuração e privacidade

Eventos úteis, sem conteúdo de mensagem nem PII:

- clique no WhatsApp do hero;
- clique em aula experimental de Pilates;
- clique em conhecer planos/Nextfit;
- clique em endereço/rotas;
- conclusão de 50% e 90% das páginas de serviço;
- abertura e resposta de FAQ;
- erro de reprodução de mídia.

Não registrar texto digitado, telefone, dados clínicos ou identificadores da Nextfit em analytics de marketing.

## 14. SEO e conteúdo

Página inicial deve explicar a categoria e a localização já no título e no primeiro bloco. Páginas de serviço devem ter conteúdo próprio, não apenas cards duplicados.

Diretrizes:

- um único H1 por página;
- títulos e descrições locais, factuais e sem promessa médica;
- dados estruturados somente com informações institucionais verificadas;
- FAQ derivado de políticas e fatos confirmados;
- alt text descrevendo o ambiente ou a ação, sem repetir palavras-chave;
- preços somente quando vierem de uma fonte oficial atual ou com fluxo explícito de atualização;
- depoimentos apenas com autorização e origem verificável.

## 15. Sequência de execução

### Fase 0 — aprovação

- aprovar posicionamento e hero copy;
- aprovar direção `Cold Precision / Warm Care`;
- definir se o frame conceito pode inspirar o hero ou se o hero espera novo ensaio;
- receber logo vetorial e arquivos de marca oficiais.

### Fase 1 — sistema visual e protótipo

- tokens de cor e tipografia;
- hero e storyboard funcional;
- home responsiva em conteúdo real;
- validação de navegação e CTA sem mídia pesada.

### Fase 2 — ativos

- tratar seis fotografias prioritárias;
- produzir três loops curtos;
- executar ensaio complementar;
- exportar crops e posters.

### Fase 3 — implementação

- substituir o placeholder da home;
- criar páginas MVP;
- integrar WhatsApp e link oficial Nextfit;
- metadados, sitemap, dados estruturados e analytics minimizado;
- preservar rotas e autenticação internas existentes.

### Fase 4 — QA

- telefone, tablet, laptop e desktop grande;
- reduced motion, teclado e contraste;
- conexões lentas e falha de vídeo;
- conteúdo e segurança clínica;
- lint, testes e build;
- conferência visual da unidade pela equipe.

## 16. Bloqueadores para publicação final

- logo vetorial/brand kit ainda não recebido;
- não há fotos humanas autorizadas;
- os vídeos atuais não têm qualidade para hero desktop;
- qualquer imagem generativa precisa de validação de fidelidade;
- não há depoimentos reais fornecidos;
- definição de preços públicos deve respeitar a Nextfit como fonte operacional.

## 17. Próxima decisão recomendada

Seguir com um protótipo funcional da home usando:

- frame conceito apenas como referência temporária;
- fotografia `15.50.12.jpeg` para a revelação de marca;
- fotografia `15.50.12 (1).jpeg` para Pilates;
- fotografia `15.50.05.jpeg` para recovery;
- fotografia `15.50.12 (2).jpeg` como detalhe de cuidado;
- posters estáticos no primeiro carregamento;
- animação SVG de 1,8 segundo.

Em paralelo, planejar o ensaio humano. Isso permite avançar o produto sem aceitar os vídeos comprimidos como limite visual da marca.
