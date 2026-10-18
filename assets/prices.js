/* Ravensbourne Place — price estimates (data/market/*.json, built by scripts/market/*.py).
   Adds to the app, through the hooks assets/app.js calls via PX(): the "Estimativa de preço" card with the
   "No seu caso" buyer calculator in the house / flat detail, values in the block detail and the list, the
   "Preço" colour mode, the sold (Land Registry) and for-sale (OnTheMarket) map layers and the "Preços" tab.
   estimates.json + context.json load once the map is idle; sold / listings / berkeley only when a layer or
   the tab needs them. Every hook is a no-op until the data arrive, so the app works without them. */
(() => {
'use strict';

/* ---------------- strings ---------------- */
const STR = {
  pt: {
    card_title: 'Estimativa de preço', loading: 'Carregando estimativa…', unavailable: 'Estimativas de preço indisponíveis no momento.',
    lbl_house: 'Estimativa — casa nova, valores de hoje', lbl_flat: 'Estimativa — apartamento novo, valores de hoje',
    lbl_so: 'Valor de mercado estimado do imóvel inteiro — novo, valores de hoje', lbl_lcr: 'Valor de mercado — só como referência',
    badge: { private: 'Venda livre', so: 'Shared ownership', lcr: 'Aluguel social · não está à venda' },
    range: 'faixa provável (8 em 10 casos)', new_: 'Novo', used: 'Usado', jump: 'Plantas e ficha ↓',
    ppm2_line: (p, a, k) => `<b>${p}/m²</b> × ${a} m² (${k})`,
    basis: { listing: (n, r) => `com base em <b>${n}</b> imóveis comparáveis à venda (anúncios) num raio de ${r}`,
      sold: (n, r) => `com base em <b>${n}</b> vendas comparáveis num raio de ${r}`,
      mixed: (n, r) => `com base em <b>${n}</b> comparáveis (vendas e anúncios) num raio de ${r}` },
    resale_eq: (v, a, b, p) => `Equivalente usado: <b>${v}</b> <span class="muted">(${a} – ${b} · ${p}/m²)</span>`,
    premium_line: (f, a, b) => `Novo = usado × ${f} (prêmio de imóvel novo, faixa ${a}–${b})`,
    accuracy: (e, p, ty) => `Erro típico ±${e}% para ${ty} no teste com preços pedidos; 1 em 5 erra mais de ${p}%. No imóvel novo a incerteza é maior.`,
    type_pl: { detached: 'casas isoladas', semi: 'casas geminadas', terraced: 'casas em fileira', flat: 'apartamentos' },
    type_one: { detached: 'Isolada', semi: 'Geminada', terraced: 'Em fileira', flat: 'Apartamento' },
    lcr_text: 'Imóvel de <b>aluguel social</b> (Low-Cost Rent): é alugado por uma housing association a famílias indicadas pela lista de moradia do Council de Bromley — <b>não está à venda</b>. O valor abaixo serve só como referência do mercado.',
    so_text: 'Imóvel <b>intermediário</b> (shared ownership): você compra uma cota de 10% a 75% do valor de mercado e paga aluguel sobre a parte que não comprou. Alguns imóveis intermediários podem ser oferecidos como London Living Rent (aluguel).',
    so_title: 'Exemplos de compra de cota', so_share: p => `Cota de ${p}%`, so_rent: v => `+ aluguel ${v}/mês`,
    so_note: 'Ilustrativo: o valor, a cota mínima e o aluguel reais são definidos pela housing association (provedora) quando as vendas abrirem.',
    calc_title: 'No seu caso', calc_sub: 'Simule a compra — mude os números', reset: 'Restaurar',
    f_price: 'Preço', f_mv: 'Valor de mercado', f_dep: 'Entrada', f_dep_so: 'Entrada (da cota)', f_rate: 'Juros', f_term: 'Prazo', f_share: 'Cota',
    f_ftb: 'Primeiro imóvel: nunca tive imóvel residencial em nenhum país (first-time buyer)',
    f_add: s => `Terei outro imóvel residencial além deste, em qualquer país (+${s})`, f_nr: s => `Não moro no Reino Unido (+${s})`,
    u_pa: '% a.a.', u_years: 'anos', u_pct: '%', u_gbp: 'libras',
    o_month: 'Por mês', o_month_sub: 'prestação', o_month_sub_so: 'prestação + aluguel', o_up: 'Na compra', o_up_sub: 'entrada + imposto',
    o_share: p => `Preço da cota (${p}%)`, o_dep: p => `Entrada (${p}%)`, o_sdlt: 'Imposto de transmissão (SDLT)',
    o_loan: p => `Financiamento (${p}% do valor)`, o_loan_so: p => `Financiamento (${p}% da cota)`, o_pay: (y, r) => `Prestação (${y} ano${y == 1 ? '' : 's'}, ${r}% a.a.)`,
    o_rent: (p, r) => `Aluguel dos ${p}% restantes (${r} a.a.)`, per_month: '/mês',
    sd_relief: 'alívio de primeiro imóvel', sd_nocap: c => `sem alívio: preço acima de ${c}`, sd_nocap_so: c => `sem alívio: valor de mercado acima de ${c}`, sd_std: 'taxas normais', sd_so: 'sobre o valor da cota (simplificado)',
    sd_noftb_add: 'sem alívio: terá outro imóvel', sd_sur: p => `+${p} em todas as faixas`, sd_sur_add: 'imóvel adicional', sd_sur_nr: 'não residente',
    sd_work: 'ver cálculo do imposto', sd_band: (a, b) => b === Infinity ? `acima de ${a}` : `${a} – ${b}`,
    calc_rate_src: (l, d) => `Juros padrão: média do Bank of England para ${l} (${d}).`,
    calc_rate_fallback: 'Juros padrão: 4,5% a.a. (dados do Bank of England indisponíveis).',
    calc_so_sdlt: 'Imposto simplificado: calculado sobre o valor da cota (pagamento escalonado). Pela "market value election" ele incide de uma vez sobre o valor total.',
    calc_excl: 'Não inclui advogado, avaliação, taxas do banco nem service charge.',
    calc_sur_note: 'Imposto: o HMRC conta imóveis em qualquer país — quem tem casa no Brasil, por exemplo, não é "primeiro imóvel" e paga +5% (a não ser que venda a residência principal ao comprar esta). Quem passou menos de 183 dias no Reino Unido nos últimos 12 meses paga +2%.',
    lcr_sim: 'Simular uma compra a esse valor (só referência)',
    comps_title: 'Imóveis comparáveis', comps_show: 'Mostrar no mapa', comps_hide: 'Ocultar do mapa',
    comps_more: (k, n) => `Ver os ${k} de maior peso (de ${n} usados)`,
    comp_listed: d => `anúncio de ${d}`, comp_sold: d => `vendido em ${d}`, comp_ask: 'à venda (preço pedido)', comp_adj: 'ajust.', comp_w: w => `peso ${w}`,
    comps_note: (p, d) => `Preço pedido em anúncios de ${d}. £/m² ajustado = −${p}% (preço provável de venda), corrigido para a área deste imóvel (imóveis maiores custam menos por m²).`,
    comps_note_sold: 'Preço de venda corrigido para hoje pelo UK HPI e para a área deste imóvel.',
    disc_short: 'Estimativa indicativa baseada em dados públicos — não é uma avaliação nem oferta.', how: 'Como calculamos →',
    // block
    blk_label: 'Apartamentos novos, valores de hoje', blk_median: (v, p) => `mediana ${v} · ${p}/m² (NIA)`,
    blk_hint: 'Clique num apartamento para ver a estimativa e simular a compra.',
    blk_so: (s, v, r) => `Shared ownership: compra de cota — ex.: 25% de ${s} = ${v} + aluguel de ${r}/mês.`,
    blk_lcr: 'Aluguel social: não estão à venda; os valores são só referência de mercado.',
    beds_n: n => `${n} quarto${n > 1 ? 's' : ''}`, bed_short: n => `${n}q`,
    // legend / layers
    bins: ['até £450 mil', '£450–600 mil', '£600–800 mil', '£800 mil – £1 mi', '£1 mi ou mais'],
    leg_note: 'Estimativa de imóvel novo, valores de hoje. Prédios: cor pela mediana dos apartamentos. Nas casas affordable é o valor de mercado, não o preço pago.',
    lyl_key: (a, b) => `${a} vendida · ${b} à venda · cor = preço`,
    lyl_note_sold: 'Vendas de 2023–2026 corrigidas para valores de hoje (UK HPI); posição aproximada (centro do postcode).',
    lyl_note_sold_raw: 'Vendas de 2023–2026 pelo preço pago (sem correção: dados do UK HPI indisponíveis); posição aproximada (centro do postcode).',
    retirement: 'condomínio para aposentados (55+)', lease_left: y => `leasehold, ${y} anos restantes`,
    sale_flag: { cash_only: 'só compra à vista', refurb_project: 'precisa de reforma completa', probate: 'venda de inventário', short_lease: 'leasehold curto' },
    lyl_note_lst: 'Preço pedido. Clique num ◆ para abrir o anúncio.',
    lyl_counts: (s, l) => [s != null ? `${s} vendas` : '', l != null ? `${l} anúncios` : ''].filter(Boolean).join(' · '),
    ly_loading: 'carregando…', ly_failed: 'não foi possível carregar',
    ppd: { D: 'Isolada', S: 'Geminada', T: 'Em fileira', F: 'Apartamento', O: 'Outro' },
    tenure_lr: { F: 'freehold', L: 'leasehold' }, new_build: 'imóvel novo', no_area: 'm² não informado', today_eq: v => `hoje ≈ ${v} (UK HPI)`,
    lst_type: { detached: 'Isolada', 'semi-detached': 'Geminada', terraced: 'Em fileira', 'end-terrace': 'Fileira (ponta)', flat: 'Apartamento', bungalow: 'Bangalô', other: 'Outro' },
    qual: { 'Guide price': 'Preço guia', 'Offers in excess of': 'Ofertas acima de', 'Offers in region of': 'Ofertas em torno de', 'Offers over': 'Ofertas acima de',
      From: 'A partir de', 'Auction (Guide price)': 'Leilão (preço guia)', 'Shared ownership': 'Shared ownership (preço da cota)', Auction: 'Leilão',
      'Fixed price': 'Preço fixo', 'Auction (Offers in excess of)': 'Leilão (ofertas acima de)' },
    baths: n => `${n} banheiro${n > 1 ? 's' : ''}`, open_listing: 'Ver anúncio no OnTheMarket ↗', new_home: 'imóvel novo',
    // tab
    tab_loading: 'Carregando dados de preço…', tab_error: 'Não foi possível carregar os dados de preço (data/market/estimates.json).',
    hero_k: n => `Ravensbourne Place · Fase 1 · ${n} imóveis`, hero_h: 'Quanto vai custar?',
    hero_p: 'Uma estimativa para cada casa e apartamento, a partir do preço por m² de imóveis parecidos na região e de um prêmio de imóvel novo.',
    t_houses: 'Casas · venda livre', t_flats: 'Apartamentos', t_med_lbl: 'mediana', t_err: 'Erro típico', t_prem: 'Prêmio de imóvel novo',
    t_median: v => `mediana ${v}`, t_range: (a, b) => `de ${a} a ${b}`, t_err_sub: p => `1 em 5 erra mais de ${p}`, t_prem_sub: (a, b) => `faixa ${a} a ${b}`,
    btn_mode: 'Colorir o mapa por preço',
    disclaimer: 'Estimativa indicativa baseada em dados públicos — não é uma avaliação nem oferta. Os preços reais serão definidos pela Berkeley quando as vendas abrirem (previsão a partir de 2028+).',
    s_how: 'Como funciona', s_notes: 'Observações', s_acc: 'Precisão', s_prem: 'Prêmio de imóvel novo', s_table: 'Por tipo e quartos',
    s_chart: 'Preço por m² por tipo', s_hpi: 'Mercado em Bromley (UK HPI)', s_sold: 'Vendidas recentemente — Land Registry',
    s_lst: 'À venda agora — OnTheMarket', s_brk: 'Imóveis novos da Berkeley à venda', s_costs: 'Custos de compra — premissas', s_src: 'Fontes e licenças',
    acc_text: (n, e, p, w) => `Teste "deixando um de fora" com <b>${n}</b> anúncios com área (sem duplicados nem vendas fora do mercado normal): o preço por m² de cada um foi previsto a partir dos outros, com as mesmas regras. Erro típico <b>±${e}</b>; 80% dos erros abaixo de ${p}. A faixa provável foi calibrada para cobrir 8 em cada 10 casos (no teste: ${w}%).`,
    acc_caveat: 'O teste usa preços pedidos: as vendas do Land Registry não têm área, então o erro sobre preços efetivamente pagos não pôde ser medido e deve ser maior. O valor de imóvel novo soma duas premissas não testadas — o desconto de 4,5% sobre o preço pedido e o prêmio de imóvel novo —, por isso a faixa dele é mais larga.',
    th_type: 'Tipo', th_n: 'n', th_err: 'Erro típico', th_p80: '80% abaixo de', th_beds: 'Qts', th_homes: 'Imóveis', th_m2: 'm²',
    th_ppm2: '£/m² usado', th_est: 'Estimativa (novo)', th_sales: 'Vendas', th_med12: 'Mediana 12 meses', th_medadj: 'Mediana hoje',
    th_lst: 'Anúncios', th_ask: 'Preço pedido', th_iqr: 'Metade central', th_rate: 'Taxa', th_band: 'Faixa do preço', th_home: 'Imóvel', th_price: 'Preço',
    prem_big: (f, a, b) => `Novo = usado × <b>${f}</b> <span class="muted">(faixa ${a}–${b})</span>`,
    prem_basis: 'De onde vem esse número', not_used: 'fora da curva, não usado', prem_ev_otm: (n, a, b, m) => `${n} empreendimentos novos à venda perto do terreno (OnTheMarket): ${a} a ${b} acima do modelo de usados (mediana ${m}; um número por empreendimento)`,
    prem_ev_brk: 'Imóveis da Berkeley à venda, comparados ao nível de usados da região (UK HPI):', prem_ev_lr: (n) => `Land Registry: ${n} vendas de imóveis novos perto desde 2023, nenhuma com área — o prêmio sobre preços pagos não pôde ser medido.`,
    table_note: 'Medianas por grupo. £/m² usado = valor de revenda equivalente por m² de área (GIA nas casas, NIA nos apartamentos). ♿ = apartamentos para cadeirante (M4(3)): são maiores, mas o valor (e o m² da tabela) usa a área de um apartamento padrão.',
    acc_m43: 'cadeirante', plan_area: a => `área na planta: ${a} m²`,
    chart_desc: 'Cada ponto é um imóvel comparável à venda perto (preço pedido −4,5%, sem ajuste de tamanho). O traço é a mediana; os losangos são as medianas estimadas para Ravensbourne Place.',
    chart_leg: ['comparável', 'mediana dos comparáveis', 'Ravensbourne — usado equivalente', 'Ravensbourne — novo'],
    chart_tip: (a, p, m, v) => `${a}<br>${p} · ${m} m² · <b>${v}/m²</b>`,
    hpi_text: (m, v, c) => `Preço médio em Bromley em ${m}: <b>${v}</b> (${c} em 12 meses).`,
    hpi_types: 'Variação em 12 meses por tipo:',
    sold_text: (n, r, a, b) => `<b>${n}</b> vendas registradas num raio de ${r}, de ${a} a ${b} (venda padrão de casas e apartamentos).`,
    sold_ret: n => `As medianas não incluem ${n} vendas em condomínios para aposentados (outro mercado).`,
    sold_new: n => `${n} delas de imóveis novos.`,
    sold_note: 'O Land Registry não informa a área. Por isso as estimativas usam os anúncios com área; quando o arquivo de certificados de energia (EPC) for baixado, as vendas passam a entrar no cálculo (veja o README).',
    sold_tbl_note: 'Mediana hoje = preço de cada venda corrigido para o mês mais recente do UK HPI, pelo tipo.',
    lst_text: (n, r, d) => `<b>${n}</b> imóveis à venda num raio de ${r} (OnTheMarket, ${d}).`,
    lst_area: (n, v) => `${n} informam a área; mediana de ${v}/m² pedido.`,
    lst_note: 'Medianas sem leilões nem cotas de shared ownership.',
    show_map: 'Mostrar no mapa',
    brk_text: d => `Preços pedidos de imóveis novos do Berkeley Group à venda hoje (berkeleygroup.co.uk, ${d}). Os mais parecidos com Ravensbourne Place ficam no subúrbio de Londres e em Kent.`,
    brk_dev: (n, h, f) => [h ? `${h} casa${h > 1 ? 's' : ''}` : '', f ? `${f} apto${f > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || `${n}`,
    brk_med: v => `mediana ${v}/m²`, brk_others: n => `Outros ${n} empreendimentos (Londres central e norte/oeste — preço de outro mercado)`,
    brk_caveats: ['Preços pedidos, não de venda: incentivos da Berkeley não estão descontados.', 'A área divulgada pela Berkeley é de marketing — parecida, mas não igual, à GIA/NIA da planta.', 'Só aparecem os imóveis ainda não vendidos.'],
    brk_open: 'página do empreendimento ↗', km: v => `${v} km`,
    brk_type: { house: 'Casa', flat: 'Apartamento' },
    brk_status: { Available: 'Disponível', Reserved: 'Reservado', 'Under Negotiation': 'Em negociação', 'Under Offer': 'Com oferta', 'On-Hold': 'Suspenso' },
    c_sdlt: 'Imposto de transmissão (SDLT), Inglaterra', c_std: 'Comprador padrão', c_ftb: c => `Primeiro imóvel (preço até ${c}; acima disso, taxas padrão sobre tudo)`,
    c_sur: (a, b) => `+${a} em todas as faixas para imóvel adicional · +${b} para não residentes no Reino Unido.`,
    c_inforce: (d, c) => `Em vigor desde ${d} · conferido em ${c} · GOV.UK.`, c_examples: 'Exemplos (conferidos com o GOV.UK)',
    c_mort: 'Juros de financiamento (Bank of England)', c_mort_lbl: (y, l) => `${y} anos fixos · ${l}% LTV`,
    c_mort_note: (m, l) => `Médias das taxas anunciadas em ${m} (tabela G1.3), sem tarifas. A calculadora usa ${l} como padrão.`,
    c_so: 'Shared ownership (Londres)',
    c_so_rows: (a, b, r, i) => [`Cota inicial de ${a} a ${b} do valor de mercado`, `Aluguel de ${r} a.a. sobre a parte não comprada (teto da GLA em Londres)`, `Renda familiar de até ${i} em Londres`, 'Dá para comprar mais cotas depois (staircasing), a partir de 10% (em contratos novos, 1% ao ano nos primeiros 15 anos)'],
    src_rows: [
      ['HM Land Registry — Price Paid Data', 'vendas 2023–2026 num raio de 2,5 km'],
      ['HM Land Registry — UK House Price Index', 'preços médios mensais de Bromley e dos bairros comparados'],
      ['ONS Postcode Directory (via postcodes.io)', 'posição de cada postcode'],
      ['Certificados de energia (EPC)', 'não usado ainda: o registro não permite acesso automático e o download completo exige conta GOV.UK One Login'],
      ['OnTheMarket', 'anúncios à venda (só preço, quartos, tipo, endereço de rua e área; sem fotos nem descrições)'],
      ['Berkeley Group', 'imóveis novos à venda nos empreendimentos do grupo'],
      ['Bank of England', 'juros médios de financiamento (Bankstats G1.3)'],
      ['GOV.UK', 'alíquotas do SDLT e regras de shared ownership'],
    ],
    snap: d => `dados de ${d}`, gen: d => `Estimativas geradas em ${d}.`,
    licence_otm: 'Dados de anúncios © OnTheMarket e das imobiliárias anunciantes; usados só como referência, com link para o anúncio original.',
    licence_brk: 'Preços e áreas publicados em berkeleygroup.co.uk.', licence_boe: 'Fonte: Bank of England.',
    licence_gov: 'Contains public sector information licensed under the Open Government Licence v3.0.',
    licence_epc: 'Quando usado: Energy Performance of Buildings Data: England and Wales — © Crown copyright, OGL v3.0.',
  },
  en: {
    card_title: 'Price estimate', loading: 'Loading price estimate…', unavailable: 'Price estimates are not available right now.',
    lbl_house: "Estimate — new home, today's prices", lbl_flat: "Estimate — new flat, today's prices",
    lbl_so: "Estimated full market value — new, today's prices", lbl_lcr: 'Market value — for reference only',
    badge: { private: 'Private sale', so: 'Shared ownership', lcr: 'Low-Cost Rent · not for sale' },
    range: 'likely range (8 in 10 cases)', new_: 'New', used: 'Resale', jump: 'Plans and facts ↓',
    ppm2_line: (p, a, k) => `<b>${p}/m²</b> × ${a} m² (${k})`,
    basis: { listing: (n, r) => `based on <b>${n}</b> comparable homes for sale (listings) within ${r}`,
      sold: (n, r) => `based on <b>${n}</b> comparable sales within ${r}`,
      mixed: (n, r) => `based on <b>${n}</b> comparables (sales and listings) within ${r}` },
    resale_eq: (v, a, b, p) => `Second-hand equivalent: <b>${v}</b> <span class="muted">(${a} – ${b} · ${p}/m²)</span>`,
    premium_line: (f, a, b) => `New = resale × ${f} (new-build premium; range ${a}–${b})`,
    accuracy: (e, p, ty) => `Typical error ±${e}% for ${ty} when tested on asking prices; 1 in 5 off by more than ${p}%. The new-home value is less certain.`,
    type_pl: { detached: 'detached houses', semi: 'semi-detached houses', terraced: 'terraced houses', flat: 'flats' },
    type_one: { detached: 'Detached', semi: 'Semi-detached', terraced: 'Terraced', flat: 'Flat' },
    lcr_text: "A <b>Low-Cost Rent</b> home: let by a housing association to households nominated from Bromley Council's housing register — <b>it is not for sale</b>. The value below is a market reference only.",
    so_text: 'An <b>intermediate</b> (shared ownership) home: you buy a share of 10% to 75% of the market value and pay rent on the part you do not own. Some intermediate homes may be offered as London Living Rent (a rental).',
    so_title: 'Example share purchases', so_share: p => `${p}% share`, so_rent: v => `+ rent ${v}/month`,
    so_note: 'Illustrative: the actual price, minimum share and rent are set by the housing provider when sales open.',
    calc_title: 'In your case', calc_sub: 'Simulate the purchase — edit the numbers', reset: 'Reset',
    f_price: 'Price', f_mv: 'Market value', f_dep: 'Deposit', f_dep_so: 'Deposit (of share)', f_rate: 'Interest', f_term: 'Term', f_share: 'Share',
    f_ftb: 'First-time buyer: never owned a home anywhere in the world',
    f_add: s => `I will own another home as well, in any country (+${s})`, f_nr: s => `I do not live in the UK (+${s})`,
    u_pa: '% p.a.', u_years: 'years', u_pct: '%', u_gbp: 'pounds',
    o_month: 'Per month', o_month_sub: 'repayment', o_month_sub_so: 'repayment + rent', o_up: 'Upfront', o_up_sub: 'deposit + stamp duty',
    o_share: p => `Share price (${p}%)`, o_dep: p => `Deposit (${p}%)`, o_sdlt: 'Stamp Duty Land Tax (SDLT)',
    o_loan: p => `Mortgage (${p}% loan-to-value)`, o_loan_so: p => `Mortgage (${p}% of the share)`, o_pay: (y, r) => `Repayment (${y} year${y == 1 ? '' : 's'}, ${r}% p.a.)`,
    o_rent: (p, r) => `Rent on the remaining ${p}% (${r} p.a.)`, per_month: '/month',
    sd_relief: "first-time buyers' relief", sd_nocap: c => `no relief: price over ${c}`, sd_nocap_so: c => `no relief: market value over ${c}`, sd_std: 'standard rates', sd_so: 'on the share price (simplified)',
    sd_noftb_add: 'no relief: you will own another home', sd_sur: p => `+${p} on every band`, sd_sur_add: 'additional home', sd_sur_nr: 'non-resident',
    sd_work: 'show the tax working', sd_band: (a, b) => b === Infinity ? `over ${a}` : `${a} – ${b}`,
    calc_rate_src: (l, d) => `Default rate: Bank of England average for ${l} (${d}).`,
    calc_rate_fallback: 'Default rate: 4.5% p.a. (Bank of England data unavailable).',
    calc_so_sdlt: 'Simplified tax: worked out on the share price (staged payments). With a "market value election" it is paid once on the full value.',
    calc_excl: 'Excludes legal fees, survey, lender fees and service charge.',
    calc_sur_note: 'Tax: HMRC counts homes in any country — if you own a home abroad you are not a first-time buyer and pay +5% (unless you sell your main home when you buy this one). If you spent fewer than 183 days in the UK in the last 12 months you pay +2%.',
    lcr_sim: 'Simulate a purchase at this value (reference only)',
    comps_title: 'Comparable homes', comps_show: 'Show on map', comps_hide: 'Hide from map',
    comps_more: (k, n) => `See the ${k} with the most weight (of ${n} used)`,
    comp_listed: d => `listed ${d}`, comp_sold: d => `sold ${d}`, comp_ask: 'for sale (asking price)', comp_adj: 'adj.', comp_w: w => `weight ${w}`,
    comps_note: (p, d) => `Asking prices of ${d} listings. Adjusted £/m² = −${p}% (likely sale price), scaled to this home's floor area (bigger homes cost less per m²).`,
    comps_note_sold: "Sale price brought to today with UK HPI and scaled to this home's floor area.",
    disc_short: 'Indicative estimate from public data — not a valuation or an offer.', how: 'How we estimate →',
    blk_label: "New flats, today's prices", blk_median: (v, p) => `median ${v} · ${p}/m² (NIA)`,
    blk_hint: 'Click a flat for its estimate and the purchase calculator.',
    blk_so: (s, v, r) => `Shared ownership: buy a share — e.g. 25% of ${s} = ${v} + rent of ${r}/month.`,
    blk_lcr: 'Low-Cost Rent: these flats are not for sale; the values are a market reference only.',
    beds_n: n => `${n} bed`, bed_short: n => `${n}b`,
    bins: ['under £450k', '£450–600k', '£600–800k', '£800k – £1m', '£1m or more'],
    leg_note: "New-home estimate at today's prices. Blocks: coloured by their flats' median. For affordable homes this is the market value, not the price paid.",
    lyl_key: (a, b) => `${a} sold · ${b} for sale · colour = price`,
    lyl_note_sold: "2023–2026 sales brought to today's prices (UK HPI); approximate position (postcode centre).",
    lyl_note_sold_raw: '2023–2026 sales at the price paid (not adjusted: UK HPI data unavailable); approximate position (postcode centre).',
    retirement: 'retirement scheme (55+)', lease_left: y => `leasehold, ${y} years left`,
    sale_flag: { cash_only: 'cash buyers only', refurb_project: 'needs full refurbishment', probate: 'probate sale', short_lease: 'short lease' },
    lyl_note_lst: 'Asking price. Click a ◆ to open the listing.',
    lyl_counts: (s, l) => [s != null ? `${s} sales` : '', l != null ? `${l} listings` : ''].filter(Boolean).join(' · '),
    ly_loading: 'loading…', ly_failed: 'could not be loaded',
    ppd: { D: 'Detached', S: 'Semi-detached', T: 'Terraced', F: 'Flat', O: 'Other' },
    tenure_lr: { F: 'freehold', L: 'leasehold' }, new_build: 'new build', no_area: 'm² not stated', today_eq: v => `today ≈ ${v} (UK HPI)`,
    lst_type: { detached: 'Detached', 'semi-detached': 'Semi-detached', terraced: 'Terraced', 'end-terrace': 'End terrace', flat: 'Flat', bungalow: 'Bungalow', other: 'Other' },
    qual: {},
    baths: n => `${n} bath`, open_listing: 'Open the listing on OnTheMarket ↗', new_home: 'new home',
    tab_loading: 'Loading price data…', tab_error: 'The price data could not be loaded (data/market/estimates.json).',
    hero_k: n => `Ravensbourne Place · Phase 1 · ${n} homes`, hero_h: 'What will it cost?',
    hero_p: 'An estimate for every house and flat, from the price per m² of similar homes nearby plus a new-build premium.',
    t_houses: 'Houses · private sale', t_flats: 'Flats', t_med_lbl: 'median', t_err: 'Typical error', t_prem: 'New-build premium',
    t_median: v => `median ${v}`, t_range: (a, b) => `from ${a} to ${b}`, t_err_sub: p => `1 in 5 off by more than ${p}`, t_prem_sub: (a, b) => `range ${a} to ${b}`,
    btn_mode: 'Colour the map by price',
    disclaimer: 'Indicative estimate based on public data — not a valuation or an offer. Actual prices will be set by Berkeley when sales open (expected from 2028+).',
    s_how: 'How it works', s_notes: 'Notes', s_acc: 'Accuracy', s_prem: 'New-build premium', s_table: 'By type and bedrooms',
    s_chart: 'Price per m² by type', s_hpi: 'The Bromley market (UK HPI)', s_sold: 'Recently sold — Land Registry',
    s_lst: 'For sale now — OnTheMarket', s_brk: 'Berkeley new homes on sale', s_costs: 'Buying costs — assumptions', s_src: 'Sources and licences',
    acc_text: (n, e, p, w) => `Leave-one-out test on <b>${n}</b> listings with a floor area (no duplicates or non-market sales): each one's price per m² was predicted from the others with the same rules. Typical error <b>±${e}</b>; 80% of errors below ${p}. The likely range is calibrated to cover 8 in 10 cases (in the test: ${w}%).`,
    acc_caveat: 'The test uses asking prices: Land Registry sales have no floor area, so the error on prices actually paid cannot be measured yet and is probably larger. The new-home value adds two untested assumptions — the 4.5% asking-to-sale discount and the new-build premium — so its range is wider.',
    th_type: 'Type', th_n: 'n', th_err: 'Typical error', th_p80: '80% below', th_beds: 'Beds', th_homes: 'Homes', th_m2: 'm²',
    th_ppm2: 'Resale £/m²', th_est: 'Estimate (new)', th_sales: 'Sales', th_med12: 'Median, last 12 m', th_medadj: 'Median today',
    th_lst: 'Listings', th_ask: 'Asking price', th_iqr: 'Middle half', th_rate: 'Rate', th_band: 'Price band', th_home: 'Home', th_price: 'Price',
    prem_big: (f, a, b) => `New = resale × <b>${f}</b> <span class="muted">(range ${a}–${b})</span>`,
    prem_basis: 'Where this number comes from', not_used: 'outlier, not used', prem_ev_otm: (n, a, b, m) => `${n} new-home schemes for sale near the site (OnTheMarket): ${a} to ${b} over the resale model (median ${m}; one figure per scheme)`,
    prem_ev_brk: "Berkeley homes on sale, against their area's resale level (UK HPI):", prem_ev_lr: n => `Land Registry: ${n} new-build sales nearby since 2023, none with a floor area — no premium on achieved prices could be measured.`,
    table_note: 'Medians per group. Resale £/m² = second-hand equivalent value per m² of floor area (GIA for houses, NIA for flats). ♿ = wheelchair-user flats (M4(3)): larger, but the value (and the m² in this table) uses the area of a standard flat.',
    acc_m43: 'wheelchair', plan_area: a => `plan area: ${a} m²`,
    chart_desc: 'Each dot is a comparable home for sale nearby (asking price −4.5%, no size adjustment). The tick is the median; the diamonds are the estimated medians for Ravensbourne Place.',
    chart_leg: ['comparable', 'comparables median', 'Ravensbourne — resale equivalent', 'Ravensbourne — new'],
    chart_tip: (a, p, m, v) => `${a}<br>${p} · ${m} m² · <b>${v}/m²</b>`,
    hpi_text: (m, v, c) => `Average price in Bromley in ${m}: <b>${v}</b> (${c} over 12 months).`,
    hpi_types: '12-month change by type:',
    sold_text: (n, r, a, b) => `<b>${n}</b> sales registered within ${r}, from ${a} to ${b} (standard sales of houses and flats).`,
    sold_ret: n => `The medians leave out ${n} sales in retirement schemes (a different market).`,
    sold_new: n => `${n} of them new builds.`,
    sold_note: 'Land Registry has no floor area, so the estimates use listings that state one; once the energy certificate (EPC) file is downloaded, the sales join the model (see the README).',
    sold_tbl_note: "Median today = each sale price brought to UK HPI's latest month, by type.",
    lst_text: (n, r, d) => `<b>${n}</b> homes for sale within ${r} (OnTheMarket, ${d}).`,
    lst_area: (n, v) => `${n} state a floor area; median asking ${v}/m².`,
    lst_note: 'Medians exclude auctions and shared-ownership shares.',
    show_map: 'Show on map',
    brk_text: d => `Asking prices of Berkeley Group new homes on sale today (berkeleygroup.co.uk, ${d}). The closest matches for Ravensbourne Place are in outer London and Kent.`,
    brk_dev: (n, h, f) => [h ? `${h} house${h > 1 ? 's' : ''}` : '', f ? `${f} flat${f > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || `${n}`,
    brk_med: v => `median ${v}/m²`, brk_others: n => `${n} other developments (central and north/west London — a different market)`,
    brk_caveats: ['Asking prices, not sale prices: Berkeley incentives are not deducted.', "Berkeley's published floor area is a marketing figure — close to, but not the same as, the plan GIA/NIA.", 'Only homes still unsold are listed.'],
    brk_open: 'development page ↗', km: v => `${v} km`,
    brk_type: { house: 'House', flat: 'Flat' },
    brk_status: { Available: 'Available', Reserved: 'Reserved', 'Under Negotiation': 'Under negotiation', 'Under Offer': 'Under offer', 'On-Hold': 'On hold' },
    c_sdlt: 'Stamp Duty Land Tax (SDLT), England', c_std: 'Standard buyer', c_ftb: c => `First-time buyer (price up to ${c}; above it, standard rates on the whole price)`,
    c_sur: (a, b) => `+${a} on every band for an additional home · +${b} for non-UK residents.`,
    c_inforce: (d, c) => `In force since ${d} · checked ${c} · GOV.UK.`, c_examples: 'Examples (checked against GOV.UK)',
    c_mort: 'Mortgage rates (Bank of England)', c_mort_lbl: (y, l) => `${y}-year fixed · ${l}% LTV`,
    c_mort_note: (m, l) => `Average quoted rates in ${m} (table G1.3), excluding fees. The calculator defaults to ${l}.`,
    c_so: 'Shared ownership (London)',
    c_so_rows: (a, b, r, i) => [`Initial share of ${a} to ${b} of the market value`, `Rent of ${r} a year on the unsold part (GLA cap in London)`, `Household income up to ${i} in London`, 'You can buy more shares later (staircasing), from 10% (newer leases: 1% a year for the first 15 years)'],
    src_rows: [
      ['HM Land Registry — Price Paid Data', '2023–2026 sales within 2.5 km'],
      ['HM Land Registry — UK House Price Index', 'monthly average prices for Bromley and the boroughs compared'],
      ['ONS Postcode Directory (via postcodes.io)', 'position of each postcode'],
      ['Energy Performance Certificates (EPC)', 'not used yet: the register disallows automated access and the bulk download needs a GOV.UK One Login account'],
      ['OnTheMarket', 'homes for sale (price, bedrooms, type, street address and floor area only; no photos or descriptions)'],
      ['Berkeley Group', 'new homes on sale in the group\'s developments'],
      ['Bank of England', 'average mortgage rates (Bankstats G1.3)'],
      ['GOV.UK', 'SDLT rates and shared ownership rules'],
    ],
    snap: d => `data of ${d}`, gen: d => `Estimates built on ${d}.`,
    licence_otm: 'Listing data © OnTheMarket and the advertising agents; used for reference only, with a link to the original listing.',
    licence_brk: 'Prices and floor areas as published on berkeleygroup.co.uk.', licence_boe: 'Source: Bank of England.',
    licence_gov: 'Contains public sector information licensed under the Open Government Licence v3.0.',
    licence_epc: 'When used: Energy Performance of Buildings Data: England and Wales — © Crown copyright, OGL v3.0.',
  },
};

let A = null;                                  // the app API (assets/app.js initPrices)
const LG = () => (A && A.lang() === 'en' ? 'en' : 'pt');
const s = (k, ...a) => { const v = STR[LG()][k] ?? STR.pt[k]; return typeof v === 'function' ? v(...a) : (v ?? k); };
const sm = (k, key) => (STR[LG()][k] || {})[key] ?? (STR.pt[k] || {})[key] ?? key;
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// links from scraped data: only https URLs reach an href (no javascript:, data: …)
const safeUrl = u => (/^https:\/\//i.test(String(u || '')) ? String(u) : null);
const link = (u, text, cls = '') => { const h = safeUrl(u); return h ? `<a${cls ? ` class="${cls}"` : ''} href="${esc(h)}" target="_blank" rel="noopener">${text}</a>` : text; };
const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => [...el.querySelectorAll(q)];

/* ---------------- formatting ---------------- */
const loc = () => (LG() === 'en' ? 'en-GB' : 'pt-BR');
const num = (n, d = 0) => Number(n).toLocaleString(loc(), { minimumFractionDigits: d, maximumFractionDigits: d });
const ok = n => n != null && isFinite(n);
const gbp = n => ok(n) ? '£' + num(Math.round(n)) : '—';
const gbpS = n => {                                       // £791 mil / £791k · £1,30 mi / £1.30m
  if (!ok(n)) return '—';
  if (n === 0) return '£0';
  const en = LG() === 'en';
  if (Math.abs(n) >= 995000) return `£${num(n / 1e6, 2)}${en ? 'm' : ' mi'}`;
  return `£${num(Math.round(n / 1000))}${en ? 'k' : ' mil'}`;
};
const pct = (x, d = 1) => num(x, d).replace(/[.,]0+$/, '') + '%';        // 6,5% / 15%
const pctS = (x, d = 0) => (x >= 0 ? '+' : '−') + pct(Math.abs(x), d);   // +12% / −3,1%
const dist = m => m < 950 ? `${num(Math.round(m / 10) * 10)} m` : `${num(m / 1000, 1)} km`;
const fmtD = iso => (A ? A.fmtDate(iso) : iso);
const month = ym => new Date(ym + '-15T12:00:00').toLocaleDateString(loc(), { month: 'short', year: 'numeric' });
const monthY = iso => { const d = new Date((iso || '').slice(0, 7) + '-15T12:00:00'); if (isNaN(d)) return ''; const m = d.toLocaleDateString(loc(), { month: 'short' }).replace('.', ''); return LG() === 'en' ? `${m} ${d.getFullYear()}` : `${m}/${d.getFullYear()}`; };
const median = a => { const x = a.filter(ok).sort((p, q) => p - q), n = x.length; return n ? (n % 2 ? x[(n - 1) / 2] : (x[n / 2 - 1] + x[n / 2]) / 2) : null; };
const quant = (a, q) => { const x = a.filter(ok).sort((p, r) => p - r); if (!x.length) return null; const i = (x.length - 1) * q, lo = Math.floor(i); return x[lo] + (x[Math.min(lo + 1, x.length - 1)] - x[lo]) * (i - lo); };
const hav = (a, b, c, d) => { const R = 6371000, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const phone = () => matchMedia('(max-width: 900px)').matches;

/* ---------------- data ---------------- */
const M = {};          // estimates, context, sold, listings, berkeley (as loaded)
const PEND = {};       // name -> promise
let ST = 'idle';       // estimates: idle | loading | ready | error
function need(name) {
  if (!PEND[name]) {
    PEND[name] = fetch(`data/market/${name}.json`, { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(`data/market/${name}.json ${r.status}`); return r.json(); })
      .then(d => (M[name] = d));
    // a failed load is forgotten, so the next toggle / tab visit tries again
    PEND[name].catch(e => { console.warn('prices:', e.message); delete PEND[name]; });
  }
  return PEND[name];
}

// price ramp (one hue, light -> dark; validated as an ordinal ramp on white and on the map's grey)
const BIN_EDGES = [450000, 600000, 800000, 1000000];
const BIN_COL = ['#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const binOf = v => BIN_EDGES.findIndex(e => v < e) === -1 ? BIN_EDGES.length : BIN_EDGES.findIndex(e => v < e);
const binCol = v => ok(v) ? BIN_COL[binOf(v)] : '#94a3b8';
const PPD = { D: 'detached', S: 'semi', T: 'terraced', F: 'flat' };

// SDLT / rates fallbacks (GOV.UK, in force since 2025-04-01) if context.json is unavailable
const FALLBACK = {
  std: [{ from: 0, rate: 0 }, { from: 125000, rate: .02 }, { from: 250000, rate: .05 }, { from: 925000, rate: .1 }, { from: 1500000, rate: .12 }],
  ftb: { bands: [{ from: 0, rate: 0 }, { from: 300000, rate: .05 }], max_price: 500000 },
  rate: 4.5, rent: .0275, shareMin: .1, shareMax: .75, sur: .05, nr: .02,
};
const C = {};          // derived constants (prepare)
function prepare() {
  const E = M.estimates, X = M.context || {};
  C.H = E.homes; C.CI = E.comps_index || {};
  C.beta = E.params?.size_elasticity ?? 1;
  C.askToSold = E.params?.ask_to_sold ?? .955;
  const pool = E.params?.comparables || {};
  C.src = pool.sold && pool.listing ? 'mixed' : pool.sold ? 'sold' : 'listing';
  C.std = X.sdlt?.standard || FALLBACK.std;
  C.ftb = X.sdlt?.first_time_buyer || FALLBACK.ftb;
  C.sur = X.sdlt?.additional_surcharge ?? FALLBACK.sur;       // higher rates for additional dwellings
  C.nr = X.sdlt?.non_resident_surcharge ?? FALLBACK.nr;        // non-UK-resident surcharge
  const r = (X.mortgage?.rates || []).find(x => x.ltv === 90 && x.fixed_years === 2);
  C.rate = r ? r.rate : FALLBACK.rate;
  C.rateSrc = r ? { ltv: r.ltv, y: r.fixed_years, month: X.mortgage.month || X.mortgage.as_of?.slice(0, 7) } : null;
  const so = X.shared_ownership || {};
  C.rent = so.rent_rate_on_unsold ?? FALLBACK.rent;
  C.shareMin = (so.min_initial_share ?? FALLBACK.shareMin) * 100;
  C.shareMax = (so.max_initial_share ?? FALLBACK.shareMax) * 100;
  // UK HPI by month, to bring Land Registry prices to today
  const ms = X.ukhpi?.months || [];
  C.hpi = new Map(ms.map(m => [m.month, m]));
  C.hpiFirst = ms[0]; C.hpiLast = ms[ms.length - 1];
}
const est = h => (ST === 'ready' && h ? C.H[h.id] : null) || null;
const kindOf = h => h.tenure === 'Intermediate' ? 'so' : h.tenure === 'Low-Cost Rent' ? 'lcr' : 'private';
const hpiFactor = (date, ppd) => {
  const k = PPD[ppd]; if (!k || !C.hpiLast) return 1;
  const ym = (date || '').slice(0, 7), m = C.hpi.get(ym) || (ym > C.hpiLast.month ? C.hpiLast : C.hpiFirst);
  return m && m[k] ? C.hpiLast[k] / m[k] : 1;
};
// a comparable's £/m² as it entered this home's estimate: sold-equivalent, scaled to the home's floor area
const compPpm2 = (c, area) => c.ppm2_sold_equiv * Math.pow(area / c.area, C.beta - 1);
// floor area the value is based on (a likely schedule error or a wheelchair home: typical / standard area)
const areaUsed = e => e.area_used ?? e.area;

/* ---------------- SDLT / mortgage ---------------- */
function sdlt(price, bands) {
  let tax = 0; const parts = [];
  bands.forEach((b, i) => {
    const top = i + 1 < bands.length ? bands[i + 1].from : Infinity;
    if (price > b.from) { const amt = Math.min(price, top) - b.from, tx = amt * b.rate; tax += tx; parts.push({ from: b.from, to: top, amt, rate: b.rate, tax: tx }); }
  });
  return { tax: Math.floor(tax + 1e-6), parts };       // HMRC rounds the total down to the pound
}
function annuity(loan, ratePct, years) {
  const n = Math.round(years * 12), r = ratePct / 100 / 12;
  if (!(loan > 0) || !(n > 0)) return 0;
  return r > 0 ? loan * r / (1 - Math.pow(1 + r, -n)) : loan / n;
}

/* ---------------- calculator state (localStorage) ---------------- */
const CALC_KEY = 'rp-calc';
// standard buyer by default: the first-time-buyer relief needs never having owned a home anywhere
const calcDefaults = () => ({ dep: 10, rate: C.rate, term: 30, ftb: false, add: false, nr: false, share: 25 });
const LIM = { dep: [0, 100], rate: [0, 25], term: [1, 40], share: [10, 75] };
const MAX_PRICE = 20e6;
function calcLoad() {             // stored values are checked: a corrupt entry falls back to the default
  let v = {};
  try { v = JSON.parse(localStorage.getItem(CALC_KEY) || '{}'); } catch { v = {}; }
  if (!v || typeof v !== 'object') v = {};
  const d = calcDefaults(), out = { ...d, px: {} };
  for (const k of ['dep', 'rate', 'term', 'share']) {
    const x = v[k];
    if (typeof x === 'number' && isFinite(x)) out[k] = clamp(x, ...(k === 'share' ? [C.shareMin, C.shareMax] : LIM[k]));
  }
  if (out.rate !== d.rate) out.rateSet = true;            // the user chose a rate (else: today's default)
  for (const k of ['ftb', 'add', 'nr']) if (typeof v[k] === 'boolean') out[k] = v[k];
  if (v.px && typeof v.px === 'object') {
    for (const [id, x] of Object.entries(v.px)) if (typeof x === 'number' && isFinite(x) && x > 0 && x <= MAX_PRICE) out.px[id] = x;
  }
  return out;
}
function calcSave(v) {
  try {
    const px = Object.entries(v.px || {}).slice(-30);       // keep the last 30 per-home prices
    const o = { dep: v.dep, term: v.term, ftb: v.ftb, add: v.add, nr: v.nr, share: v.share, px: Object.fromEntries(px) };
    if (v.rateSet) o.rate = v.rate;                           // only a rate the user typed is remembered
    localStorage.setItem(CALC_KEY, JSON.stringify(o));
  } catch { /* private mode */ }
}

/* ---------------- house / flat card ---------------- */
function houseCard(h) {
  if (!A || !h) return '';
  if (ST === 'idle' || ST === 'loading') {
    return `<section class="pr-card pr-skel" aria-busy="true"><div class="pr-head"><span class="pr-k">${s('card_title')}</span></div>
      <div class="pr-skel-line w60"></div><div class="pr-skel-line w40"></div><div class="small muted">${s('loading')}</div></section>`;
  }
  const e = est(h);
  if (!e) return ST === 'error' ? `<div class="note small">${s('unavailable')}</div>` : '';
  const kind = kindOf(h), flat = h.kind === 'apartment', tk = PPD[e.ppd_type];
  const acc = M.estimates.accuracy || {}, at = (acc.by_type || {})[tk] || acc;
  const prem = M.estimates.new_build_premium || {};
  const label = kind === 'so' ? s('lbl_so') : kind === 'lcr' ? s('lbl_lcr') : s(flat ? 'lbl_flat' : 'lbl_house');
  const r = e.radius_m >= 1000 ? `${num(e.radius_m / 1000, 1)} km` : `${e.radius_m} m`;
  const facts = [
    s('ppm2_line', gbp(e.value / areaUsed(e)), num(areaUsed(e)), e.area_kind),
    sm('basis', C.src)(e.n, r),
    s('resale_eq', gbp(e.value_resale), gbp(e.low_resale), gbp(e.high_resale), gbp(e.ppm2)),
    prem.factor ? s('premium_line', num(prem.factor, 2), num(prem.low, 2), num(prem.high, 2)) : '',
    at.median_abs_pct_error != null ? s('accuracy', num(at.median_abs_pct_error, 1), num(at.p80_abs_pct_error, 1), sm('type_pl', tk)) : '',
  ].filter(Boolean);
  const so = kind === 'so' ? soExamples(e) : '';
  const calc = kind === 'lcr'
    ? `<details class="pr-sim"><summary>${s('lcr_sim')}</summary>${calcHTML(h, e, 'private')}</details>`
    : calcHTML(h, e, kind === 'so' ? 'so' : 'private');
  return `<section class="pr-card pr-${kind}" data-pr-home="${esc(h.id)}">
    <div class="pr-head"><span class="pr-k">${s('card_title')}</span>${kind !== 'private' ? `<span class="pr-badge pr-badge-${kind}">${sm('badge', kind)}</span>` : ''}<a href="#" class="pr-jump" data-pr-jump>${s('jump')}</a></div>
    ${kind === 'lcr' ? `<p class="pr-lead">${s('lcr_text')}</p>` : ''}
    <div class="pr-label">${label}</div>
    <div class="pr-big">${gbp(e.value)}</div>
    <div class="pr-range">${s('range')} <b>${gbp(e.low)} – ${gbp(e.high)}</b></div>
    ${scaleBar(e)}
    <ul class="pr-facts">${facts.map((f, i) => `<li${i === facts.length - 1 ? ' class="muted"' : ''}>${f}</li>`).join('')}</ul>
    ${e.area_note ? `<div class="note warn small">${esc(e.area_note[LG()] || e.area_note.en)}</div>` : ''}
    ${so}
    ${calc}
    ${compsHTML(h, e)}
    <p class="pr-disc">${s('disc_short')} <a href="#" data-pr-tab>${s('how')}</a></p>
  </section>`;
}
function scaleBar(e) {
  const lo = Math.min(e.low, e.low_resale), hi = Math.max(e.high, e.high_resale), pad = (hi - lo) * .04, a = lo - pad, b = hi + pad;
  const x = v => ((v - a) / (b - a) * 100).toFixed(2);
  const row = (lbl, l, v, h, cls) => `<div class="pr-sc-row"><span class="pr-sc-l">${lbl}</span><div class="pr-sc-trk">
      <i class="pr-sc-band ${cls}" style="left:${x(l)}%;width:${(x(h) - x(l)).toFixed(2)}%"></i><b class="pr-sc-dot ${cls}" style="left:${x(v)}%"></b></div>
      <span class="pr-sc-v">${gbpS(v)}</span></div>`;
  return `<div class="pr-scale" aria-hidden="true">${row(s('new_'), e.low, e.value, e.high, 'new')}${row(s('used'), e.low_resale, e.value_resale, e.high_resale, 'used')}</div>`;
}
function soExamples(e) {
  const cells = [25, 50, 75].map(p => `<div><span>${s('so_share', p)}</span><b>${gbp(e.value * p / 100)}</b><small>${s('so_rent', gbp(C.rent * (1 - p / 100) * e.value / 12))}</small></div>`).join('');
  return `<div class="pr-sub"><h5>${s('so_title')}</h5><p class="pr-p pr-ps" style="margin:0 0 8px">${s('so_text')}</p><div class="pr-tiles3">${cells}</div><p class="small muted" style="margin:8px 0 0">${s('so_note')}</p></div>`;
}

/* calculator */
function calcHTML(h, e, mode) {
  const v = calcLoad(), so = mode === 'so';
  const price = v.px[h.id] || e.value;                 // 0 / empty = use the estimate
  // the accessible name carries the unit ("Entrada (%)"), which the visible label leaves to the suffix
  const field = (k, label, val, unit, attrs, cls = '', srUnit = unit) => `<label class="pr-f pr-f-${k} ${cls}"><span>${label}</span><span class="pr-in">
      ${k === 'price' ? '<i aria-hidden="true">£</i>' : ''}<input data-f="${k}" ${attrs} value="${esc(val)}" aria-label="${esc(srUnit ? `${label} (${srUnit})` : label)}">${unit ? `<i aria-hidden="true">${unit}</i>` : ''}</span></label>`;
  const sw = (k, label, on) => `<label class="toggle-row pr-ftb"><span>${label}</span><span class="switch"><input type="checkbox" data-f="${k}"${on ? ' checked' : ''}><span></span></span></label>`;
  return `<div class="pr-calc" data-home="${esc(h.id)}" data-mode="${mode}">
    <div class="pr-calc-head"><div><h4>${s('calc_title')}</h4><span class="small muted">${s('calc_sub')}</span></div><button type="button" class="pr-link" data-calc-reset>${s('reset')}</button></div>
    <div class="pr-fields">
      ${field('price', s(so ? 'f_mv' : 'f_price'), num(Math.round(price)), '', TXT + ' inputmode="numeric"', so ? 'c4' : 'c6', s('u_gbp'))}
      ${so ? field('share', s('f_share'), numIn(v.share), '%', TXT + ' inputmode="decimal"', 'c2') : ''}
      ${field('dep', s(so ? 'f_dep_so' : 'f_dep'), numIn(v.dep), '%', TXT + ' inputmode="decimal"', 'c2')}
      ${field('rate', s('f_rate'), numIn(v.rate, 2), s('u_pa'), TXT + ' inputmode="decimal"', 'c2')}
      ${field('term', s('f_term'), numIn(v.term), s('u_years'), TXT + ' inputmode="numeric"', 'c2')}
    </div>
    ${sw('ftb', s('f_ftb'), v.ftb)}
    ${sw('add', s('f_add', pct(C.sur * 100, 0)), v.add)}
    ${sw('nr', s('f_nr', pct(C.nr * 100, 0)), v.nr)}
    <div class="pr-out" data-out></div>
    <p class="pr-foot">${C.rateSrc ? s('calc_rate_src', s('c_mort_lbl', C.rateSrc.y, C.rateSrc.ltv), month(C.rateSrc.month)) : s('calc_rate_fallback')} ${so ? s('calc_so_sdlt') + ' ' : ''}${s('calc_excl')}</p>
    <p class="pr-foot">${s('calc_sur_note')}</p>
  </div>`;
}
const TXT = 'type="text" autocomplete="off" spellcheck="false"';
const numIn = (x, d) => {        // value for a small input: 5,37 · 10 · 2,5 (no trailing zeros)
  const sep = LG() === 'en' ? '.' : ',';
  let t = num(x, d ?? (x % 1 ? 2 : 0));
  if (t.includes(sep)) t = t.replace(/0+$/, '').replace(sep === '.' ? /\.$/ : /,$/, '');
  return t;
};
// a price as typed or pasted: "450.000", "450,000", "£1.132.000,00" (pence dropped), "450k", "£1.2m", "1,2 mi"
const parseMoney = x => {
  let t = String(x ?? '').trim().toLowerCase().replace(/[£\s]/g, '');
  const m = t.match(/^(\d+(?:[.,]\d+)?)(k|mil|m|mi|mn)$/);
  if (m) { const v = parseFloat(m[1].replace(',', '.')) * (m[2] === 'k' || m[2] === 'mil' ? 1e3 : 1e6); return Math.min(Math.round(v), MAX_PRICE); }
  t = t.replace(/[.,]\d{1,2}$/, '');                 // pence
  const d = t.replace(/[^\d]/g, '');
  return d ? Math.min(+d, MAX_PRICE) : 0;
};
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function calcRead(root) {
  const f = k => root.querySelector(`[data-f="${k}"]`);
  // %, rate and years never need thousands separators: either "5,37" or "5.37" is a decimal, in both languages
  const n = (k, d) => { const el = f(k); if (!el) return d; const x = parseFloat(String(el.value).trim().replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? x : d; };
  const d = calcDefaults(), r1 = x => Math.round(x * 10) / 10;
  const rate = Math.round(clamp(n('rate', d.rate), ...LIM.rate) * 100) / 100;
  return {
    price: parseMoney(f('price').value), dep: r1(clamp(n('dep', d.dep), ...LIM.dep)), rate,
    term: Math.round(clamp(n('term', d.term), ...LIM.term)),        // whole years, as the label shows
    share: r1(clamp(n('share', d.share), C.shareMin, C.shareMax)),
    ftb: !!f('ftb')?.checked, add: !!f('add')?.checked, nr: !!f('nr')?.checked,
  };
}
function calcOut(v, mode) {
  const so = mode === 'so';
  const base = so ? v.price * v.share / 100 : v.price;          // what the buyer pays for
  const dep = base * v.dep / 100, loan = Math.max(0, base - dep);
  // first-time buyers' relief: never owned a home anywhere, price within the cap (shared ownership: the full value);
  // the additional-dwelling and non-resident surcharges add to every band (relief bands included)
  const relief = v.ftb && !v.add && v.price <= C.ftb.max_price;
  const extra = (v.add ? C.sur : 0) + (v.nr ? C.nr : 0);
  const tx = sdlt(base, (relief ? C.ftb.bands : C.std).map(b => ({ from: b.from, rate: b.rate + extra })));
  const pay = annuity(loan, v.rate, v.term);
  const rent = so ? C.rent * (1 - v.share / 100) * v.price / 12 : 0;
  const surs = [v.add ? s('sd_sur_add') : '', v.nr ? s('sd_sur_nr') : ''].filter(Boolean).join(' + ');
  const note = [relief ? s('sd_relief') : v.ftb && v.add ? s('sd_noftb_add') : v.ftb ? s(so ? 'sd_nocap_so' : 'sd_nocap', gbpS(C.ftb.max_price)) : s('sd_std'),
    extra ? `${surs}: ${s('sd_sur', pct(extra * 100, 0))}` : '', so ? s('sd_so') : ''].filter(Boolean).join(' · ');
  const work = tx.parts.map(p => `<li><span>${s('sd_band', gbp(p.from), gbp(Math.min(base, p.to)))}</span><span>${gbp(p.amt)} × ${pct(p.rate * 100, 0)} = <b>${gbp(p.tax)}</b></span></li>`).join('');
  const row = (k, v2, cls = '') => `<tr class="${cls}"><td>${k}</td><td>${v2}</td></tr>`;
  return { pay, rent, tax: tx.tax, dep, loan, base, html: `
    <div class="pr-tiles2">
      <div class="pr-t-main"><span>${s('o_month')}</span><b>${gbp(pay + rent)}<small>${s('per_month')}</small></b><small>${s(so ? 'o_month_sub_so' : 'o_month_sub')}</small></div>
      <div><span>${s('o_up')}</span><b>${gbp(dep + tx.tax)}</b><small>${s('o_up_sub')}</small></div>
    </div>
    <table class="pr-rows">
      ${so ? row(s('o_share', numIn(v.share, 1)), gbp(base)) : ''}
      ${row(s('o_dep', num(v.dep, v.dep % 1 ? 1 : 0)), gbp(dep))}
      ${row(`${s('o_sdlt')}<small>${note}</small>`, gbp(tx.tax))}
      ${row(s(so ? 'o_loan_so' : 'o_loan', num(base ? loan / base * 100 : 0)), gbp(loan))}
      ${row(s('o_pay', num(v.term), numIn(v.rate, 2)), `${gbp(pay)}<small>${s('per_month')}</small>`)}
      ${so ? row(s('o_rent', numIn(100 - v.share, 1), pct(C.rent * 100, 2)), `${gbp(rent)}<small>${s('per_month')}</small>`) : ''}
    </table>
    ${tx.parts.length ? `<details class="pr-work"><summary>${s('sd_work')}</summary><ul>${work}</ul></details>` : ''}` };
}
function wireCalc(root) {
  const h = A.D.byId.get(root.dataset.home), e = est(h); if (!e) return;
  const mode = root.dataset.mode, out = root.querySelector('[data-out]'), priceEl = root.querySelector('[data-f="price"]');
  let last = '';
  const paint = () => {
    const v = calcRead(root), key = JSON.stringify(v) + LG();
    if (key === last) return v;              // 'change' after 'input': nothing new (and a click in the output must not be lost)
    last = key;
    const o = calcOut(v, mode), open = out.querySelector('details[open]');
    out.innerHTML = o.html;
    if (open) out.querySelector('details')?.setAttribute('open', '');
    return v;
  };
  const save = () => {
    const v = calcRead(root), st = calcLoad();
    st.dep = v.dep; st.term = v.term; st.ftb = v.ftb; st.add = v.add; st.nr = v.nr;
    // today's default rate is not frozen into storage: only a rate that differs from it is remembered
    if (Math.abs(v.rate - C.rate) < 0.005) { st.rate = C.rate; st.rateSet = false; } else { st.rate = v.rate; st.rateSet = true; }
    if (mode === 'so') st.share = v.share;
    if (!v.price || Math.round(v.price) === Math.round(e.value)) delete st.px[h.id]; else st.px[h.id] = v.price;
    calcSave(st);
  };
  root.addEventListener('input', () => { paint(); save(); });
  root.addEventListener('change', () => { paint(); save(); });
  // empty / 0 on blur = back to the estimate
  priceEl.addEventListener('blur', () => { const p = parseMoney(priceEl.value); priceEl.value = num(p || Math.round(e.value)); if (!p) { last = ''; paint(); save(); } });
  $$('input[type="text"]', root).forEach(el => el.addEventListener('focus', () => el.select()));
  // tidy the small fields on blur to the value actually used (clamped, localised)
  root.addEventListener('focusout', ev => {
    const k = ev.target.dataset.f; if (!k || k === 'price' || ev.target.type === 'checkbox') return;
    const v = calcRead(root); ev.target.value = numIn(v[k], k === 'rate' ? 2 : undefined);
  });
  root.querySelector('[data-calc-reset]').addEventListener('click', () => {
    const d = calcDefaults(), st = calcLoad();
    delete st.px[h.id];
    calcSave({ ...st, ...d, rateSet: false });
    priceEl.value = num(Math.round(e.value));
    const set = (k, x) => { const el = root.querySelector(`[data-f="${k}"]`); if (el) el.value = x; };
    set('dep', numIn(d.dep)); set('rate', numIn(d.rate, 2)); set('term', numIn(d.term)); set('share', numIn(d.share));
    for (const k of ['ftb', 'add', 'nr']) { const el = root.querySelector(`[data-f="${k}"]`); if (el) el.checked = d[k]; }
    last = ''; paint();
  });
  paint();
}

/* comparables */
function compsHTML(h, e) {
  const all = (e.comps || []).map((id, i) => C.CI[id] && { id, w: (e.comps_w || [])[i], ...C.CI[id] }).filter(Boolean);
  const cs = all.slice(0, 5);
  if (!cs.length) return '';
  const tyl = c => c.src === 'sold' ? sm('ppd', c.ppd_type) : sm('lst_type', c.type) || sm('ppd', c.ppd_type);
  const items = cs.map((c, i) => {
    const d = h.lat ? hav(h.lat, h.lon, c.lat, c.lon) : null;
    // comparables are labelled for what they are: a sale (price paid) or a listing (asking price)
    const meta = [esc(tyl(c)), c.beds != null ? s('bed_short', c.beds) : '', `${num(Math.round(c.area))} m²`, d != null ? dist(d) : '',
      c.src === 'sold' ? s('comp_sold', fmtD(c.date)) : s('comp_ask'), ok(c.w) ? s('comp_w', pct(c.w * 100, 0)) : ''].filter(Boolean).join(' · ');
    return `<li><span class="pr-n">${i + 1}</span><div class="pr-ca"><div class="pr-cn">${link(c.url, esc(c.address))}</div><div class="pr-cm">${meta}</div></div>
      <div class="pr-cv"><b>${gbp(c.price)}</b><span>${gbp(compPpm2(c, areaUsed(e)))}/m² ${s('comp_adj')}</span></div></li>`;
  }).join('');
  const onMap = HI && HI.id === h.id;
  return `<div class="pr-sub pr-comps"><div class="pr-sub-head"><h5>${s('comps_title')}</h5>
      <button type="button" class="btn sm${onMap ? ' active' : ''}" data-pr-comps="${esc(h.id)}" aria-pressed="${onMap ? 'true' : 'false'}">${s(onMap ? 'comps_hide' : 'comps_show')}</button></div>
    <details class="pr-det pr-comps-det"><summary>${s('comps_more', cs.length, e.n)}</summary>
    <ol class="pr-comp-list">${items}</ol>
    <p class="small muted" style="margin:6px 0 0">${C.src === 'sold' ? s('comps_note_sold') : s('comps_note', num((1 - C.askToSold) * 100, 1), monthY(cs[0].date))}</p></details></div>`;
}
let HI = null;          // { id, group } comparables highlighted on the map
function clear() {
  if (HI && A) A.map.removeLayer(HI.group);
  HI = null;
  $$('[data-pr-comps]').forEach(b => { b.textContent = s('comps_show'); b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
}
function showComps(id, btn) {
  const h = A.D.byId.get(id), e = est(h); if (!e || !h.lat) return;
  clear();
  const cs = (e.comps || []).map(cid => C.CI[cid]).filter(Boolean).slice(0, 5);
  const g = L.layerGroup(), home = [h.lat, h.lon];
  cs.forEach((c, i) => {
    L.polyline([home, [c.lat, c.lon]], { color: '#0f172a', weight: 1.5, opacity: .5, dashArray: '4 5', interactive: false }).addTo(g);
    L.circleMarker([c.lat, c.lon], { radius: 11, color: '#ffffff', weight: 2.5, fillColor: '#0f766e', fillOpacity: 1, bubblingMouseEvents: false })
      .bindTooltip(() => `<b>${i + 1}. ${esc(c.address)}</b><br>${gbp(c.price)} · ${num(c.area)} m² · ${gbp(compPpm2(c, areaUsed(e)))}/m² ${s('comp_adj')}<br><span class="pr-dim">${c.src === 'sold' ? s('comp_sold', fmtD(c.date)) : s('comp_ask')}</span>`, { className: 'home-tip', direction: 'top', offset: [0, -10] })
      .addTo(g);
    L.tooltip({ permanent: true, direction: 'center', className: 'pr-num', interactive: false }).setLatLng([c.lat, c.lon]).setContent(String(i + 1)).addTo(g);
  });
  g.addTo(A.map);
  HI = { id, group: g };
  if (btn) { btn.textContent = s('comps_hide'); btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
  fitTo([home, ...cs.map(c => [c.lat, c.lon])]);
}
function fitTo(pts) {
  const det = $('#detail'), open = det && det.classList.contains('open'), b = L.latLngBounds(pts);
  let pad;
  if (phone()) {
    if (det.classList.contains('full')) det.classList.remove('full');      // back to half height
    const cover = open ? Math.round(det.parentElement.clientHeight * .56) : 0;
    pad = { paddingTopLeft: [28, 64], paddingBottomRight: [28, cover + 24] };   // 64: clear of the top-right map controls
  } else pad = { paddingTopLeft: [48, 48], paddingBottomRight: [(open ? det.offsetWidth + 24 : 0) + 48, 48] };
  A.map.flyToBounds(b, { ...pad, maxZoom: 17, duration: .6 });
}

function wire(body) {
  if (!A || ST !== 'ready' || !body) return;
  $$('.pr-calc', body).forEach(wireCalc);
  $$('[data-pr-comps]', body).forEach(b => b.addEventListener('click', () => { if (HI && HI.id === b.dataset.prComps) clear(); else showComps(b.dataset.prComps, b); }));
}

/* ---------------- block ---------------- */
function blockCard(b, units) {
  if (!A || ST !== 'ready') return '';
  const es = units.map(u => est(u)).filter(Boolean);
  if (!es.length) return '';
  const vals = es.map(e => e.value), kind = kindOf({ tenure: b.tenure });
  const byBeds = {};
  units.forEach(u => { const e = est(u); if (e) (byBeds[u.beds] ||= []).push(e.value); });
  const rows = Object.keys(byBeds).sort().map(k => {
    const v = byBeds[k];
    const lo = Math.min(...v), hi = Math.max(...v);
    return `<tr><td>${s('beds_n', +k)} <span class="muted">(${v.length})</span></td><td>${lo === hi ? '' : `${gbpS(lo)} – ${gbpS(hi)}`}</td><td><b>${gbp(median(v))}</b></td></tr>`;
  }).join('');
  const med = median(vals), ppm2 = median(es.map(e => e.value / areaUsed(e)));
  const tn = kind === 'so' ? s('blk_so', gbp(med), gbp(med * .25), gbp(C.rent * .75 * med / 12)) : kind === 'lcr' ? s('blk_lcr') : '';
  return `<section class="pr-card pr-${kind} pr-block">
    <div class="pr-head"><span class="pr-k">${s('card_title')}</span><span class="pr-badge pr-badge-${kind}">${sm('badge', kind)}</span></div>
    <div class="pr-label">${s('blk_label')}</div>
    <div class="pr-big pr-big-sm">${gbp(Math.min(...vals))} – ${gbp(Math.max(...vals))}</div>
    <div class="pr-range">${s('blk_median', `<b>${gbp(med)}</b>`, gbp(ppm2))}</div>
    <table class="pr-rows pr-rows3">${rows}</table>
    ${tn ? `<p class="small" style="margin:10px 0 0">${tn}</p>` : ''}
    <p class="pr-disc">${s('blk_hint')} <a href="#" data-pr-tab>${s('how')}</a></p>
  </section>`;
}
const unitCell = u => (ST === 'ready' ? gbpS(est(u)?.value) : undefined);

/* ---------------- colour mode / list / tooltips ---------------- */
const catOf = h => { const e = est(h); return e ? String(binOf(e.value)) : '?'; };
const colorOf = h => { const e = est(h); return e ? binCol(e.value) : null; };
const cats = () => (ST === 'ready' ? BIN_COL.map((col, i) => ({ c: String(i), col, label: STR[LG()].bins[i] })) : []);
const blockColor = b => { const v = median(b.units.map(id => est(A.D.byId.get(id))?.value)); return ok(v) ? binCol(v) : null; };
const legendNote = () => `<div class="small muted pr-legnote">${s('leg_note')} <a href="#" data-pr-tab>${s('how')}</a></div>`;
const tip = h => { const e = est(h); return e ? ` · ~${gbpS(e.value)}` : ''; };
const value = h => est(h)?.value;
const short = h => (est(h) ? gbpS(est(h).value) : undefined);

/* ---------------- map layers: sold (Land Registry) / for sale (OnTheMarket) ---------------- */
const LY = {};
const mr = () => { const z = A.map.getZoom(); return z < 14 ? 2.4 : z < 15 ? 3 : z < 16 ? 3.6 : z < 17 ? 4.2 : z < 18 ? 5 : 5.8; };
// a diamond on the shared canvas (same hit-testing as a circle marker); corners at the radius so the
// renderer's dirty-rect redraws stay inside the marker's bounds
const Diamond = window.L && L.CircleMarker.extend({
  _updatePath() {
    const R = this._renderer;
    if (!R || !R._ctx) return L.CircleMarker.prototype._updatePath.call(this);
    if (!R._drawing || this._empty()) return;
    const p = this._point, ctx = R._ctx, r = Math.max(this._radius, 1);
    ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath();
    R._fillStroke(ctx, this);
  },
});
function buildSold() {
  const g = L.layerGroup([], { attribution: 'Sales © HM Land Registry (OGL)' });
  const seen = new Map(), k0 = Math.PI / 180;
  M.sold.transactions.forEach(tx => {
    if (!ok(tx.lat)) return;
    // postcode centroids stack sales on one point: spread them on a small sunflower spiral
    const key = tx.lat.toFixed(5) + ',' + tx.lon.toFixed(5), i = seen.get(key) || 0;
    seen.set(key, i + 1);
    const a = i * 2.39996, rr = i ? 7 * Math.sqrt(i) : 0;
    const lat = tx.lat + rr * Math.cos(a) / 111320, lon = tx.lon + rr * Math.sin(a) / (111320 * Math.cos(tx.lat * k0));
    const adj = tx.price * hpiFactor(tx.date, tx.ppd_type);
    // a ring, so a sale never reads as one of the development's (filled) homes
    const m = L.circleMarker([lat, lon], { radius: mr(), color: binCol(adj), weight: 2, fillColor: '#ffffff', fillOpacity: .75, bubblingMouseEvents: false });
    m.bindTooltip(() => soldTip(tx, adj), { className: 'home-tip pr-tip', direction: 'top', offset: [0, -4] });
    m.addTo(g);
  });
  return g;
}
function soldTip(tx, adj) {
  const bits = [sm('ppd', tx.ppd_type), sm('tenure_lr', tx.tenure), tx.new_build ? s('new_build') : '', tx.retirement ? s('retirement') : ''].filter(Boolean).join(' · ');
  const area = tx.floor_area ? ` · ${num(tx.floor_area)} m² · ${gbp(tx.price / tx.floor_area)}/m²` : ` · <span class="pr-dim">${s('no_area')}</span>`;
  return `<b>${esc(tx.address)}</b>${tx.postcode ? ` <span class="pr-dim">${esc(tx.postcode)}</span>` : ''}<br>
    <b>${gbp(tx.price)}</b> · ${fmtD(tx.date)}${area}<br>${esc(bits)}${Math.abs(adj / tx.price - 1) > .005 ? `<br><span class="pr-dim">${s('today_eq', gbp(Math.round(adj / 1000) * 1000))}</span>` : ''}`;
}
const isShare = x => /shared ownership|auction/i.test(x.price_qualifier || '');
function buildListings() {
  const g = L.layerGroup([], { attribution: '<a href="https://www.onthemarket.com/">OnTheMarket</a>' });
  M.listings.listings.forEach(x => {
    if (!ok(x.lat)) return;
    const m = new Diamond([x.lat, x.lon], { radius: mr() * 1.45, color: '#0f172a', weight: 1.1, fillColor: isShare(x) ? '#94a3b8' : binCol(x.price), fillOpacity: .95, bubblingMouseEvents: false });
    m.bindTooltip(() => lstTip(x), { className: 'home-tip pr-tip', direction: 'top', offset: [0, -5] });
    m.bindPopup(() => lstPopup(x), { className: 'pr-pop', maxWidth: 260, offset: [0, -2], autoPanPaddingTopLeft: [16, 120] });
    // keep the popup clear of the detail drawer / bottom sheets (read when the popup pans into view)
    Object.defineProperty(m.getPopup().options, 'autoPanPaddingBottomRight', { configurable: true, get: popPad });
    m.on('popupopen', () => m.closeTooltip());
    m.addTo(g);
  });
  return g;
}
function popPad() {
  const det = $('#detail'), open = det && det.classList.contains('open');
  if (phone()) return [16, (open ? det.offsetHeight : $('#sidebar')?.offsetHeight || 0) + 16];
  return [(open ? det.offsetWidth + 24 : 0) + 16, 16];
}
const qualTxt = q => q ? (LG() === 'en' ? q : sm('qual', q)) : '';
function lstTip(x) {
  const bits = [x.beds != null ? s('bed_short', x.beds) : '', sm('lst_type', x.type), x.new_home ? s('new_home') : ''].filter(Boolean).join(' · ');
  return `<b>${gbp(x.price)}</b>${x.price_qualifier ? ` <span class="pr-dim">${esc(qualTxt(x.price_qualifier))}</span>` : ''}<br>${esc(bits)}<br>${esc(x.address)}`;
}
function lstPopup(x) {
  const bits = [x.beds != null ? s('beds_n', x.beds) : '', x.baths ? s('baths', x.baths) : '', sm('lst_type', x.type), x.new_home ? s('new_home') : ''].filter(Boolean).join(' · ');
  const area = x.m2 ? `<div>${num(x.m2, x.m2 % 1 ? 1 : 0)} m²${x.sqft ? ` (${num(x.sqft)} sq ft)` : ''} · ${gbp(x.price / x.m2)}/m²</div>` : '';
  const cond = [x.lease_years != null && x.tenure !== 'freehold' ? s('lease_left', x.lease_years) : '',
    ...(x.sale_flags || []).filter(f => f !== 'short_lease').map(f => sm('sale_flag', f))].filter(Boolean).join(' · ');
  const url = safeUrl(x.url);
  return `<div class="pr-popc">
    ${x.price_qualifier ? `<div class="pr-dim small">${esc(qualTxt(x.price_qualifier))}</div>` : ''}
    <div class="pr-pop-price">${gbp(x.price)}</div>
    <div>${esc(bits)}</div><div class="pr-dim">${esc(x.address)}</div>${area}
    ${cond ? `<div class="pr-dim small">${esc(cond)}</div>` : ''}
    ${x.agent ? `<div class="pr-dim small">${esc(x.agent)}</div>` : ''}
    ${url ? `<a class="btn sm primary" href="${esc(url)}" target="_blank" rel="noopener">${s('open_listing')}</a>` : ''}</div>`;
}
const LYID = { sold: 'ly-sold', listings: 'ly-listings' };
async function setLayer(name, on) {
  const box = document.getElementById(LYID[name]), row = box.closest('.toggle-row'), lbl = row.querySelector(':scope > span');
  const state = t => { if (t) lbl.dataset.state = t; else delete lbl.dataset.state; };
  if (!on) { if (LY[name]) A.map.removeLayer(LY[name]); if (!row.classList.contains('pr-fail')) state(''); layerLegend(); return; }
  row.classList.remove('pr-fail'); row.classList.add('pr-busy'); state(s('ly_loading'));
  try {
    if (name === 'sold') await need('context').catch(() => {});
    await need(name);
    if (!C.hpiLast) prepareMin();
  } catch {
    box.checked = false; row.classList.remove('pr-busy'); row.classList.add('pr-fail'); state(s('ly_failed')); return;
  }
  row.classList.remove('pr-busy', 'pr-fail'); state('');
  if (!box.checked) return;                       // switched off while loading
  LY[name] ||= name === 'sold' ? buildSold() : buildListings();
  LY[name].addTo(A.map);
  A.raiseHomes();                                 // homes stay clickable on the shared canvas
  layerLegend();
}
function prepareMin() {          // layers can work before / without estimates.json: only the HPI table is needed
  const ms = M.context?.ukhpi?.months || [];
  C.hpi = new Map(ms.map(m => [m.month, m])); C.hpiFirst = ms[0]; C.hpiLast = ms[ms.length - 1];
}
function layerLegend() {
  const el = document.getElementById('ly-market-legend'); if (!el || !A) return;
  const on = n => LY[n] && A.map.hasLayer(LY[n]);
  if (!on('sold') && !on('listings')) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const bins = BIN_COL.map((c, i) => `<span><i style="background:${c}"></i>${STR[LG()].bins[i]}</span>`).join('');
  el.innerHTML = `<div class="pr-lyl-k">${s('lyl_key', '<span class="ly-key ly-key-sold"></span>', '<span class="ly-key ly-key-listing"></span>')}</div>
    <div class="pr-lyl-bins">${bins}</div>
    <div class="small muted">${s('lyl_counts', on('sold') ? num(M.sold.transactions.length) : null, on('listings') ? num(M.listings.listings.length) : null)}.
      ${on('sold') ? s(C.hpiLast ? 'lyl_note_sold' : 'lyl_note_sold_raw') : ''} ${on('listings') ? s('lyl_note_lst') : ''}</div>`;
  el.classList.remove('hidden');
}
function resizeLayers() {
  if (!A) return;
  const r = mr();
  if (LY.sold) LY.sold.eachLayer(m => m.setRadius(r));
  if (LY.listings) LY.listings.eachLayer(m => m.setRadius(r * 1.45));
}
function turnOn(name, fit) {
  const box = document.getElementById(LYID[name]);
  if (!box.checked) { box.checked = true; box.dispatchEvent(new Event('change')); }
  if (fit) {
    const c = M.sold?.centre || M.listings?.centre || { lat: 51.3826, lon: 0.0213 };
    const ll = L.latLng(c.lat, c.lon), d = 2500 / 111320;
    if (phone()) $('#sidebar')?.classList.add('collapsed');
    A.map.flyToBounds(L.latLngBounds([ll.lat - d, ll.lng - d / Math.cos(ll.lat * Math.PI / 180)], [ll.lat + d, ll.lng + d / Math.cos(ll.lat * Math.PI / 180)]), { padding: [20, 20], duration: .7 });
  }
}

/* ---------------- the Preços tab ---------------- */
let tabEl = null, tabKey = '';
function renderTab(el) {
  if (el) tabEl = el;
  if (!tabEl || !A) return;
  const key = LG() + ST;
  if (key === tabKey) return;                        // already drawn for this language / state
  tabKey = key;
  if (ST !== 'ready') {
    tabEl.innerHTML = ST === 'error' ? `<section><div class="note warn">${s('tab_error')}</div></section>`
      : `<section><div class="pr-card pr-skel"><div class="pr-skel-line w60"></div><div class="pr-skel-line w40"></div><div class="small muted">${s('tab_loading')}</div></div></section>`;
    return;
  }
  tabEl.innerHTML = tabHTML();
  tipify(tabEl);
  [['sold', soldSection], ['listings', lstSection], ['berkeley', brkSection]].forEach(([n, fn]) => {
    const fill = () => { const box = $(`[data-pr-sec="${n}"]`, tabEl); if (box && tabKey === key) { box.innerHTML = fn(); box.removeAttribute('aria-busy'); tipify(box); } };
    need(n).then(fill, () => { const box = $(`[data-pr-sec="${n}"]`, tabEl); if (box) { box.innerHTML = `<p class="small muted">${s('ly_failed')}</p>`; box.removeAttribute('aria-busy'); } });
  });
}
const sec = (title, body, extra = '') => `<section${extra}><h4 class="sec-title">${title}</h4>${body}</section>`;
const lazySec = (name, title) => sec(title, `<div data-pr-sec="${name}" aria-busy="true"><div class="pr-skel-line w60"></div><div class="pr-skel-line w40"></div></div>`);
function tabHTML() {
  const E = M.estimates, hs = A.D.homes, acc = E.accuracy || {}, prem = E.new_build_premium || {};
  const vals = f => hs.filter(f).map(h => est(h)?.value).filter(ok);
  const hv = vals(h => h.kind === 'house' && h.tenure === 'Private'), fv = vals(h => h.kind === 'apartment');
  const rng = v => v.length ? s('t_range', gbpS(Math.min(...v)), gbpS(Math.max(...v))) : '—';
  const hero = `<section><div class="pr-hero">
      <div class="small muted">${s('hero_k', hs.length)}</div>
      <h3>${s('hero_h')}</h3><p>${s('hero_p')}</p>
      <div class="pr-tiles">
        <div><span>${s('t_houses')}</span><b>${gbpS(median(hv))} <em>${s('t_med_lbl')}</em></b><small>${rng(hv)}</small></div>
        <div><span>${s('t_flats')}</span><b>${gbpS(median(fv))} <em>${s('t_med_lbl')}</em></b><small>${rng(fv)}</small></div>
        <div><span>${s('t_err')}</span><b>±${pct(acc.median_abs_pct_error)}</b><small>${s('t_err_sub', pct(acc.p80_abs_pct_error))}</small></div>
        <div><span>${s('t_prem')}</span><b>${pctS((prem.factor - 1) * 100)}</b><small>${s('t_prem_sub', pctS((prem.low - 1) * 100), pctS((prem.high - 1) * 100))}</small></div>
      </div>
      <div class="btn-row"><button class="btn primary" data-pr-mode>${s('btn_mode')}</button></div>
    </div>
    <div class="note warn pr-disclaimer">${s('disclaimer')}</div></section>`;
  const notes = (LG() === 'pt' ? E.notes_pt : E.notes) || [];
  const how = sec(s('s_how'), `<div class="card"><p class="pr-p">${esc(E.method?.[LG()] || E.method?.en || '')}</p>
      ${notes.length ? `<details class="pr-det"><summary>${s('s_notes')}</summary><ul class="reason-list">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></details>` : ''}
      <p class="small muted" style="margin:8px 0 0">${s('gen', fmtD(E.generated))}</p></div>`);
  const bt = acc.by_type || {}, order = ['detached', 'semi', 'terraced', 'flat'];
  const accS = sec(s('s_acc'), `<div class="card"><p class="pr-p">${s('acc_text', acc.backtest_n, pct(acc.median_abs_pct_error), pct(acc.p80_abs_pct_error), num((acc.share_within_low_high || 0) * 100))}</p>
      <table class="unit-table pr-tbl"><thead><tr><th>${s('th_type')}</th><th class="num">${s('th_n')}</th><th class="num">${s('th_err')}</th><th class="num">${s('th_p80')}</th></tr></thead><tbody>
      ${order.filter(k => bt[k]).map(k => `<tr><td>${sm('type_one', k)}</td><td class="num">${bt[k].n}</td><td class="num">±${pct(bt[k].median_abs_pct_error)}</td><td class="num">${pct(bt[k].p80_abs_pct_error)}</td></tr>`).join('')}
      </tbody></table><p class="small muted" style="margin:8px 0 0">${s('acc_caveat')}</p></div>`);
  const ev = prem.evidence || {}, otm = ev.onthemarket_new_homes, brk = ev.berkeley;
  const rs = (otm?.schemes || otm?.rows || []).map(r => r.ratio).filter(ok);
  const evList = [
    rs.length ? `<li>${s('prem_ev_otm', rs.length, pctS((Math.min(...rs) - 1) * 100), pctS((Math.max(...rs) - 1) * 100), pctS((median(rs) - 1) * 100))}</li>` : '',
    // ratios this far out (thin samples in very different boroughs) were not used for the factor
    brk?.by_development ? `<li>${s('prem_ev_brk')} ${Object.entries(brk.by_development).map(([k, v]) => `${esc(k)} ${pctS((v.median_ratio - 1) * 100)}${v.median_ratio > 1.6 ? ` <span class="muted">(${s('not_used')})</span>` : ''}`).join(' · ')}</li>` : '',
    ev.land_registry ? `<li>${s('prem_ev_lr', ev.land_registry.n_new_build_sales)}</li>` : '',
  ].join('');
  const premS = sec(s('s_prem'), `<div class="card"><p class="pr-p" style="font-size:15px">${s('prem_big', num(prem.factor, 2), num(prem.low, 2), num(prem.high, 2))}</p>
      <ul class="reason-list">${evList}</ul>
      <details class="pr-det"><summary>${s('prem_basis')}</summary><p class="pr-p small">${esc(LG() === 'pt' ? prem.basis_pt : prem.basis_en)}</p></details></div>`);
  let lastT = '';
  const tbl = sec(s('s_table'), `<div style="overflow-x:auto"><table class="unit-table pr-tbl"><thead><tr><th>${s('th_type')}</th><th class="num">${s('th_beds')}</th><th class="num">${s('th_homes')}</th><th class="num">${s('th_m2')}</th><th class="num">${s('th_ppm2')}</th><th class="num">${s('th_est')}</th></tr></thead><tbody>
      ${(E.summary || []).map(r => { const first = r.type !== lastT; lastT = r.type; return `<tr${first ? ' class="pr-grp"' : ''}><td>${first ? sm('type_one', r.type) : ''}</td><td class="num" style="white-space:nowrap">${r.beds}${r.accessibility === 'M4(3)' ? ` <span title="M4(3)" aria-label="${esc(s('acc_m43'))}">♿</span>` : ''}</td><td class="num">${r.n_homes}</td><td class="num"${r.median_area_used != null && r.median_area_used !== r.median_area ? ` title="${esc(s('plan_area', num(r.median_area)))}"` : ''}>${num(r.median_area_used ?? r.median_area)}</td><td class="num">${gbp(r.median_ppm2_resale)}</td><td class="num"><b>${gbpS(r.median_value_newbuild)}</b></td></tr>`; }).join('')}
      </tbody></table></div><p class="small muted" style="margin:6px 0 0">${s('table_note')}</p>`);
  const chart = sec(s('s_chart'), `<div class="card">${ppm2Chart()}<p class="small muted" style="margin:6px 0 0">${s('chart_desc')}</p></div>`);
  return hero + how + accS + premS + tbl + chart + hpiSection() + lazySec('sold', s('s_sold')) + lazySec('listings', s('s_lst')) + lazySec('berkeley', s('s_brk')) + costsSection() + sourcesSection() +
    `<section><div class="note warn pr-disclaimer">${s('disclaimer')}</div></section>`;
}

/* strip chart: comparables' £/m² by type, with the Ravensbourne medians */
function ppm2Chart() {
  const order = ['D', 'S', 'T', 'F'];
  const comps = Object.values(C.CI), byT = {};
  comps.forEach(c => (byT[c.ppd_type] ||= []).push(c));
  const homes = {}; Object.values(C.H).forEach(e => (homes[e.ppd_type] ||= []).push(e));
  const rows = order.filter(k => byT[k] || homes[k]);
  const all = [...comps.map(c => c.ppm2_sold_equiv), ...rows.flatMap(k => (homes[k] || []).map(e => e.value / areaUsed(e)))];
  const lo = Math.floor(Math.min(...all) / 1000) * 1000, hi = Math.ceil(Math.max(...all) / 1000) * 1000;
  const W = 340, L0 = 78, R0 = 10, rowH = 42, top = 6, H = top + rows.length * rowH + 24;
  const x = v => L0 + (v - lo) / (hi - lo) * (W - L0 - R0);
  const step = hi - lo > 6000 ? 2000 : 1000, ticks = [];
  for (let v = lo; v <= hi; v += step) ticks.push(v);
  const fmtT = v => LG() === 'en' ? `£${num(v / 1000)}k` : `£${num(v / 1000)} mil`;
  const grid = ticks.map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${H - 20}" class="pr-grid"/><text x="${x(v)}" y="${H - 6}" text-anchor="middle" class="pr-axis">${fmtT(v)}</text>`).join('');
  const dia = (cx, cy, r, cls, tipTxt) => `<path d="M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z" class="${cls}" data-tip="${esc(tipTxt)}"/>`;
  const body = rows.map((k, i) => {
    const cy = top + i * rowH + rowH / 2, cs = byT[k] || [], hm = homes[k] || [];
    const dots = cs.map((c, j) => {
      const jy = ((j * 7919) % 17 - 8) * 1.1;
      return `<circle cx="${x(c.ppm2_sold_equiv).toFixed(1)}" cy="${(cy + jy).toFixed(1)}" r="4" class="pr-dot" data-tip="${esc(s('chart_tip', esc(c.address), gbp(c.price), num(c.area), gbp(c.ppm2_sold_equiv)))}"/>`;
    }).join('');
    const mc = median(cs.map(c => c.ppm2_sold_equiv));
    const mu = median(hm.map(e => e.ppm2)), mn = median(hm.map(e => e.value / areaUsed(e)));
    const tk = PPD[k];
    return `<text x="0" y="${cy + 4}" class="pr-rowlbl">${esc(sm('type_one', tk))}</text>${dots}
      ${ok(mc) ? `<line x1="${x(mc)}" x2="${x(mc)}" y1="${cy - 14}" y2="${cy + 14}" class="pr-med" data-tip="${esc(`${s('chart_leg')[1]}: ${gbp(mc)}/m²`)}"/>` : ''}
      ${ok(mu) ? dia(x(mu), cy, 6, 'pr-dia-o', `${s('chart_leg')[2]}: ${gbp(mu)}/m²`) : ''}
      ${ok(mn) ? dia(x(mn), cy, 6.5, 'pr-dia', `${s('chart_leg')[3]}: ${gbp(mn)}/m²`) : ''}`;
  }).join('');
  const leg = s('chart_leg');
  return `<div class="pr-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s('s_chart'))}">${grid}<text x="0" y="${H - 6}" class="pr-axis">£/m²</text>${body}</svg>
    <div class="legend-inline pr-leg"><span><i class="pr-k-dot"></i>${leg[0]}</span><span><i class="pr-k-med"></i>${leg[1]}</span><span><i class="pr-k-dia-o"></i>${leg[2]}</span><span><i class="pr-k-dia"></i>${leg[3]}</span></div></div>`;
}
function hpiSection() {
  const U = M.context?.ukhpi; if (!U?.months?.length) return '';
  const ms = U.months, last = ms[ms.length - 1], yr = ms[ms.length - 13];
  const ch = yr ? (last.all / yr.all - 1) * 100 : null;
  const W = 340, H = 76, p = 4, vs = ms.map(m => m.all), lo = Math.min(...vs), hi = Math.max(...vs);
  const x = i => p + i / (ms.length - 1) * (W - 2 * p), y = v => H - 16 - (v - lo) / (hi - lo || 1) * (H - 30);
  const line = ms.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(m.all).toFixed(1)}`).join('');
  const hits = ms.map((m, i) => `<rect x="${(x(i) - (W - 2 * p) / ms.length / 2).toFixed(1)}" y="0" width="${((W - 2 * p) / ms.length).toFixed(1)}" height="${H - 14}" class="pr-hit" data-tip="${esc(`${month(m.month)}: <b>${gbp(m.all)}</b>`)}"/>`).join('');
  const yrs = [...new Set(ms.map(m => m.month.slice(0, 4)))];
  const ticks = yrs.map(Y => { const i = ms.findIndex(m => m.month === Y + '-01'); return i < 0 ? '' : `<text x="${x(i)}" y="${H - 2}" class="pr-axis" text-anchor="${i ? 'middle' : 'start'}">${Y}</text>`; }).join('');
  const t12 = U.latest_one_year_change_pct || {};
  return sec(s('s_hpi'), `<div class="card"><p class="pr-p">${s('hpi_text', month(last.month), gbp(last.all), ch != null ? pctS(ch, 1) : '—')}</p>
    <div class="pr-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s('s_hpi'))}">
      <path d="${line}" class="pr-line"/><circle cx="${x(ms.length - 1)}" cy="${y(last.all)}" r="3.5" class="pr-line-end"/>${ticks}${hits}</svg></div>
    <p class="small muted" style="margin:6px 0 0">${s('hpi_types')} ${['detached', 'semi', 'terraced', 'flat'].filter(k => t12[k] != null).map(k => `${sm('type_one', k)} ${num(t12[k], 1)}%`).join(' · ')}</p></div>`);
}
function soldSection() {
  const S0 = M.sold, all0 = S0.transactions || [], tx = all0.filter(t => !t.retirement && !t.duplicate_of);
  if (!tx.length) return '';
  const nRet = all0.length - tx.length;
  const dates = tx.map(t => t.date).sort(), dMax = dates[dates.length - 1], cut = new Date(new Date(dMax + 'T12:00:00') - 365 * 864e5).toISOString().slice(0, 10);
  const r = `${num((S0.radius_m || 2500) / 1000, 1)} km`;
  const rows = ['D', 'S', 'T', 'F'].map(k => {
    const all = tx.filter(t => t.ppd_type === k), y = all.filter(t => t.date >= cut);
    if (!all.length) return '';
    return `<tr><td>${sm('ppd', k)}</td><td class="num">${num(all.length)}</td><td class="num">${gbpS(median(y.map(t => t.price)))}</td><td class="num"><b>${gbpS(median(all.map(t => t.price * hpiFactor(t.date, t.ppd_type))))}</b></td></tr>`;
  }).join('');
  const nb = tx.filter(t => t.new_build).length;
  return `<div class="card"><p class="pr-p">${s('sold_text', num(tx.length), r, fmtD(dates[0]), fmtD(dMax))}${nb ? ' ' + s('sold_new', nb) : ''}</p>
    <table class="unit-table pr-tbl"><thead><tr><th>${s('th_type')}</th><th class="num">${s('th_sales')}</th><th class="num">${s('th_med12')}</th><th class="num">${s('th_medadj')}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small muted" style="margin:6px 0 0">${s('sold_tbl_note')} ${nRet ? s('sold_ret', nRet) + ' ' : ''}${s('sold_note')}</p>
    <div class="btn-row"><button class="btn" data-pr-layer="sold"><span class="ly-key ly-key-sold"></span>${s('show_map')}</button></div></div>`;
}
function lstSection() {
  const Lx = M.listings, ls = Lx.listings || [];
  const whole = ls.filter(x => !isShare(x));
  const groups = [1, 2, 3, 4, 5].map(b => ({ b, xs: whole.filter(x => b === 5 ? x.beds >= 5 : x.beds === b) }));
  const rows = groups.filter(g => g.xs.length).map(g => {
    const p = g.xs.map(x => x.price);
    return `<tr><td>${g.b === 5 ? '5+' : g.b}</td><td class="num">${g.xs.length}</td><td class="num"><b>${gbpS(median(p))}</b></td><td class="num">${gbpS(quant(p, .25))} – ${gbpS(quant(p, .75))}</td></tr>`;
  }).join('');
  const wa = whole.filter(x => x.m2);
  return `<div class="card"><p class="pr-p">${s('lst_text', num(ls.length), `${num((Lx.radius_m || 2500) / 1000, 1)} km`, fmtD(Lx.generated))}
      ${wa.length ? s('lst_area', wa.length, gbp(median(wa.map(x => x.price / x.m2)))) : ''}</p>
    <table class="unit-table pr-tbl"><thead><tr><th>${s('th_beds')}</th><th class="num">${s('th_lst')}</th><th class="num">${s('th_ask')}</th><th class="num">${s('th_iqr')}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small muted" style="margin:6px 0 0">${s('lst_note')}</p>
    <div class="btn-row"><button class="btn" data-pr-layer="listings"><span class="ly-key ly-key-listing"></span>${s('show_map')}</button></div></div>`;
}
function brkSection() {
  const B = M.berkeley, devs = (B.developments || []).filter(d => d.homes && d.homes.length);
  const dev = (d, open) => {
    const hs = d.homes.filter(h => ok(h.price)).sort((a, b) => (a.type === b.type ? 0 : a.type === 'house' ? -1 : 1) || (a.beds ?? 0) - (b.beds ?? 0) || a.price - b.price);
    const nh = d.homes.filter(h => h.type === 'house').length, nf = d.homes.length - nh;
    const mp = median(d.homes.map(h => h.ppm2));
    const rows = hs.map(h => `<tr><td>${link(h.url, esc(h.name))}<div class="pr-dim small">${esc(sm('brk_type', h.type))}${h.status && h.status !== 'Available' ? ' · ' + esc(sm('brk_status', h.status)) : ''}</div></td>
      <td class="num">${h.beds ?? '—'}</td><td class="num">${h.m2 ? num(h.m2) : '—'}</td><td class="num">${gbpS(h.price)}</td><td class="num">${h.ppm2 ? gbp(h.ppm2) : '—'}</td></tr>`).join('');
    return `<details class="pr-dev"${open ? ' open' : ''}><summary><div><b>${esc(d.name)}</b><span class="pr-dim small"> · ${esc(d.area || '')}${ok(d.dist_km) ? ' · ' + s('km', num(d.dist_km, 1)) : ''}</span></div>
        <div class="pr-dim small">${s('brk_dev', d.homes.length, nh, nf)}${ok(mp) ? ' · ' + s('brk_med', gbp(mp)) : ''}</div></summary>
      <div style="overflow-x:auto"><table class="unit-table pr-tbl"><thead><tr><th>${s('th_home')}</th><th class="num">${s('th_beds')}</th><th class="num">${s('th_m2')}</th><th class="num">${s('th_price')}</th><th class="num">£/m²</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${safeUrl(d.url) ? `<p class="small" style="margin:6px 0 2px">${link(d.url, s('brk_open'))}</p>` : ''}</details>`;
  };
  const comp = devs.filter(d => d.comparable).sort((a, b) => a.dist_km - b.dist_km), other = devs.filter(d => !d.comparable);
  return `<p class="pr-p" style="margin-top:0">${s('brk_text', fmtD(B.generated))}</p>
    ${comp.map((d, i) => dev(d, false)).join('')}
    ${other.length ? `<details class="pr-dev pr-dev-others"><summary><div class="pr-dim">${s('brk_others', other.length)}</div></summary>${other.map(d => dev(d, false)).join('')}</details>` : ''}
    <ul class="reason-list small">${s('brk_caveats').map(c => `<li>${c}</li>`).join('')}</ul>`;
}
function costsSection() {
  const X = M.context || {}, sd = X.sdlt, mo = X.mortgage, so = X.shared_ownership;
  const bandRows = (bands, cap) => bands.map((b, i) => {
    const top = i + 1 < bands.length ? bands[i + 1].from : cap || Infinity;
    return `<tr><td>${s('sd_band', gbpS(b.from), top === Infinity ? Infinity : gbpS(top))}</td><td class="num">${pct(b.rate * 100, 0)}</td></tr>`;
  }).join('');
  const sdlt_ = `<div class="card"><h5 class="pr-h5">${s('c_sdlt')}</h5>
      <div class="pr-dim small">${s('c_std')}</div><table class="unit-table pr-tbl"><tbody>${bandRows(C.std)}</tbody></table>
      <div class="pr-dim small" style="margin-top:10px">${s('c_ftb', gbpS(C.ftb.max_price))}</div><table class="unit-table pr-tbl"><tbody>${bandRows(C.ftb.bands, C.ftb.max_price)}</tbody></table>
      ${sd ? `<p class="small muted" style="margin:8px 0 0">${s('c_sur', pct(sd.additional_surcharge * 100, 0), pct(sd.non_resident_surcharge * 100, 0))} ${s('c_inforce', fmtD(sd.effective_from), fmtD(sd.checked))}
        <a href="${esc(sd.source_url)}" target="_blank" rel="noopener">gov.uk ↗</a></p>` : ''}
      ${sd?.examples?.length ? `<details class="pr-det"><summary>${s('c_examples')}</summary><table class="unit-table pr-tbl"><tbody>${sd.examples.map(x => `<tr><td>${esc(x[`label_${LG()}`] || x.label_en)}</td><td class="num">${gbp(x.tax)}</td></tr>`).join('')}</tbody></table></details>` : ''}</div>`;
  const mort = mo?.rates?.length ? `<div class="card"><h5 class="pr-h5">${s('c_mort')}</h5><table class="unit-table pr-tbl"><tbody>
      ${mo.rates.map(r => `<tr${r.ltv === 90 && r.fixed_years === 2 ? ' class="pr-hl"' : ''}><td>${s('c_mort_lbl', r.fixed_years, r.ltv)}</td><td class="num">${pct(r.rate, 2)}</td></tr>`).join('')}</tbody></table>
      <p class="small muted" style="margin:8px 0 0">${s('c_mort_note', month(mo.month), C.rateSrc ? `${s('c_mort_lbl', C.rateSrc.y, C.rateSrc.ltv)} (${pct(C.rate, 2)})` : pct(C.rate, 2))}
      <a href="${esc(mo.table_url || mo.source_url)}" target="_blank" rel="noopener">bankofengland.co.uk ↗</a></p></div>` : '';
  const soC = so ? `<div class="card"><h5 class="pr-h5">${s('c_so')}</h5><ul class="reason-list" style="margin-top:4px">
      ${s('c_so_rows', pct(C.shareMin, 0), pct(C.shareMax, 0), pct(C.rent * 100, 2), gbp(so.household_income_cap_london || 90000)).map(r => `<li>${r}</li>`).join('')}</ul>
      <p class="small muted" style="margin:8px 0 0"><a href="${esc(so.source_url)}" target="_blank" rel="noopener">gov.uk/shared-ownership-scheme ↗</a></p></div>` : '';
  return sec(s('s_costs'), sdlt_ + mort + soC);
}
function sourcesSection() {
  const X = M.context || {}, E = M.estimates;
  const lr = 'Contains HM Land Registry data © Crown copyright and database right 2026. This data is licensed under the Open Government Licence v3.0.';
  const pc = 'Contains OS data © Crown copyright and database right; Contains Royal Mail data © Royal Mail copyright and database right; Source: Office for National Statistics licensed under the OGL v3.0.';
  const R = s('src_rows');
  const item = (i, url, snap, lic) => `<li><div><a href="${esc(url)}" target="_blank" rel="noopener"><b>${R[i][0]}</b></a> — ${R[i][1]}${snap ? ` <span class="pr-dim">(${snap})</span>` : ''}</div>${lic ? `<div class="pr-lic">${lic}</div>` : ''}</li>`;
  const ukm = X.ukhpi?.latest_month;
  return sec(s('s_src'), `<ul class="pr-src">
    ${item(0, 'https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads', s('snap', M.sold ? fmtD(M.sold.generated) : fmtD(E.generated)), esc(lr))}
    ${item(1, X.ukhpi?.month_url || 'https://landregistry.data.gov.uk/app/ukhpi', ukm ? month(ukm) : '', esc(X.ukhpi?.licence || lr))}
    ${item(2, 'https://postcodes.io/', '', esc(pc))}
    ${item(3, 'https://get-energy-performance-data.communities.gov.uk/', '', esc(s('licence_epc')))}
    ${item(4, 'https://www.onthemarket.com/', s('snap', fmtD(M.listings?.generated || E.generated)), esc(s('licence_otm')))}
    ${item(5, 'https://www.berkeleygroup.co.uk/developments', s('snap', fmtD(M.berkeley?.generated || E.generated)), esc(s('licence_brk')))}
    ${item(6, X.mortgage?.table_url || 'https://www.bankofengland.co.uk/statistics/tables', X.mortgage?.month ? month(X.mortgage.month) : '', esc(s('licence_boe')))}
    ${item(7, X.sdlt?.source_url || 'https://www.gov.uk/stamp-duty-land-tax/residential-property-rates', X.sdlt?.checked ? s('snap', fmtD(X.sdlt.checked)) : '', esc(s('licence_gov')))}
  </ul>`);
}

/* chart tooltips: one floating box per container, driven by [data-tip] marks */
function tipify(root) {
  $$('.pr-chart', root).forEach(ch => {
    if (ch._tip) return;
    const box = document.createElement('div'); box.className = 'pr-ctip'; ch.appendChild(box); ch._tip = box;
    const show = (el, ev) => {
      box.innerHTML = el.dataset.tip; box.style.display = 'block';
      const r = ch.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
      const t = el.getBoundingClientRect(), cx = (ev && ev.clientX) || t.left + t.width / 2;
      box.style.left = Math.max(0, Math.min(r.width - bw, cx - r.left - bw / 2)) + 'px';
      box.style.top = Math.max(0, t.top - r.top - bh - 8) + 'px';
      $$('.pr-on', ch).forEach(x => x.classList.remove('pr-on')); el.classList.add('pr-on');
    };
    const hide = () => { box.style.display = 'none'; $$('.pr-on', ch).forEach(x => x.classList.remove('pr-on')); };
    ch.addEventListener('pointerover', e => { const el = e.target.closest('[data-tip]'); if (el) show(el, e); });
    ch.addEventListener('pointerout', e => { if (e.target.closest('[data-tip]')) hide(); });
    ch.addEventListener('click', e => { const el = e.target.closest('[data-tip]'); el ? show(el, e) : hide(); });
  });
}

/* ---------------- lifecycle ---------------- */
function onLang() {
  if (!A) return;
  tabKey = '';
  if (tabEl && !tabEl.classList.contains('hidden')) renderTab();
  layerLegend();
  const pb = $('#mode-seg [data-mode="price"]'); if (pb && ST === 'error') pb.title = s('unavailable');
  if (HI) $$('[data-pr-comps]').forEach(b => { b.textContent = s('comps_hide'); });
}
function init(api) {
  A = api;
  $('#ly-sold')?.addEventListener('change', e => setLayer('sold', e.target.checked));
  $('#ly-listings')?.addEventListener('change', e => setLayer('listings', e.target.checked));
  A.map.on('zoomend', resizeLayers);
  // delegated: links / buttons in the detail, the legend and the tab
  document.addEventListener('click', e => {
    const tl = e.target.closest('[data-pr-tab]');
    if (tl) { e.preventDefault(); if (phone() && $('#detail')?.classList.contains('open')) $('#d-close')?.click(); A.switchTab('prices'); return; }
    const jp = e.target.closest('[data-pr-jump]');
    if (jp) { e.preventDefault(); const body = jp.closest('.detail-body') || $('#d-body'), f = body && $('.figs', body); if (f) body.scrollTo({ top: body.scrollTop + f.getBoundingClientRect().top - body.getBoundingClientRect().top - 8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return; }
    const md = e.target.closest('[data-pr-mode]');
    if (md) { A.switchTab('explore'); A.setMode('price'); return; }
    const ly = e.target.closest('[data-pr-layer]');
    if (ly) turnOn(ly.dataset.prLayer, true);
  });
  const go = () => {
    ST = 'loading';
    Promise.allSettled([need('estimates'), need('context')]).then(([e]) => {
      ST = e.status === 'fulfilled' && e.value && e.value.homes ? 'ready' : 'error';
      if (ST === 'ready') prepare();
      const pb = $('#mode-seg [data-mode="price"]');
      if (pb) { pb.disabled = ST !== 'ready'; pb.title = ST === 'ready' ? '' : s('unavailable'); }
      tabKey = '';
      try { A.onReady(); } catch (err) { console.error(err); }
      if (tabEl && !tabEl.classList.contains('hidden')) renderTab();
    });
  };
  // after the first paint: the estimates are not needed to draw the map
  if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 1200 }); else setTimeout(go, 150);
}

window.Prices = { init, houseCard, blockCard, unitCell, wire, clear, catOf, colorOf, cats, blockColor, legendNote, tip, value, short, renderTab, onLang };
})();
