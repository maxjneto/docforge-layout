# Plano — `@docforge/layout` (lib do novo formato de documento) + playground

## Contexto

Novo produto do DocForge (análise em https://claude.ai/code/artifact/0ea1b0a4-94f4-4538-8080-7c5ac64bdefc): documentos feitos de **componentes posicionados numa grade**, onde o agente pede uma posição e a lib **mede por conta e devolve um diagnóstico em texto**, sem o agente ver a tela. A lib é o centro do sistema: guarda nada, mas sabe medir, posicionar, validar, paginar e gerar HTML. Este ciclo constrói **só a lib, num repositório próprio, com um playground** — sem backend, sem MCP, sem Chromium no servidor, sem tocar no app atual.

Decisões já tomadas com o usuário:
- Lib em TypeScript; fonte do documento é **JSON**, HTML é saída.
- **10 componentes** neste ciclo: Texto, Lista, Tabela, Código, Etapas, Linha do tempo, KPI, Gráfico, Imagem, Divisor. Diagrama fica fora.
- Estilos: tokens → presets por tipo → camadas **documento → região da grade → label → componente** (mais específico vence, origem de cada propriedade visível) → CSS gerado. Região é presa à grade (não à página), porque nem todo documento é paginado.
- Superfícies neste ciclo: **A4 paginado** e **página contínua** (export para humanos). Variantes de tela ficam para depois.
- PDF = print do navegador sobre páginas de tamanho fixo geradas pela lib.

## Decisões técnicas

1. **Medição igual ao render, por construção.** A lib mede com **fontkit** (mesmo código e mesmos arquivos de fonte no Node e no navegador), decide as quebras de linha (`Intl.Segmenter`, granularidade `word`; palavra longa quebra por grafema) e renderiza **cada linha pronta** (`display:block; white-space:pre`, `line-height` em px). A altura vira `linhas × entrelinha` — exata por definição. O único desvio possível é horizontal (shaping do navegador vs fontkit); tolerância de 1 px, conferida no teste de conformidade.
   - Fallback se o fontkit não rodar bem no Vite/browser: `opentype.js`. Verificar no 1º dia.
2. **Fontes embarcadas**: Inter (400/500/600/700 + itálico 400) e JetBrains Mono (400/600), arquivos OFL em `fonts/` na raiz do repo da lib. API `registerFonts([{family, weight, style, data: ArrayBuffer}])`: Node lê do disco, navegador faz `fetch` e também registra `FontFace` com os mesmos bytes. Nunca fonte do sistema.
3. **Grade em faixas.** Documento → seções → **faixas** (`band`, com ID e altura em unidades da grade) → componentes com `colStart`/`colSpan` (12 colunas). Área de um componente = `colSpan × band.span` unidades (célula = área fixa N). `span: "auto"` deixa a lib calcular a altura mínima. Inserir faixa não renumera nada.
4. **Schema com zod** — tipos, validação em runtime e, depois, JSON Schema para o MCP.
5. **Lib sem framework**: saída `render(doc, surfaceId) → { html, css }`. Estilos resolvidos viram estilo inline (determinístico, seguro para PDF).
6. **Repo próprio.** A lib nasce em um repositório novo, `docforge-layout`, em `C:\Users\MAX\Desktop\Projetos\docforge-layout` (irmão do `doc-forge`), com `git init` local. Remote/GitHub só quando o usuário pedir (é open source; publicar é decisão dele). Pacote npm `@docforge/layout`. O playground mora no mesmo repo (pasta `playground/`, Vite só de desenvolvimento, fora do pacote publicado). O DocForge atual não é tocado neste ciclo; depois ele consome a lib como dependência publicada (npm ou git), o que evita mexer no contexto do Docker do frontend.

## Modelo de dados (resumo)

```ts
Document { version, meta, tokens, styles: { presets, regions[], labels{} },
           surfaces[], sections[], components{} }
Surface  = { id, kind: "page", size: "A4"|{w,h}, margin } | { id, kind: "continuous", width }
Section  { id, name?, bands: Band[] }
Band     { id, span: number|"auto", items: { component, colStart, colSpan }[] }
Component{ id, type, props, content, labels: string[], style: Partial<Props> }
Region   { id, section, bands?: string[], cols?: [start, end], style }   // camada da grade
```

## Estrutura do repo

```
docforge-layout/
  package.json        @docforge/layout (type: module, exports src compilado)
  tsconfig.json  vitest.config.ts  tsup.config.ts (build ESM + d.ts)
  fonts/              Inter, JetBrains Mono (OFL) + LICENSE das fontes
  src/                a lib (abaixo)
  test/               unit (vitest, node)
  playground/         index.html, main.tsx, vite.config.ts — React só aqui
  examples/           relatorio.json, one-pager.json, proposta.json
  README.md  LICENSE
```

## Estrutura de `src/`

| Pasta | Conteúdo |
| --- | --- |
| `schema/` | zod do documento, de cada componente e dos tokens |
| `fonts/` | registro de fontes, cache de glyph widths (fontkit) |
| `text/` | segmentação, quebra de linha com runs ricos (negrito, itálico, cor, destaque, link, código, tamanho da escala) |
| `style/` | tokens, presets, resolução em cascata com origem (`resolveStyle → { prop: { value, origin } }`) |
| `components/` | um arquivo por tipo: `schema`, `measure(content, style, area)`, `render(...)`, `paginate?` (split) |
| `layout/` | grade → caixas absolutas por superfície; paginação (faixa inteira vai para a próxima página; faixa com um único componente divisível — Tabela, Lista, Texto, Código — quebra entre linhas/itens; Tabela repete cabeçalho) |
| `validate/` | diagnósticos `{ severity, code, component, message, data, suggestions[] }` |
| `ops/` | `place`, `update`, `setStyle`, `insertBand`, `moveBand`, `remove` — puras, retornam `{ doc, diagnostics }` |
| `map/` | `getMap(doc, level 0\|1\|2, region?)` → texto para agente + objeto estruturado |
| `render/` | HTML/CSS por superfície; `@page` + `break-after` para A4; página contínua com altura = conteúdo |

Regras de tamanho por componente: **conteúdo define** (Texto, Lista, Tabela, Código, Etapas, Linha do tempo → diagnóstico de transbordo com "faltam N px / M linhas da grade") e **área define** (KPI, Gráfico, Imagem, Divisor → diagnóstico de legibilidade: fonte mínima, rótulos sem sobreposição, Imagem exige `width/height` intrínsecos). Gráfico = SVG próprio (barras, linha, pizza), rótulos medidos com fontkit. Código sem realce de sintaxe neste ciclo; linha maior que a área quebra e gera aviso.

Diagnósticos mínimos: transbordo, legibilidade, sobreposição de colunas, coluna fora da grade, faixa mais alta que a página, componente inexistente, token desconhecido, valor solto (aviso), conflito entre labels/regiões, linha de código quebrada.

Mensagens de diagnóstico e do mapa em inglês (público: agentes); código em inglês.

## Playground (`npm run playground`, dentro do repo da lib)

Três colunas: editor JSON do documento (com documentos de exemplo: relatório, one-pager, proposta) · render da superfície escolhida (A4 / contínua) com botão **Imprimir/PDF** · painel com mapa (níveis 0–2) e diagnósticos. Aba **Conformidade**: gera ~300 casos (textos, larguras, tamanhos, runs mistos, listas, tabelas, código), renderiza no DOM real e compara alturas/larguras com a conta da lib; mostra % de acerto e os casos que falharam.

## Marcos

1. **Fundação** — pacote, schema, fontes, medição de texto rico + testes.
2. **Estilos e grade** — tokens/presets/regiões/labels com origem; faixas; Texto e Lista; render HTML; mapa; diagnósticos.
3. **Demais componentes** — Tabela (com split), Código, Etapas, Linha do tempo, KPI, Gráfico, Imagem, Divisor.
4. **Superfícies** — paginação A4 e página contínua; CSS de impressão.
5. **Operações** — API de ops retornando diagnóstico.
6. **Playground** — UI, exemplos, conformidade.

Primeiro passo após aprovação: salvar este plano em `doc-forge/docs/product/layout-lib-plan.md` (preferência do usuário: planos viram docs) e também como `docs/PLAN.md` no repo novo.

## Arquivos críticos

- novo repo inteiro: `C:\Users\MAX\Desktop\Projetos\docforge-layout\`
- `doc-forge`: só o doc do plano em `docs/product/layout-lib-plan.md`; nenhum código do app muda.
- referência visual para o "chrome" do playground: tokens de `doc-forge/packages/frontend/src/index.css` (copiados, não importados).

## Verificação

- `npm test` — unit (vitest/node): medição determinística, quebra de linha com runs, cascata com origem, colisões na grade, paginação (incl. tabela repetindo cabeçalho), ops, snapshot do mapa.
- `npm run typecheck` e `npm run build` (tsup gera ESM + tipos).
- `npm run playground` → aba Conformidade: **≥ 99% dos casos dentro da tolerância** (critério do spike).
- Abrir os 3 exemplos, imprimir em PDF (A4 e contínua) e conferir: sem corte, quebras nos lugares previstos, tabela com cabeçalho repetido, mesmo visual da tela.

## Riscos e respostas

- fontkit no browser → `opentype.js`.
- Largura divergente em casos de borda (emoji, fallback) → fora do catálogo de fontes = diagnóstico "glyph não suportado"; conformidade mede.
- Escopo grande (10 componentes) → marcos 1–2 provam a medição antes dos demais componentes; se a conformidade ficar abaixo de 99% no marco 2, parar e reavaliar antes do marco 3.
