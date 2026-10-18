# Ravensbourne Place — mapa interativo

Mapa interativo do empreendimento **Ravensbourne Place** (Berkeley Homes / JTP), na área de
Hayes Farm / Rookery Estates, Bromley. Pedido de planejamento **26/02199/OUT** no
[registro do Council de Bromley](https://planningaccess.bromley.gov.uk/pr/s/detail/a0lTv000003RpUXIA0?c__r=Arcus_BE_Public_Register&tabset-ff68f=3).

**Site:** https://leoolmos.github.io/bromley/

## O que tem

- **Tudo num mapa só** (OpenStreetMap ou satélite). Os 12 desenhos de planta térrea (1:200) e
  as duas site plans (1:1000) foram georreferenciados e viraram uma camada de tiles, encaixada no
  terreno real. Dá para dar zoom até ver as plantas de cada casa.
- **As 578 casas e apartamentos da Fase 1** estão no lugar certo. Ao aproximar o mapa, cada casa mostra no
  ponto o número de quartos, em qualquer modo de cor. Clique em qualquer uma para ver:
  - a ficha: quartos e pessoas, tipo, housetype, tenure, área (GIA ou NIA), vagas, acessibilidade,
    parcela e prancha;
  - as **fachadas** e a **planta**, em alta resolução e com zoom;
  - para os 9 prédios (A–G2), a lista de apartamentos por andar, com a área útil de cada um.
- **Fases 1–4**, vetorizadas do *Illustrative Phasing Strategy*, com o cronograma indicativo
  2028–2049 (ES, Cap. C). Mostra também as parcelas da Fase 1 (R-S01 … R-S15).
- **Atualizações**: o status do pedido, as datas-chave, as próximas reuniões do Development Control
  Committee (com a pauta checada) e o histórico de cada *fetch*. Inclui ainda uma linha do tempo dos
  documentos, um gráfico dos comentários públicos e a lista dos 332+ documentos com link direto.
- **☀ Sol — trajetória do sol ao longo do ano**: botão no mapa que abre uma timeline com ▶ play.
  - Modo *Ano*: o sol percorre o arco de cada dia enquanto as datas avançam; clique em "jan" e
    dê play.
  - Modo *Dia*: 24 h, com a noite escurecendo o mapa.
  - No mapa aparecem a trajetória do sol, os solstícios, as direções do nascer e do pôr do sol e a
    **sombra em escala real** de um prédio de referência (9 m) ou da casa/prédio selecionado.
  - Os cálculos usam o algoritmo NOAA em `assets/sun-math.js`, comparado ao pvlib/NREL SPA por
    `node scripts/test_sun.mjs`: erro menor que 0,02° e nascer/pôr do sol com diferença de menos de
    4 s. O horário de verão de Londres (BST) está incluído.
- **Preços — estimativa de cada casa e apartamento** (aba *Preços*, modo de cor *Preço* e um cartão
  na ficha de cada imóvel):
  - valor estimado de imóvel novo a preços de hoje, com faixa provável, £/m², a área usada (GIA/NIA),
    o equivalente usado, o erro típico e os 5 comparáveis de maior peso (com botão para vê-los no mapa);
  - calculadora **"No seu caso"**: entrada, imposto de transmissão (SDLT, com o alívio de primeiro
    imóvel e os adicionais de +5% para quem terá outro imóvel em qualquer país e +2% para não
    residentes), financiamento, prestação mensal e total na compra; nas casas *Intermediate* (shared
    ownership) simula a compra de uma cota e o aluguel do resto; nas de aluguel social mostra o valor
    só como referência;
  - camadas no mapa com as vendas registradas no Land Registry desde 2023 e os imóveis à venda agora
    no OnTheMarket, num raio de 2,5 km;
  - na aba *Preços*: como funciona, precisão, prêmio de imóvel novo, tabela por tipo e quartos,
    gráfico de £/m², vendas e anúncios da região, imóveis novos da Berkeley à venda, premissas de
    custo e fontes. **É uma estimativa indicativa, não uma avaliação nem oferta.**
- Busca por plot ou prédio, cores por quartos, tenure, tipo ou preço, filtros, lista completa, links
  compartilháveis (`#h=R-S12_034`, `#b=blk:E`, `#p=2`, `#t=updates`, `#t=prices`) e PT/EN. Funciona no celular.

## Atualizar os dados do registro

```bash
pip install requests
python3 scripts/fetch_planning.py                         # busca e registra o que mudou
python3 scripts/fetch_planning.py --note-pt "…" --note-en "…"   # com nota de análise
```

O script lê, pela API do próprio portal:
- o registro do pedido (status, datas, decisão);
- a lista completa de documentos (aba **Files**);
- os comentários públicos (só a posição e a data; o texto não é guardado);
- as pautas das próximas reuniões do Development Control Committee.

Ele grava `data/planning.json` e, quando algo mudou, acrescenta uma entrada em `data/updates.json`.
A aba **Atualizações** do site mostra essas entradas.

O workflow `.github/workflows/update-planning.yml` roda o mesmo script todo dia (06:17 UTC) e faz
commit do resultado. Também dá para rodar manualmente em *Actions → Update planning data → Run workflow*.

O servidor do registro não envia o certificado intermediário da Sectigo. O script inclui esse
certificado em `scripts/certs/` e o acrescenta ao bundle de CAs, então a verificação TLS continua completa.

## Atualizar as estimativas de preço

Os dados de mercado ficam em `data/market/` e são gerados pelos scripts de `scripts/market/`
(Python 3 + `requests`). Cada script guarda em cache tudo o que baixa (uma nova rodada não busca de
novo o que já está no cache; apague a pasta para atualizar) e respeita os sites: poucas requisições,
com pausa entre elas, e para em caso de bloqueio (403/429/captcha), sem tentar contornar. Todos usam a
mesma pasta de cache: `$MARKET_CACHE`, ou `~/.cache/bromley-market` se a variável não existir. Rode nesta ordem:

```bash
pip install requests
export MARKET_CACHE=~/.cache/bromley-market   # cache local, fora do repositório (este é o padrão)
python3 scripts/market/fetch_sold.py        # vendas Land Registry + postcodes.io       -> sold.json
python3 scripts/market/fetch_listings.py    # anúncios OnTheMarket (cache em otm/)       -> listings.json
python3 scripts/market/fetch_berkeley.py    # imóveis novos da Berkeley (berkeley/)      -> berkeley.json
python3 scripts/market/fetch_context.py     # UK HPI, SDLT, juros BoE, shared ownership  -> context.json
python3 scripts/market/build_estimates.py   # estimativa de cada imóvel + teste de erro -> estimates.json
```

- `fetch_sold.py`, `fetch_listings.py`, `fetch_berkeley.py` e `build_estimates.py` aceitam `--offline`
  (só o cache, nenhuma requisição); `--cache` muda a pasta e `--out` o arquivo gerado.
- Os anúncios que não são venda normal de mercado ficam fora dos comparáveis: só compra à vista, reforma
  completa, inventário (probate), leasehold com menos de 80 anos, leilão e cotas de shared ownership.
  O mesmo imóvel anunciado por duas imobiliárias conta uma vez. Se a área total escrita no anúncio
  contradiz o campo de área em mais de 10%, vale a do texto, com metade do peso. Vendas em condomínios
  para aposentados ficam marcadas (`retirement`) e fora das medianas.
- A faixa provável cobre 8 em cada 10 casos do teste "deixando um de fora" (por tipo de imóvel), mais a
  incerteza do desconto sobre o preço pedido e, no valor de imóvel novo, a faixa do prêmio (1,05–1,20).
- Imóveis com área de planilha muito diferente da usual do seu housetype (provável erro da planilha) e
  apartamentos para cadeirante (M4(3)) são avaliados pela área típica/padrão (`area_used` em
  `estimates.json`), com o valor pela área da planta em `value_at_plan_area`.
- Contrato: enquanto `sold.json` não tiver áreas, `estimates.homes[*].comps` são ids de anúncios do
  OnTheMarket (preço pedido), resolvidos por `estimates.comps_index` (`basis: "asking"`), e não ids de
  transações do Land Registry (`comps_source` diz qual é o caso).
- As vendas do Land Registry não trazem a área. Para que elas entrem no cálculo, baixe o arquivo de
  certificados de energia (EPC) de Bromley em https://get-energy-performance-data.communities.gov.uk/
  (precisa de conta GOV.UK One Login) e rode
  `python3 scripts/market/fetch_sold.py --epc-csv ~/Downloads/<arquivo>.zip` antes de `build_estimates.py`.
  Sem isso, as estimativas usam os anúncios que informam a área (preço pedido −4,5%).
- O app carrega `data/market/*.json` depois que o mapa aparece (`assets/prices.js`); se os arquivos não
  existirem, o resto do app funciona normalmente.

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `index.html`, `assets/app.js`, `assets/app.css` | O app (Leaflet 1.9.4 via CDN, sem build). |
| `assets/sun.js`, `assets/sun.css`, `assets/sun-math.js` | Simulação do sol (timeline, trajetória, sombra) e cálculo solar. |
| `assets/prices.js`, `assets/prices.css` | Estimativas de preço: cartão e calculadora na ficha, modo de cor *Preço*, camadas de vendas/anúncios e a aba *Preços*. |
| `data/market/` | `sold.json`, `listings.json`, `berkeley.json`, `context.json` e `estimates.json` (gerados por `scripts/market/`). |
| `data/homes.json` | 578 imóveis com coordenadas e ficha; 9 prédios. |
| `data/geo.json` | Polígonos das fases 1–4 e das parcelas da Fase 1. |
| `data/planning.json`, `data/updates.json` | Status atual do pedido e histórico dos fetches. |
| `data/project.json` | Textos das fases, cronograma e notas sobre a decisão, com as fontes. |
| `tiles/` | Tiles WebP (z15–19) das plantas georreferenciadas, mais um índice em `meta.json`. |
| `assets/sheets/` | Pranchas originais (GFP 1–12, Site Plan 1A/1B, Parcel Plan, Phasing). |
| `assets/units/` | Fachadas (`elev/`), plantas (`plan/`) e plantas em alta resolução (`plan-hd/`) por tipologia ou prédio. |
| `scripts/` | `fetch_planning.py`, `build_data.py`, `build_tiles.py`, as fontes em `scripts/source/` e os scripts de preço em `scripts/market/`. |

### Como as plantas foram georreferenciadas

Cada desenho foi registrado por correlação de imagem:
1. O *Development Parcel Plan* (1:2000) foi alinhado aos contornos de prédios do OpenStreetMap, em
   British National Grid.
2. As *Site Plans* 1A e 1B (1:1000) e o *Phasing Strategy* foram alinhados ao Parcel Plan pela linha
   vermelha do limite do pedido.
3. As 12 plantas térreas (1:200) foram alinhadas às site plans pelo traçado das casas.

As transformações (pixel → EPSG:27700) estão em `scripts/source/georef.json`. Casas que aparecem
em duas pranchas vizinhas coincidem com diferença de poucos centímetros. Em relação ao mapa, a
precisão é de cerca de 1–2 m.

Para refazer os dados e os tiles: `python3 scripts/build_data.py && python3 scripts/build_tiles.py`
(precisa de numpy, opencv-python-headless, pillow e pyproj).

## Fontes

Todos os dados e desenhos vêm dos documentos públicos do pedido 26/02199/OUT no registro de Bromley:
- Phase 1 Plot Schedule Rev P2 e Phase 1 Apartments Schedule (out/2026);
- Ground Floor Plans 1–12, Phase 1A/1B Site Plans e Development Parcel Plan;
- desenhos de cada house type e de cada prédio;
- ES Vol 1 Cap. C e Vol 2 Apêndice C4 (Illustrative Phasing Strategy);
- Further Environmental Information (set/2026).

Os dados de preço vêm de: HM Land Registry (Price Paid Data e UK House Price Index — *Contains HM
Land Registry data © Crown copyright and database right 2026. This data is licensed under the Open
Government Licence v3.0.*), ONS Postcode Directory via postcodes.io (OGL v3.0), anúncios do
OnTheMarket, site do Berkeley Group, Bank of England (Bankstats G1.3) e GOV.UK (SDLT e shared
ownership, OGL v3.0). As datas de cada fonte aparecem na aba *Preços*.

Mapa base © OpenStreetMap contributors; imagem de satélite © Esri.
