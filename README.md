# Ravensbourne Place — mapa interativo

Mapa interativo do empreendimento **Ravensbourne Place** (Berkeley Homes / JTP), na área de
Hayes Farm / Rookery Estates, Bromley. Pedido de planejamento **26/02199/OUT** no
[registro do Council de Bromley](https://planningaccess.bromley.gov.uk/pr/s/detail/a0lTv000003RpUXIA0?c__r=Arcus_BE_Public_Register&tabset-ff68f=3).

**Site:** https://leoolmos.github.io/bromley/

## O que tem

- **Tudo num mapa só** (OpenStreetMap ou satélite). Os 12 desenhos de planta térrea (1:200) e
  as duas site plans (1:1000) foram georreferenciados e viraram uma camada de tiles, encaixada no
  terreno real. Dá para dar zoom até ver as plantas de cada casa.
- **As 578 casas e apartamentos da Fase 1** estão no lugar certo. Clique em qualquer um para ver:
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
- Busca por plot ou prédio, cores por quartos, tenure ou tipo, filtros, lista completa, links
  compartilháveis (`#h=R-S12_034`, `#b=blk:E`, `#p=2`, `#t=updates`) e PT/EN. Funciona no celular.

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

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `index.html`, `assets/app.js`, `assets/app.css` | O app (Leaflet 1.9.4 via CDN, sem build). |
| `assets/sun.js`, `assets/sun.css`, `assets/sun-math.js` | Simulação do sol (timeline, trajetória, sombra) e cálculo solar. |
| `data/homes.json` | 578 imóveis com coordenadas e ficha; 9 prédios. |
| `data/geo.json` | Polígonos das fases 1–4 e das parcelas da Fase 1. |
| `data/planning.json`, `data/updates.json` | Status atual do pedido e histórico dos fetches. |
| `data/project.json` | Textos das fases, cronograma e notas sobre a decisão, com as fontes. |
| `tiles/` | Tiles WebP (z15–19) das plantas georreferenciadas, mais um índice em `meta.json`. |
| `assets/sheets/` | Pranchas originais (GFP 1–12, Site Plan 1A/1B, Parcel Plan, Phasing). |
| `assets/units/` | Fachadas (`elev/`), plantas (`plan/`) e plantas em alta resolução (`plan-hd/`) por tipologia ou prédio. |
| `scripts/` | `fetch_planning.py`, `build_data.py`, `build_tiles.py` e as fontes em `scripts/source/`. |

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

Mapa base © OpenStreetMap contributors; imagem de satélite © Esri.
