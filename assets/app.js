/* Ravensbourne Place — interactive map (Leaflet). Data: data/*.json, tiles: tiles/{z}/{x}/{y}.webp */
(() => {
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/* ---------------- strings ---------------- */
const STR = {
  pt: {
    loading: 'Carregando mapa…', subtitle: 'Bromley · Berkeley Homes · pedido',
    tab_explore: 'Explorar', tab_phases: 'Fases', tab_updates: 'Atualizações', tab_list: 'Lista', tab_prices: 'Preços',
    search_ph: 'Buscar plot, ex. R-S12_034 ou Block E', filter_ph: 'Filtrar por plot ou tipologia…',
    color_by: 'Colorir por', m_beds: 'Quartos', m_tenure: 'Tenure', m_type: 'Tipo', m_price: 'Preço',
    ly_sold: 'Vendidas recentemente (Land Registry)', ly_listings: 'À venda agora (OnTheMarket)', th_value: 'Estim.',
    legend_hint: 'Clique numa categoria para mostrar/ocultar no mapa.',
    layers: 'Camadas', ly_drawings: 'Desenhos da Fase 1 (plantas)', ly_phases: 'Fases 1–4', ly_parcels: 'Parcelas da Fase 1', ly_homes: 'Casas e prédios',
    sheets: 'Pranchas originais', sheets_hint: 'Abrem em tela cheia com zoom. No mapa elas já aparecem encaixadas no lugar.',
    fit: 'Ajustar', open_file: 'Abrir arquivo', lb_hint: 'Role/pinça para zoom · arraste para mover · ← → troca · Esc fecha',
    th_beds: 'Qts', th_type: 'Tipo', th_area: 'm²', th_phase: 'Fase',
    homes: 'imóveis', houses: 'casas', apartments: 'apartamentos', affordable: 'acessíveis (affordable)',
    beds_n: n => `${n} quarto${n > 1 ? 's' : ''}`, bed_short: n => `${n}q`,
    block: 'Prédio', blocks: 'prédios',
    map: 'Mapa', satellite: 'Satélite',
    hint: 'Clique numa casa ou prédio para ver ficha, fachada e planta',
    elevation: 'Fachadas', floorplans: 'Plantas', floorplans_lvl: 'Plantas por andar', enlarge: '🔍 ampliar',
    k_occ: 'Quartos / pessoas', k_type: 'Tipo de casa', k_ht: 'Tipologia (housetype)', k_design: 'Opção de fachada',
    k_tenure: 'Tenure', k_gia: 'Área interna (GIA)', k_nia: 'Área útil (NIA)', k_parking: 'Vagas', k_access: 'Acessibilidade',
    k_handed: 'Espelhada', k_parcel: 'Parcela', k_phase: 'Fase', k_sheet: 'Prancha', k_level: 'Andar', k_block: 'Prédio',
    k_units: 'Apartamentos', k_storeys: 'Andares', k_area: 'Área (aprox.)', k_homes: 'Imóveis', k_mix: 'Mix', k_nia_total: 'Área útil total',
    yes: 'Sim', no: 'Não', ground: 'Térreo', level_n: n => n === 0 ? 'Térreo' : `${n}º andar`,
    same_type: (n, ht) => `${n} imóveis com a tipologia ${ht}`,
    see_sheet: 'Ver prancha original', copy_link: 'Copiar link', copied: 'Link copiado', show_same: 'Ver mesma tipologia',
    approx: 'Posição aproximada: este plot está no Plot Schedule mas não tem etiqueta nas plantas; foi colocado entre os vizinhos de numeração.',
    back_block: '← voltar ao prédio',
    occ: (b, p) => `${b} quarto${b > 1 ? 's' : ''} · ${p} pessoa${p > 1 ? 's' : ''}`,
    acc: { 'M4(2)': 'M4(2) — acessível e adaptável', 'M4(3)': 'M4(3) — para cadeirante' },
    tenure: { 'Low-Cost Rent': 'Aluguel social', 'Intermediate': 'Intermediário', 'Private': 'Venda livre' },
    tenure_long: { 'Low-Cost Rent': 'Aluguel social (Low-Cost Rent) — affordable', 'Intermediate': 'Intermediário (shared ownership / London Living Rent) — affordable', 'Private': 'Venda livre (mercado)' },
    type: { 'Detached': 'Isolada', 'Semi-Detached': 'Geminada', 'End Terrace': 'Fileira (ponta)', 'Mid Terrace': 'Fileira (meio)', 'Apartment': 'Apartamento' },
    phase: 'Fase', phase_n: n => `Fase ${n}`, outline: 'outline', detailed: 'detalhada',
    phases_intro: (h, a, b) => `O plano prevê até <b>${h.toLocaleString('pt-BR')} casas</b> em 4 fases, com obras de ${a} a ${b}. Só a Fase 1 tem projeto detalhado (casa a casa); as Fases 2–4 são <i>outline</i> e terão desenho próprio em pedidos futuros.`,
    programme: 'Cronograma indicativo', enabling: 'Preparação', area_ha: a => `${a.toLocaleString('pt-BR')} ha`,
    homes_n: n => `${n} imóveis`, homes_tbd: 'nº de casas a definir', zoom_phase: 'Ver no mapa', under_constr: 'em obra (ano de avaliação)',
    phase1_breakdown: 'Fase 1 por parcela', parcel: 'Parcela', tenure_split: 'Tenure da Fase 1', sources: 'Fontes',
    status: 'Status', decision: 'Decisão', committee: 'Comitê', sched: 'Decisão agendada', consult_end: 'Fim da consulta',
    earliest: 'Decisão a partir de', officer: 'Técnica responsável', comments_open: 'Comentários abertos', last_fetch: 'Última verificação',
    pending: 'Pendente', not_set: 'Não marcado', status_valid: 'Em análise', open: 'Sim', closed: 'Não',
    when_decided: 'Quando vai ser decidido?', next_meetings: 'Próximas reuniões do Development Control Committee',
    agenda_none: 'pauta ainda não publicada', agenda_pub: 'pauta publicada — sem este pedido', agenda_hit: 'NA PAUTA',
    log: 'Últimas atualizações (a cada fetch)', log_empty: 'Ainda não há verificações registradas.',
    new_docs: n => `${n} documento${n === 1 ? '' : 's'} novo${n === 1 ? '' : 's'}`, analyst: 'Análise',
    timeline: 'Linha do tempo do pedido', docs_published: n => `${n} documento${n === 1 ? '' : 's'} publicado${n === 1 ? '' : 's'}`,
    today: 'Hoje', decision_tbd: 'Decisão — data ainda não definida', received: 'Pedido recebido', validated: 'Pedido validado',
    consult_deadline: 'Fim do prazo formal de consulta', fei: 'Informação ambiental adicional (FEI)',
    comments: 'Comentários públicos', object: 'Contra', support: 'A favor', other: 'Outros',
    comments_total: (n, o, s) => `<b>${n.toLocaleString('pt-BR')}</b> comentários: <b>${o.toLocaleString('pt-BR')}</b> contra, <b>${s.toLocaleString('pt-BR')}</b> a favor.`,
    documents: 'Documentos do pedido', all_cats: 'Todas as categorias', show_more: 'Mostrar mais', all_docs_register: 'Todos os documentos no registro',
    docs_count: (n, t) => `${n} de ${t} documentos`, open_register: 'Abrir no registro do Council',
    status_chip: { valid: 'Em análise · sem data de comitê', agenda: d => `Na pauta do comitê · ${d}`, committee: d => `Comitê em ${d}`, decided: d => `Decidido: ${d}` },
    all_beds: 'Quartos', all_tenure: 'Tenure', all_types: 'Tipo', all_phases: 'Fase', list_count: (n, t) => `${n} de ${t} imóveis`,
    about: (d) => `Dados: Phase 1 Plot Schedule Rev P2 e Apartments Schedule (out/2026). Posições georreferenciadas a partir das plantas oficiais (precisão ≈1–2 m). Registro do Council verificado em ${d}.`,
    sheet_gfp: n => `Ground Floor Plan ${n} de 12`, sheet_1a: 'Site Plan 1A', sheet_1b: 'Site Plan 1B', sheet_mp: 'Parcel Plan', sheet_ph: 'Phasing',
    new_badge: 'novo',
  },
  en: {
    loading: 'Loading map…', subtitle: 'Bromley · Berkeley Homes · application',
    tab_explore: 'Explore', tab_phases: 'Phases', tab_updates: 'Updates', tab_list: 'List', tab_prices: 'Prices',
    search_ph: 'Search a plot, e.g. R-S12_034 or Block E', filter_ph: 'Filter by plot or house type…',
    color_by: 'Colour by', m_beds: 'Bedrooms', m_tenure: 'Tenure', m_type: 'Type', m_price: 'Price',
    ly_sold: 'Recently sold (Land Registry)', ly_listings: 'For sale now (OnTheMarket)', th_value: 'Est.',
    legend_hint: 'Click a category to show/hide it on the map.',
    layers: 'Layers', ly_drawings: 'Phase 1 drawings (plans)', ly_phases: 'Phases 1–4', ly_parcels: 'Phase 1 parcels', ly_homes: 'Houses and blocks',
    sheets: 'Original drawings', sheets_hint: 'Open full-screen with zoom. On the map they are already fitted in place.',
    fit: 'Fit', open_file: 'Open file', lb_hint: 'Scroll/pinch to zoom · drag to pan · ← → switch · Esc closes',
    th_beds: 'Beds', th_type: 'Type', th_area: 'm²', th_phase: 'Phase',
    homes: 'homes', houses: 'houses', apartments: 'apartments', affordable: 'affordable',
    beds_n: n => `${n} bed`, bed_short: n => `${n}b`,
    block: 'Block', blocks: 'blocks',
    map: 'Map', satellite: 'Satellite',
    hint: 'Click a house or block for its details, elevation and floor plan',
    elevation: 'Elevations', floorplans: 'Floor plans', floorplans_lvl: 'Floor plans by level', enlarge: '🔍 enlarge',
    k_occ: 'Bedrooms / persons', k_type: 'House type', k_ht: 'Housetype code', k_design: 'Design option',
    k_tenure: 'Tenure', k_gia: 'Internal area (GIA)', k_nia: 'Net internal area (NIA)', k_parking: 'Parking spaces', k_access: 'Accessibility',
    k_handed: 'Handed', k_parcel: 'Parcel', k_phase: 'Phase', k_sheet: 'Drawing', k_level: 'Floor', k_block: 'Block',
    k_units: 'Apartments', k_storeys: 'Storeys', k_area: 'Area (approx.)', k_homes: 'Homes', k_mix: 'Mix', k_nia_total: 'Total NIA',
    yes: 'Yes', no: 'No', ground: 'Ground', level_n: n => n === 0 ? 'Ground floor' : `Level ${n}`,
    same_type: (n, ht) => `${n} homes share housetype ${ht}`,
    see_sheet: 'Open original drawing', copy_link: 'Copy link', copied: 'Link copied', show_same: 'Show same housetype',
    approx: 'Approximate position: this plot is in the Plot Schedule but is not labelled on the drawings; it was placed between its numbered neighbours.',
    back_block: '← back to block',
    occ: (b, p) => `${b} bed · ${p} person`,
    acc: { 'M4(2)': 'M4(2) — accessible & adaptable', 'M4(3)': 'M4(3) — wheelchair user' },
    tenure: { 'Low-Cost Rent': 'Low-Cost Rent', 'Intermediate': 'Intermediate', 'Private': 'Private sale' },
    tenure_long: { 'Low-Cost Rent': 'Low-Cost Rent — affordable', 'Intermediate': 'Intermediate (shared ownership / London Living Rent) — affordable', 'Private': 'Private (market sale)' },
    type: { 'Detached': 'Detached', 'Semi-Detached': 'Semi-detached', 'End Terrace': 'End terrace', 'Mid Terrace': 'Mid terrace', 'Apartment': 'Apartment' },
    phase: 'Phase', phase_n: n => `Phase ${n}`, outline: 'outline', detailed: 'detailed',
    phases_intro: (h, a, b) => `The plan allows up to <b>${h.toLocaleString('en-GB')} homes</b> in 4 phases, built from ${a} to ${b}. Only Phase 1 is designed in detail (house by house); Phases 2–4 are <i>outline</i> and will be designed in future applications.`,
    programme: 'Indicative programme', enabling: 'Enabling', area_ha: a => `${a.toLocaleString('en-GB')} ha`,
    homes_n: n => `${n} homes`, homes_tbd: 'number of homes to be set', zoom_phase: 'Show on map', under_constr: 'under construction (assessment year)',
    phase1_breakdown: 'Phase 1 by parcel', parcel: 'Parcel', tenure_split: 'Phase 1 tenure', sources: 'Sources',
    status: 'Status', decision: 'Decision', committee: 'Committee', sched: 'Scheduled decision', consult_end: 'Consultation deadline',
    earliest: 'Earliest decision', officer: 'Case officer', comments_open: 'Open for comments', last_fetch: 'Last checked',
    pending: 'Pending', not_set: 'Not set', status_valid: 'Under consideration', open: 'Yes', closed: 'No',
    when_decided: 'When will it be decided?', next_meetings: 'Next Development Control Committee meetings',
    agenda_none: 'agenda not yet published', agenda_pub: 'agenda published — not listed', agenda_hit: 'ON THE AGENDA',
    log: 'Latest updates (one per fetch)', log_empty: 'No checks logged yet.',
    new_docs: n => `${n} new document${n === 1 ? '' : 's'}`, analyst: 'Analysis',
    timeline: 'Application timeline', docs_published: n => `${n} document${n === 1 ? '' : 's'} published`,
    today: 'Today', decision_tbd: 'Decision — date not yet set', received: 'Application received', validated: 'Application validated',
    consult_deadline: 'Formal consultation deadline', fei: 'Further Environmental Information (FEI)',
    comments: 'Public comments', object: 'Object', support: 'Support', other: 'Other',
    comments_total: (n, o, s) => `<b>${n.toLocaleString('en-GB')}</b> comments: <b>${o.toLocaleString('en-GB')}</b> objecting, <b>${s.toLocaleString('en-GB')}</b> supporting.`,
    documents: 'Application documents', all_cats: 'All categories', show_more: 'Show more', all_docs_register: 'All documents on the register',
    docs_count: (n, t) => `${n} of ${t} documents`, open_register: 'Open on the Council register',
    status_chip: { valid: 'Under consideration · no committee date', agenda: d => `On committee agenda · ${d}`, committee: d => `Committee on ${d}`, decided: d => `Decided: ${d}` },
    all_beds: 'Bedrooms', all_tenure: 'Tenure', all_types: 'Type', all_phases: 'Phase', list_count: (n, t) => `${n} of ${t} homes`,
    about: (d) => `Data: Phase 1 Plot Schedule Rev P2 and Apartments Schedule (Oct 2026). Positions georeferenced from the official drawings (≈1–2 m accuracy). Council register checked on ${d}.`,
    sheet_gfp: n => `Ground Floor Plan ${n} of 12`, sheet_1a: 'Site Plan 1A', sheet_1b: 'Site Plan 1B', sheet_mp: 'Parcel Plan', sheet_ph: 'Phasing',
    new_badge: 'new',
  },
};
let LANG = store.get('rp-lang', (navigator.language || '').toLowerCase().startsWith('pt') ? 'pt' : 'pt');
const t = (k, ...a) => { const v = STR[LANG][k] ?? STR.pt[k]; return typeof v === 'function' ? v(...a) : (v ?? k); };
const tm = (k, key) => (STR[LANG][k] || {})[key] ?? key;

/* ---------------- palettes ---------------- */
const BED = { 1: '#38bdf8', 2: '#22c55e', 3: '#facc15', 4: '#f97316', 5: '#ef4444' };
const TEN = { 'Low-Cost Rent': '#e11d48', 'Intermediate': '#f59e0b', 'Private': '#3b82f6' };
const TYP = { 'Detached': '#7c3aed', 'Semi-Detached': '#0ea5e9', 'End Terrace': '#10b981', 'Mid Terrace': '#84cc16', 'Apartment': '#475569' };
const PH = { '1': '#4f6bd8', '2': '#f2b84b', '3': '#e57373', '4': '#9c7ad1' };
const AFFORDABLE = ['Low-Cost Rent', 'Intermediate'];

const S = { mode: 'beds', hidden: { beds: new Set(), tenure: new Set(), type: new Set(), price: new Set() }, sel: null };
let D, map, layers = {}, markers = new Map(), selRing, sun = null;
// price estimates live in assets/prices.js (window.Prices); every call goes through PX so that a missing
// module, data that has not arrived yet or an error in it never breaks the rest of the app
const PX = (fn, ...a) => { try { const P = window.Prices; return P && typeof P[fn] === 'function' ? P[fn](...a) : undefined; } catch (e) { console.error(e); return undefined; } };

/* ---------------- helpers ---------------- */
const fmtDate = (iso, opts) => {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString(LANG === 'pt' ? 'pt-BR' : 'en-GB', opts || { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtDateLong = iso => fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateTime = iso => new Date(iso).toLocaleString(LANG === 'pt' ? 'pt-BR' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const nf = n => (n ?? 0).toLocaleString(LANG === 'pt' ? 'pt-BR' : 'en-GB');
const imgKey = k => k ? k.replace(':', '-') : null;
const elevSrc = k => k ? `assets/units/elev/${imgKey(k)}.jpg` : null;
const planSrc = k => k ? `assets/units/plan/${imgKey(k)}.jpg` : null;
const planHD = k => k ? `assets/units/plan-hd/${imgKey(k)}.jpg` : null;
const docUrl = id => `https://planningaccess.bromley.gov.uk/sfc/servlet.shepherd/version/download/${id}`;
const occParts = o => { const m = /^(\d+)B(\d+)P$/.exec(o || ''); return m ? [+m[1], +m[2]] : null; };
const occLabel = o => { const p = occParts(o); return p ? t('occ', p[0], p[1]) : (o || '—'); };
const pill = (txt, color, ghost) => ghost ? `<span class="pill ghost">${txt}</span>`
  : `<span class="pill" style="background:${color}22;color:${shade(color)}"><span class="swatch" style="background:${color}"></span>${txt}</span>`;
function shade(hex) { // darker text tone for a pastel pill
  const n = parseInt(hex.slice(1), 16), f = .62;
  return `rgb(${Math.round((n >> 16) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}
const area = h => h.kind === 'apartment' ? h.nia : h.gia;
const sheetName = id => id?.startsWith('gfp') ? t('sheet_gfp', id.slice(3)) : ({ site1A: t('sheet_1a'), site1B: t('sheet_1b'), masterplan: t('sheet_mp'), phasing: t('sheet_ph') }[id] || id);
function catOf(h, mode) {
  if (mode === 'beds') return String(h.beds);
  if (mode === 'tenure') return h.tenure;
  if (mode === 'price') return PX('catOf', h) ?? '?';
  return h.plot_type;
}
function colorOf(h, mode = S.mode) {
  if (mode === 'beds') return BED[h.beds] || '#94a3b8';
  if (mode === 'tenure') return TEN[h.tenure] || '#94a3b8';
  if (mode === 'price') return PX('colorOf', h) || '#94a3b8';
  return TYP[h.plot_type] || '#94a3b8';
}
function blockColor(b) {
  if (S.mode === 'tenure') return TEN[b.tenure] || '#475569';
  if (S.mode === 'price') return PX('blockColor', b) || '#334155';
  return '#334155';
}
const visible = h => !S.hidden[S.mode].has(catOf(h, S.mode));

/* ---------------- load ---------------- */
async function load() {
  const get = u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
  const [homes, geo, planning, updates, project, tiles] = await Promise.all([
    get('data/homes.json'), get('data/geo.json'), get('data/planning.json'), get('data/updates.json'),
    get('data/project.json'), get('tiles/meta.json'),
  ]);
  D = { homes: homes.homes, blocks: homes.blocks, counts: homes.counts, geo, planning, updates, project, tiles };
  D.byId = new Map(D.homes.map(h => [h.id, h]));
  D.blockById = new Map(D.blocks.map(b => [b.id, b]));
  D.houses = D.homes.filter(h => h.kind === 'house');
}

/* ---------------- map ---------------- */
function initMap() {
  map = L.map('map', { preferCanvas: true, zoomControl: false, minZoom: 12, maxZoom: 21, zoomSnap: .5 });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  layers.base = {
    map: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 21, maxNativeZoom: 19, className: 'osm-tiles',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 21, maxNativeZoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community',
    }),
  };
  layers.base.map.addTo(map);
  map.attributionControl.addAttribution('Drawings: JTP / Berkeley Homes via LB Bromley register');

  // drawings sit between the base map and the vector overlay; phases, parcels and home markers share
  // the overlay pane's single canvas so its hit-testing picks the topmost (house over phase area)
  map.createPane('drawings'); map.getPane('drawings').style.zIndex = 250;

  // phases 1-4 (from the Illustrative Phasing Strategy)
  layers.phases = L.geoJSON(D.geo.phases, {
    style: f => ({ color: PH[f.properties.phase.slice(-1)], weight: 2, fillOpacity: .18, opacity: .9 }),
    onEachFeature: (f, l) => {
      const id = f.properties.phase.slice(-1);
      l.on('click', e => { L.DomEvent.stopPropagation(e); showPhase(id); });
      l.bindTooltip(() => t('phase_n', id), { className: 'home-tip', sticky: true });
      l.on('mouseover', () => l.setStyle({ fillOpacity: .3 }));
      l.on('mouseout', () => l.setStyle({ fillOpacity: map.getZoom() >= 16 ? .06 : .18 }));
    },
  }).addTo(map);
  layers.phaseLabels = L.layerGroup().addTo(map);

  // Phase 1 parcels (Development Parcel Plan)
  layers.parcels = L.geoJSON(D.geo.parcels, {
    interactive: false,
    style: f => ({ color: f.properties.phase === '1B' ? '#be185d' : '#1d4ed8', weight: 1.4, dashArray: '5 4', fill: false, opacity: .8 }),
  }).addTo(map);
  layers.parcelLabels = L.layerGroup();

  // drawing tiles (only those that exist)
  const idx = {};
  Object.entries(D.tiles.index).forEach(([z, list]) => { idx[z] = new Set(list); });
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const DrawLayer = L.TileLayer.extend({
    getTileUrl(c) { const k = `${c.x}/${c.y}`; return idx[c.z] && idx[c.z].has(k) ? `tiles/${c.z}/${k}.webp` : BLANK; },
  });
  layers.drawings = new DrawLayer('', { pane: 'drawings', minZoom: 15, maxZoom: 21, minNativeZoom: 15, maxNativeZoom: D.tiles.max_native_zoom, opacity: .85, bounds: L.latLngBounds(D.tiles.areas.flat()).pad(.05) }).addTo(map);

  // homes
  layers.homes = L.layerGroup().addTo(map);
  buildMarkers();
  selRing = L.circleMarker([0, 0], { radius: 12, color: '#0f172a', weight: 3, fill: false, interactive: false });

  // basemap switcher
  const Ctl = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'map-ctl');
      el.innerHTML = `<div class="seg" id="base-seg"><button data-b="map" class="active">${t('map')}</button><button data-b="sat">${t('satellite')}</button></div>`;
      L.DomEvent.disableClickPropagation(el);
      el.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        Object.values(layers.base).forEach(l => map.removeLayer(l));
        layers.base[b.dataset.b].addTo(map).bringToBack();
        $$('#base-seg button').forEach(x => x.classList.toggle('active', x === b));
        store.set('rp-base', b.dataset.b);
      });
      return el;
    },
  });
  new Ctl({ position: 'topright' }).addTo(map);
  if (store.get('rp-base', 'map') === 'sat') setTimeout(() => $('#base-seg [data-b="sat"]')?.click(), 0);

  const phase1 = L.latLngBounds(D.homes.filter(h => h.lat).map(h => [h.lat, h.lon]));
  D.phase1Bounds = phase1;
  D.allBounds = layers.phases.getBounds();
  map.fitBounds(phase1.pad(.08));
  map.on('zoomend', onZoom);
  map.on('click', () => closeDetail());
  onZoom();
}

function markerRadius() {
  const z = map.getZoom();
  return z < 15 ? 2.5 : z < 16 ? 3.5 : z < 17 ? 4.5 : z < 18 ? 6 : z < 19 ? 7.5 : 9;
}
function buildMarkers() {
  layers.homes.clearLayers(); markers.clear();
  const r = map ? markerRadius() : 4;
  for (const h of D.houses) {
    if (!h.lat || !visible(h)) continue;
    const m = L.circleMarker([h.lat, h.lon], {
      radius: r, weight: h.approx ? 1.5 : 1.2, color: h.approx ? '#0f172a' : '#ffffff', dashArray: h.approx ? '2 2' : null,
      fillColor: colorOf(h), fillOpacity: .95,
    });
    m.bindTooltip(() => `<b>${esc(h.id)}</b> · ${t('bed_short', h.beds)} · ${esc(tm('type', h.plot_type))}${PX('tip', h) || ''}`, { className: 'home-tip', direction: 'top', offset: [0, -6] });
    m.on('click', e => { L.DomEvent.stopPropagation(e); select('h', h.id); });
    m.addTo(layers.homes); markers.set(h.id, m);
  }
  for (const b of D.blocks) {
    const units = b.units.map(u => D.byId.get(u));
    if (!units.some(visible)) continue;
    const m = L.marker([b.lat, b.lon], { icon: blockIcon(b), riseOnHover: true });
    m.bindTooltip(() => `<b>${esc(b.name)}</b> · ${b.count} ${t('apartments')}`, { className: 'home-tip', direction: 'top', offset: [0, -10] });
    m.on('click', e => { L.DomEvent.stopPropagation(e); select('b', b.id); });
    m.addTo(layers.homes); markers.set(b.id, m);
  }
}
function blockIcon(b) {
  const z = map ? map.getZoom() : 16, s = z < 16 ? 16 : z < 18 ? 22 : 28;
  const sel = S.sel && S.sel.id === b.id ? ' sel' : '';
  return L.divIcon({ className: '', iconSize: [s, s], html: `<div class="blk-icon${sel}" style="background:${blockColor(b)};font-size:${s < 20 ? 9 : 11}px">${esc(b.id.split(':')[1])}</div>` });
}
function onZoom() {
  const z = map.getZoom(), r = markerRadius();
  markers.forEach((m, id) => { if (m.setRadius) m.setRadius(r); else m.setIcon(blockIcon(D.blockById.get(id))); });
  if (S.sel && S.sel.type === 'h') selRing.setRadius(r + 4);
  layers.phases.setStyle(f => ({ fillOpacity: z >= 16 ? .06 : .18 }));
  // phase labels at low zoom, parcel labels at mid zoom
  layers.phaseLabels.clearLayers();
  if (z < 16) {
    layers.phases.eachLayer(l => {
      const id = l.feature.properties.phase.slice(-1);
      (l.feature.geometry.type === 'MultiPolygon' ? l.feature.geometry.coordinates : [l.feature.geometry.coordinates]).forEach(poly => {
        const c = L.polygon(poly.map(r => r.map(([x, y]) => [y, x]))).getBounds().getCenter();
        L.tooltip({ permanent: true, direction: 'center', className: 'phase-label', interactive: false }).setLatLng(c).setContent(t('phase_n', id)).addTo(layers.phaseLabels);
      });
    });
  }
  if (z >= 15.5 && z < 18.5 && $('#ly-parcels').checked) {
    if (!map.hasLayer(layers.parcelLabels)) {
      layers.parcelLabels.clearLayers();
      layers.parcels.eachLayer(l => {
        const p = l.feature.properties;
        L.tooltip({ permanent: true, direction: 'center', className: 'phase-label', interactive: false })
          .setLatLng(l.getBounds().getCenter()).setContent(`<span style="font-size:11px;color:#1e3a8a">${esc(p.parcel)}</span>`).addTo(layers.parcelLabels);
      });
      layers.parcelLabels.addTo(map);
    }
  } else map.removeLayer(layers.parcelLabels);
  $('#opacity-row').classList.toggle('hidden', !$('#ly-drawings').checked);
}

/* ---------------- selection / detail ---------------- */
// phone: the detail sheet covers the lower part of the map, so keep the home in the strip above it
function focusOn(lat, lon, zoom, fly) {
  const phone = matchMedia('(max-width: 900px)').matches;
  // the half-open card's height (from its CSS, never a mid-animation reading); a card the user made full stays full
  const cover = phone ? (window.Sheets?.detailHalf() ?? $('#detail').offsetHeight) : 0;
  if (fly) {
    const z = Math.max(map.getZoom(), zoom);
    map.flyTo(map.unproject(map.project([lat, lon], z).add([0, cover / 2]), z), z, { duration: .6 });
  } else if (phone) {
    const H = map.getSize().y, y = map.latLngToContainerPoint([lat, lon]).y, mid = (H - cover) / 2;
    if (y > H - cover - 30 || y < 30) map.panBy([0, y - mid]);
  }
}
function select(type, id, opts = {}) {
  const prev = S.sel;
  S.sel = { type, id, unit: opts.unit };
  PX('clear');
  if (prev && prev.type === 'b') { const m = markers.get(prev.id); m && m.setIcon(blockIcon(D.blockById.get(prev.id))); }
  map.removeLayer(selRing);
  if (type === 'h') {
    const h = D.byId.get(id);
    if (h.kind === 'apartment') return select('b', 'blk:' + h.block, { unit: id, fly: opts.fly });
    selRing.setLatLng([h.lat, h.lon]).setRadius(markerRadius() + 4);
    if (map.hasLayer(layers.homes)) selRing.addTo(map);
    focusOn(h.lat, h.lon, 18.5, opts.fly);
    showHouse(h);
    sun?.setFocus({ lat: h.lat, lon: h.lon, heightM: 9, label: h.id });
  } else if (type === 'b') {
    const b = D.blockById.get(id);
    const m = markers.get(id); m && m.setIcon(blockIcon(b));
    focusOn(b.lat, b.lon, 18, opts.fly);
    showBlock(b, opts.unit);
    sun?.setFocus({ lat: b.lat, lon: b.lon, heightM: (b.storeys || 3) * 3 + 3, label: b.name });
  }
  setHash(type === 'b' && opts.unit ? `h=${opts.unit}` : `${type}=${id}`);
}
function openDetail(title, subHTML, bodyHTML) {
  $('#d-title').textContent = title;
  $('#d-sub').innerHTML = subHTML;
  $('#d-body').innerHTML = bodyHTML;
  $('#d-body').scrollTop = 0;
  $('#detail').classList.add('open');
  if (matchMedia('(max-width: 900px)').matches) $('#sidebar').classList.add('collapsed');
  wireFigures();
}
function closeDetail() {
  $('#detail').classList.remove('open');
  PX('clear');
  if (S.sel && S.sel.type === 'b') { const id = S.sel.id; S.sel = null; const m = markers.get(id); m && m.setIcon(blockIcon(D.blockById.get(id))); }
  S.sel = null; map && map.removeLayer(selRing);
  sun?.setFocus(null);
  setHash('');
}
function refreshDetail() {
  if (!S.sel || !$('#detail').classList.contains('open')) return;
  const y = $('#d-body').scrollTop;
  if (S.sel.type === 'h') showHouse(D.byId.get(S.sel.id));
  else if (S.sel.type === 'b') showBlock(D.blockById.get(S.sel.id), S.sel.unit);
  $('#d-body').scrollTop = y;
}
const fig = (src, label, full) => src ? `<div class="fig" data-src="${full || src}" data-label="${esc(label)}"><img loading="lazy" src="${src}" alt="${esc(label)}"><span class="tag">${esc(label)}</span><span class="zoom">${t('enlarge')}</span></div>` : '';
function kvRows(rows) { return `<table class="kv">${rows.filter(r => r[1] !== null && r[1] !== undefined && r[1] !== '').map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`; }
function wireFigures() {
  const figs = $$('#d-body .fig');
  const items = figs.map(f => ({ src: f.dataset.src, label: f.dataset.label }));
  const extra = $('#d-body [data-sheet]');
  figs.forEach((f, i) => f.addEventListener('click', () => openLightbox(items, i, $('#d-title').textContent)));
  if (extra) extra.addEventListener('click', () => openSheet(extra.dataset.sheet));
  const cp = $('#d-body [data-copy]');
  if (cp) cp.addEventListener('click', () => { navigator.clipboard?.writeText(location.href).then(() => { cp.textContent = t('copied'); }); });
  $$('#d-body [data-unit]').forEach(r => r.addEventListener('click', () => select('h', r.dataset.unit)));
  $$('#d-body [data-back]').forEach(r => r.addEventListener('click', () => select('b', r.dataset.back)));
  $$('#d-body [data-same]').forEach(r => r.addEventListener('click', () => { switchTab('list'); $('#f-q').value = r.dataset.same; renderList(); }));
  $$('#d-body [data-zoom-phase]').forEach(r => r.addEventListener('click', () => zoomPhase(r.dataset.zoomPhase)));
  PX('wire', $('#d-body'));
}
function tenurePill(tn) { return tn ? pill(esc(tm('tenure', tn)), TEN[tn] || '#94a3b8') : ''; }
function showHouse(h) {
  const same = D.homes.filter(x => x.housetype === h.housetype).length;
  const body = `
    ${PX('houseCard', h) || ''}
    <div class="figs">${fig(elevSrc(h.img), t('elevation'))}${fig(planSrc(h.img), t('floorplans'), planHD(h.img))}</div>
    ${h.approx ? `<div class="note warn">${t('approx')}</div>` : ''}
    ${kvRows([
      [t('k_occ'), occLabel(h.occupancy)],
      [t('k_type'), esc(tm('type', h.plot_type))],
      [t('k_ht'), esc(h.housetype)],
      [t('k_design'), esc((h.design_option || '').replace('Design Option ', ''))],
      [t('k_tenure'), esc(tm('tenure_long', h.tenure))],
      [t('k_gia'), h.gia ? `${h.gia} m² <span class="muted">(${nf(Math.round(h.gia * 10.7639))} sq ft)</span>` : null],
      [t('k_parking'), h.parking],
      [t('k_access'), esc(tm('acc', h.accessibility))],
      [t('k_handed'), h.handed ? (h.handed === 'Yes' ? t('yes') : t('no')) : null],
      [t('k_parcel'), esc(h.parcel)],
      [t('k_phase'), `${t('phase_n', h.phase)}`],
      [t('k_sheet'), h.sheet ? esc(sheetName(h.sheet)) : null],
    ])}
    <div class="note">${t('same_type', same, esc(h.housetype))} · <a href="#" data-same="${esc(h.housetype)}" onclick="return false">${t('show_same')}</a></div>
    <div class="btn-row">
      ${h.sheet ? `<button class="btn" data-sheet="${h.sheet}">${t('see_sheet')}</button>` : ''}
      <button class="btn" data-copy>${t('copy_link')}</button>
    </div>`;
  const sub = [pill(t('beds_n', h.beds), BED[h.beds]), tenurePill(h.tenure), pill(t('phase_n', h.phase), PH['1'])].join('');
  openDetail(h.id, sub, body);
}
function showBlock(b, unitId) {
  const units = b.units.map(u => D.byId.get(u));
  if (unitId) {
    const u = D.byId.get(unitId);
    const body = `
      <p style="margin:0 0 10px"><a href="#" data-back="${b.id}" onclick="return false">${t('back_block')}</a></p>
      ${PX('houseCard', u) || ''}
      <div class="figs">${fig(planSrc(b.img), t('floorplans_lvl'), planHD(b.img))}${fig(elevSrc(b.img), t('elevation'))}</div>
      ${kvRows([
        [t('k_block'), esc(b.name)], [t('k_level'), u.level != null ? t('level_n', u.level) : null],
        [t('k_occ'), occLabel(u.occupancy)], [t('k_nia'), u.nia ? `${u.nia} m² <span class="muted">(${nf(Math.round(u.nia * 10.7639))} sq ft)</span>` : null],
        [t('k_tenure'), esc(tm('tenure_long', u.tenure))], [t('k_parking'), u.parking], [t('k_access'), esc(tm('acc', u.accessibility))],
        [t('k_parcel'), esc(u.parcel)], [t('k_phase'), t('phase_n', u.phase)],
      ])}
      <div class="btn-row"><button class="btn" data-sheet="${b.sheet}">${t('see_sheet')}</button><button class="btn" data-copy>${t('copy_link')}</button></div>`;
    openDetail(u.id, [pill(t('beds_n', u.beds), BED[u.beds]), tenurePill(u.tenure), pill(esc(b.name), '#475569')].join(''), body);
    return;
  }
  const byLevel = {};
  units.forEach(u => (byLevel[u.level ?? '?'] ||= []).push(u));
  const est = PX('unitCell', units[0]) !== undefined;   // the estimate column once prices are loaded
  const rows = Object.keys(byLevel).sort((a, c) => a - c).map(l => `<tr class="lvl"><td colspan="${est ? 5 : 4}">${l === '?' ? '—' : t('level_n', +l)}</td></tr>` +
    byLevel[l].map(u => `<tr data-unit="${esc(u.id)}" style="cursor:pointer"><td>${esc(u.id.split('_').pop())}</td><td>${esc(u.occupancy)}</td><td>${tenurePill(u.tenure)}</td><td>${u.nia ? u.nia + ' m²' : '—'}</td>${est ? `<td class="num">${PX('unitCell', u)}</td>` : ''}</tr>`).join('')).join('');
  const mix = Object.entries(b.bed_mix).map(([k, v]) => `${v}× ${t('bed_short', k)}`).join(' · ');
  const body = `
    ${PX('blockCard', b, units) || ''}
    <div class="figs">${fig(elevSrc(b.img), t('elevation'))}${fig(planSrc(b.img), t('floorplans_lvl'), planHD(b.img))}</div>
    ${kvRows([
      [t('k_units'), b.count], [t('k_storeys'), b.storeys], [t('k_mix'), mix],
      [t('k_nia_total'), b.nia_total ? `${nf(b.nia_total)} m²` : null], [t('k_tenure'), esc(tm('tenure_long', b.tenure))],
      [t('k_parcel'), esc(b.parcel)], [t('k_phase'), t('phase_n', b.phase)],
    ])}
    <table class="unit-table"><thead><tr><th>Nº</th><th>${t('m_type')}</th><th>Tenure</th><th>NIA</th>${est ? `<th class="num">${t('th_value')}</th>` : ''}</tr></thead><tbody>${rows}</tbody></table>
    <div class="btn-row"><button class="btn" data-sheet="${b.sheet}">${t('see_sheet')}</button><button class="btn" data-copy>${t('copy_link')}</button></div>`;
  openDetail(b.name, [pill(`${b.count} ${t('apartments')}`, '#475569'), tenurePill(b.tenure), pill(t('phase_n', b.phase), PH['1'])].join(''), body);
}
function zoomPhase(id) {
  const ls = []; layers.phases.eachLayer(l => { if (l.feature.properties.phase.slice(-1) === id) ls.push(l); });
  if (ls.length) map.flyToBounds(L.featureGroup(ls).getBounds().pad(.1), { duration: .7 });
}
function phaseStats(id) {
  const f = D.geo.phases.features.find(x => x.properties.phase.slice(-1) === id);
  return { area: f ? f.properties.area_ha : null };
}
function showPhase(id) {
  const p = D.project.phases.find(x => x.id === id);
  sun?.setFocus(null);
  const st = phaseStats(id);
  const homes = id === '1' ? D.homes.length : null;
  const yrs = p.construction;
  const body = `
    <p style="margin:0">${esc(LANG === 'pt' ? p.desc_pt : p.desc_en)}</p>
    ${kvRows([
      [t('k_phase'), `${t('phase_n', id)} · ${p.type === 'detailed' ? t('detailed') : t('outline')}`],
      [t('k_area'), st.area ? t('area_ha', st.area) : null],
      [t('k_homes'), homes ? `${homes} (${t('houses')} ${D.counts.houses}, ${t('apartments')} ${D.counts.apartments})` : t('homes_tbd')],
      [t('under_constr'), yrs.join(' · ')],
    ])}
    ${id === '1' ? phase1Breakdown() : ''}
    <p class="small muted" style="margin-top:12px">${esc(LANG === 'pt' ? D.project.programme_note_pt : D.project.programme_note_en)}</p>
    <div class="btn-row"><button class="btn primary" data-zoom-phase="${id}">${t('zoom_phase')}</button></div>`;
  openDetail(LANG === 'pt' ? p.title_pt : p.title_en, pill(p.type === 'detailed' ? t('detailed') : t('outline'), p.color), body);
  setHash(`p=${id}`);
}
function phase1Breakdown() {
  const by = {};
  D.homes.forEach(h => { (by[h.parcel] ||= { n: 0, ph: h.phase, beds: {} }).n++; by[h.parcel].beds[h.beds] = (by[h.parcel].beds[h.beds] || 0) + 1; });
  const rows = Object.entries(by).sort((a, b) => a[1].ph.localeCompare(b[1].ph) || a[0].localeCompare(b[0])).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${v.ph}</td><td style="text-align:right">${v.n}</td><td style="width:45%"><div class="mini-bars" style="margin:0">${[1, 2, 3, 4, 5].map(b => v.beds[b] ? `<i style="width:${v.beds[b] / v.n * 100}%;background:${BED[b]}" title="${t('beds_n', b)}: ${v.beds[b]}"></i>` : '').join('')}</div></td></tr>`).join('');
  return `<h4 class="sec-title" style="margin-top:16px">${t('phase1_breakdown')}</h4>
    <table class="unit-table"><thead><tr><th>${t('parcel')}</th><th>${t('phase')}</th><th style="text-align:right">#</th><th>${t('m_beds')}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small muted">${esc(LANG === 'pt' ? D.project.phase_count_note_pt : D.project.phase_count_note_en)}</p>`;
}

/* ---------------- explore tab ---------------- */
function renderStats() {
  const aff = D.homes.filter(h => AFFORDABLE.includes(h.tenure)).length;
  $('#stats').innerHTML = [
    [nf(D.homes.length), t('homes') + ' · ' + t('phase_n', 1)], [nf(D.counts.houses), t('houses')],
    [nf(D.counts.apartments), `${t('apartments')} · ${D.blocks.length} ${t('blocks')}`], [`${nf(aff)} <small style="font-size:12px;color:var(--muted)">${Math.round(aff / D.homes.length * 100)}%</small>`, t('affordable')],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');
}
// legend categories of a colour mode: [{ c (category key), col, label }]
function legendCats(mode) {
  if (mode === 'beds') return ['1', '2', '3', '4', '5'].map(c => ({ c, col: BED[c], label: t('beds_n', +c) }));
  if (mode === 'tenure') return Object.keys(TEN).map(c => ({ c, col: TEN[c], label: tm('tenure_long', c) }));
  if (mode === 'price') return PX('cats') || [];
  return Object.keys(TYP).map(c => ({ c, col: TYP[c], label: tm('type', c) }));
}
function renderLegend() {
  const mode = S.mode, counts = {};
  D.homes.forEach(h => { const c = catOf(h, mode); counts[c] = (counts[c] || 0) + 1; });
  const max = Math.max(...Object.values(counts));
  const note = mode === 'price' ? (PX('legendNote') || '')
    : mode !== 'tenure' ? `<div class="small muted" style="padding:4px 8px"><span class="swatch sq" style="background:#334155"></span> ${t('block')} (A–G2) — ${LANG === 'pt' ? 'apartamentos agrupados por prédio' : 'apartments grouped by block'}</div>` : '';
  $('#legend').innerHTML = legendCats(mode).filter(x => counts[x.c]).map(({ c, col, label }) => {
    return `<button data-cat="${esc(c)}" class="${S.hidden[mode].has(c) ? 'off' : ''}"><span class="swatch ${c === 'Apartment' ? 'sq' : ''}" style="background:${col}"></span><span>${esc(label)}</span><span class="count">${counts[c]}</span></button>
      <div class="bar"><i style="width:${counts[c] / max * 100}%;background:${col}"></i></div>`;
  }).join('') + note;
  $$('#legend button').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.cat, set = S.hidden[S.mode];
    set.has(c) ? set.delete(c) : set.add(c);
    renderLegend(); buildMarkers(); reselect();
  }));
}
function reselect() { map.removeLayer(selRing); if (S.sel && S.sel.type === 'h' && markers.has(S.sel.id) && map.hasLayer(layers.homes)) selRing.addTo(map); }
function renderSheets() {
  const btn = (id, label, cls = '') => `<button class="${cls}" data-open-sheet="${id}" title="${esc(sheetName(id))}">${esc(label)}</button>`;
  $('#sheet-grid').innerHTML = Array.from({ length: 12 }, (_, i) => btn('gfp' + (i + 1), 'GFP ' + (i + 1))).join('') +
    btn('site1A', '1A', '') + btn('site1B', '1B', '') + btn('masterplan', t('sheet_mp'), 'wide') + btn('phasing', t('sheet_ph'), 'wide');
  $$('[data-open-sheet]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.openSheet)));
}
function openSheet(id) {
  const all = ['gfp1', 'gfp2', 'gfp3', 'gfp4', 'gfp5', 'gfp6', 'gfp7', 'gfp8', 'gfp9', 'gfp10', 'gfp11', 'gfp12', 'site1A', 'site1B', 'masterplan', 'phasing'];
  openLightbox(all.map(s => ({ src: `assets/sheets/${s}.jpg`, label: sheetName(s) })), all.indexOf(id), 'Ravensbourne Place');
}

/* search */
function initSearch() {
  const inp = $('#search'), box = $('#suggest');
  let hl = -1, items = [];
  const close = () => { box.classList.add('hidden'); hl = -1; };
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toUpperCase().replace(/\s+/g, '');
    if (q.length < 2) return close();
    items = [...D.blocks.filter(b => b.name.toUpperCase().replace(/\s+/g, '').includes(q)).map(b => ({ type: 'b', id: b.id, label: b.name, sub: `${b.count} ${t('apartments')}` })),
      ...D.homes.filter(h => h.id.toUpperCase().includes(q) || (h.housetype || '').toUpperCase().replace(/\s+/g, '') === q).slice(0, 40)
        .map(h => ({ type: 'h', id: h.id, label: h.id, sub: `${t('bed_short', h.beds)} · ${tm('type', h.plot_type)} · ${tm('tenure', h.tenure)}`, col: colorOf(h) }))].slice(0, 40);
    box.innerHTML = items.length ? items.map((it, i) => `<button data-i="${i}"><span class="swatch ${it.type === 'b' ? 'sq' : ''}" style="background:${it.col || '#334155'}"></span><b>${esc(it.label)}</b><span class="muted small">${esc(it.sub)}</span></button>`).join('')
      : `<div class="muted small" style="padding:10px 12px">—</div>`;
    box.classList.remove('hidden');
  });
  const pick = i => { const it = items[i]; if (!it) return; close(); inp.value = it.label; select(it.type, it.id, { fly: true }); };
  box.addEventListener('mousedown', e => { const b = e.target.closest('button'); if (b) { e.preventDefault(); pick(+b.dataset.i); } });
  inp.addEventListener('keydown', e => {
    if (box.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); hl = Math.max(0, Math.min(items.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1)));
      $$('button', box).forEach((b, i) => b.classList.toggle('hl', i === hl));
    } else if (e.key === 'Enter') { pick(hl < 0 ? 0 : hl); } else if (e.key === 'Escape') close();
  });
  inp.addEventListener('blur', () => setTimeout(close, 120));
}

/* ---------------- phases tab ---------------- */
function renderPhases() {
  const P = D.project, Y0 = 2027, Y1 = 2050, pct = y => (y - Y0) / (Y1 - Y0) * 100;
  const ganttRow = (label, years, color) => {
    const a = Math.min(...years), b = Math.max(...years);
    return `<div class="row"><span class="small" style="font-weight:600">${label}</span><div class="track">
      ${years.length > 1 ? `<div class="seg-bar" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%;background:${color};opacity:.35"></div>` : ''}
      ${years.map(y => `<div class="seg-bar" title="${y}" style="left:calc(${pct(y)}% - 6px);width:12px;background:${color}"></div>`).join('')}</div></div>`;
  };
  const counts = {}; D.homes.forEach(h => { counts[h.tenure] = (counts[h.tenure] || 0) + 1; });
  const ten = Object.keys(TEN).map(k => ({ k, n: counts[k] || 0 }));
  $('#tab-phases').innerHTML = `
    <section><p style="margin:0">${t('phases_intro', P.totals.homes_max, P.totals.start, P.totals.completion)}</p></section>
    <section>
      <h4 class="sec-title">${t('programme')}</h4>
      <div class="card gantt">
        ${ganttRow(t('enabling'), [2028], '#64748b')}
        ${P.phases.map(p => ganttRow(t('phase_n', p.id), p.construction, p.color)).join('')}
        <div class="axis"><span></span><div class="ticks">${[2028, 2035, 2040, 2045, 2049].map(y => `<span style="left:${pct(y)}%">${y}</span>`).join('')}</div></div>
      </div>
      <p class="small muted" style="margin:8px 0 0">${esc(LANG === 'pt' ? P.programme_note_pt : P.programme_note_en)}</p>
    </section>
    <section>
      ${P.phases.map(p => {
        const st = phaseStats(p.id);
        return `<div class="phase-card" data-phase="${p.id}">
          <header><span class="num" style="background:${p.color}">${p.id}</span><div><h3>${esc(LANG === 'pt' ? p.title_pt : p.title_en)}</h3></div></header>
          <p>${esc(LANG === 'pt' ? p.desc_pt : p.desc_en)}</p>
          <div class="meta">${st.area ? `<span class="pill ghost">${t('area_ha', st.area)}</span>` : ''}
            <span class="pill ghost">${p.id === '1' ? t('homes_n', D.homes.length) : t('homes_tbd')}</span>
            <span class="pill ghost">${p.construction[0]}–${p.construction[p.construction.length - 1]}</span></div>
        </div>`;
      }).join('')}
    </section>
    <section>
      <h4 class="sec-title">${t('tenure_split')}</h4>
      <div class="card">
        <div class="mini-bars" style="height:14px;margin:0 0 10px">${ten.map(x => `<i style="width:${x.n / D.homes.length * 100}%;background:${TEN[x.k]}"></i>`).join('')}</div>
        ${ten.map(x => `<div class="toggle-row" style="padding:5px 0"><span><span class="swatch" style="background:${TEN[x.k]}"></span> ${esc(tm('tenure_long', x.k))}</span><b>${x.n}</b></div>`).join('')}
      </div>
    </section>
    <section>
      <h4 class="sec-title">${t('sources')}</h4>
      <ul class="doc-list">${P.sources.filter(s => s.id).map(s => `<li><span class="ext">PDF</span><a href="${docUrl(s.id)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('')}</ul>
    </section>`;
  $$('#tab-phases [data-phase]').forEach(c => c.addEventListener('click', () => { showPhase(c.dataset.phase); zoomPhase(c.dataset.phase); }));
}

/* ---------------- updates tab ---------------- */
function statusInfo() {
  const a = D.planning.application;
  const meetings = (D.planning.committee?.meetings || []);
  const today = new Date().toISOString().slice(0, 10);
  const onAgenda = meetings.find(m => m.mentions_application && m.date >= today);
  if (a.decision) return { cls: 'decided', text: tm('status_chip', 'decided')(a.decision) };
  if (onAgenda) return { cls: '', text: tm('status_chip', 'agenda')(fmtDate(onAgenda.date)) };
  if (a.committee_date) return { cls: '', text: tm('status_chip', 'committee')(fmtDate(a.committee_date)) };
  return { cls: '', text: tm('status_chip', 'valid') };
}
function renderStatusChip() {
  const s = statusInfo();
  const chip = $('#status-chip');
  chip.className = 'status-chip ' + s.cls;
  $('#status-chip-text').innerHTML = `<span class="label-long">${esc(s.text)}</span><span class="label-short" style="display:none"></span>`;
  if (matchMedia('(max-width: 900px)').matches) $('#status-chip-text').textContent = statusInfo().cls === 'decided' ? s.text : (D.planning.application.status === 'Valid' ? t('status_valid') : D.planning.application.status);
  chip.onclick = () => switchTab('updates');
}
function commentsChart() {
  const c = D.planning.comments, months = Object.keys(c.by_month);
  const W = 340, H = 160, pad = 26, top = 14, bw = (W - pad - 6) / months.length * .62;
  const max = Math.max(...months.map(m => Object.values(c.by_month[m]).reduce((a, b) => a + b, 0)));
  const y = v => (H - 20 - top) * v / max;
  const bars = months.map((m, i) => {
    const d = c.by_month[m], x = pad + (i + .5) * (W - pad - 6) / months.length - bw / 2;
    const o = d.Object || 0, s = d.Support || 0, r = Object.values(d).reduce((a, b) => a + b, 0) - o - s;
    let yy = H - 18;
    const seg = (v, col) => { if (!v) return ''; const h = y(v); yy -= h; return `<rect x="${x}" y="${yy}" width="${bw}" height="${h}" fill="${col}" rx="2"><title>${v}</title></rect>`; };
    const lbl = new Date(m + '-15').toLocaleDateString(LANG === 'pt' ? 'pt-BR' : 'en-GB', { month: 'short' });
    return seg(o, '#e11d48') + seg(s, '#16a34a') + seg(r, '#94a3b8') +
      `<text x="${x + bw / 2}" y="${H - 4}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".6">${lbl}</text>` +
      `<text x="${x + bw / 2}" y="${yy - 3}" font-size="9.5" text-anchor="middle" fill="currentColor" opacity=".75">${nf(o + s + r)}</text>`;
  }).join('');
  const gy = f => H - 18 - (H - 20 - top) * f;
  const grid = [0, .5, 1].map(f => `<line x1="${pad}" x2="${W}" y1="${gy(f)}" y2="${gy(f)}" stroke="currentColor" opacity=".1"/>` +
    `<text x="${pad - 4}" y="${gy(f) + 3}" font-size="9" text-anchor="end" fill="currentColor" opacity=".5">${nf(Math.round(max * f))}</text>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('comments')}">${grid}${bars}</svg>
    <div class="legend-inline"><span><span class="swatch sq" style="background:#e11d48"></span> ${t('object')}</span><span><span class="swatch sq" style="background:#16a34a"></span> ${t('support')}</span><span><span class="swatch sq" style="background:#94a3b8"></span> ${t('other')}</span></div></div>`;
}
function docItem(d) {
  return `<li><span class="ext">${esc((d.ext || '').toUpperCase())}</span><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a><span class="date">${fmtDate(d.published)}</span></li>`;
}
function renderUpdates() {
  const pl = D.planning, a = pl.application, P = D.project;
  const today = new Date().toISOString().slice(0, 10);
  const meetings = (pl.committee?.meetings || []).filter(m => m.date >= today);
  const notes = P.decision_notes.map(n => `<li>${esc(n[LANG] || n.pt)}</li>`).join('');
  const s = statusInfo();
  // timeline: key dates + documents grouped by publication date (newest first)
  const byDate = {};
  pl.documents.forEach(d => { (byDate[d.published] ||= []).push(d); });
  const events = Object.entries(byDate).map(([date, docs]) => ({ date, docs }));
  const keyEv = [
    { date: a.received_date, title: t('received'), cls: 'done' },
    { date: a.valid_date, title: t('validated'), cls: 'done' },
    { date: a.consultation_deadline, title: t('consult_deadline'), cls: 'done' },
  ];
  const fei = pl.documents.find(d => /Further Environmental Information/i.test(d.title));
  if (fei) keyEv.push({ date: fei.published, title: t('fei'), cls: 'done', doc: fei });
  const merged = [...events.map(e => ({ ...e, kind: 'docs' })), ...keyEv.filter(k => k.date).map(k => ({ ...k, kind: 'key' }))]
    .sort((x, y) => y.date.localeCompare(x.date) || (x.kind === 'key' ? -1 : 1));
  const shown = merged.slice(0, 26);
  const tl = `<div class="tl-item future"><div class="when">—</div><div class="what">${a.decision ? `${t('decision')}: ${esc(a.decision)}` : t('decision_tbd')}</div></div>
    <div class="tl-item now"><div class="when">${fmtDate(today)}</div><div class="what">${t('today')}</div></div>` +
    shown.map(e => e.kind === 'key'
      ? `<div class="tl-item ${e.cls}"><div class="when">${fmtDate(e.date)}</div><div class="what">${esc(e.title)}</div>${e.doc ? `<ul class="doc-list">${docItem(e.doc)}</ul>` : ''}</div>`
      : `<div class="tl-item"><div class="when">${fmtDate(e.date)}</div><div>${t('docs_published', e.docs.length)}</div>
          <details><summary>${esc(e.docs.slice(0, 2).map(d => d.title).join(' · ').slice(0, 90))}${e.docs.length > 2 ? '…' : ''}</summary><ul class="doc-list">${e.docs.map(docItem).join('')}</ul></details></div>`).join('');
  const log = D.updates.length ? D.updates.map(u => {
    const nd = u.changes?.new_documents || [];
    return `<div class="log-entry">
      <div class="when">${fmtDateTime(u.fetched_at)}</div>
      <p>${esc(LANG === 'pt' ? u.summary_pt : u.summary_en)}</p>
      ${(u.note_pt || u.note_en) ? `<div class="analyst"><b>${t('analyst')}:</b> ${esc(LANG === 'pt' ? (u.note_pt || u.note_en) : (u.note_en || u.note_pt))}</div>` : ''}
      ${nd.length ? `<details style="margin-top:6px"><summary class="small" style="cursor:pointer;color:var(--accent)">${t('new_docs', nd.length)}</summary><ul class="doc-list">${nd.map(docItem).join('')}</ul></details>` : ''}
    </div>`;
  }).join('') : `<p class="muted">${t('log_empty')}</p>`;
  const cats = [...new Set(pl.documents.map(d => d.category))].sort();
  const c = pl.comments, other = c.total - (c.by_stance.Object || 0) - (c.by_stance.Support || 0);
  $('#tab-updates').innerHTML = `
    <section>
      <div class="status-card ${s.cls}">
        <div class="small muted">${esc(a.reference)} · ${esc(a.applicant || '')}</div>
        <div class="big">${a.decision ? esc(a.decision) : esc(a.status === 'Valid' ? t('status_valid') : a.status)}</div>
        <div class="grid">
          <div><span>${t('decision')}</span><b>${a.decision ? `${esc(a.decision)} · ${fmtDate(a.decision_date)}` : t('pending')}</b></div>
          <div><span>${t('committee')}</span><b>${a.committee_date ? fmtDate(a.committee_date) : t('not_set')}</b></div>
          <div><span>${t('sched')}</span><b>${a.scheduled_decision_date ? fmtDate(a.scheduled_decision_date) : t('not_set')}</b></div>
          <div><span>${t('consult_end')}</span><b>${fmtDate(a.consultation_deadline)}</b></div>
          <div><span>${t('earliest')}</span><b>${fmtDate(a.earliest_decision_date)}</b></div>
          <div><span>${t('comments_open')}</span><b>${a.open_for_comments ? t('open') : t('closed')}</b></div>
          <div><span>${t('officer')}</span><b>${esc(a.officer || '—')}</b></div>
          <div><span>${t('last_fetch')}</span><b>${fmtDateTime(pl.fetched_at)}</b></div>
        </div>
        <div class="btn-row"><a class="btn" href="${esc(a.url)}" target="_blank" rel="noopener">${t('open_register')} ↗</a></div>
      </div>
    </section>
    <section>
      <h4 class="sec-title">${t('when_decided')}</h4>
      <div class="card">
        <ul class="reason-list" style="margin-top:0">${notes}</ul>
        <h4 class="sec-title" style="margin-top:14px">${t('next_meetings')}</h4>
        ${meetings.length ? meetings.map(m => {
          const d = new Date(m.date + 'T12:00:00');
          const st = m.mentions_application ? `<span class="pill" style="background:var(--ok-soft);color:var(--ok)">${t('agenda_hit')}</span>` : `<span class="small muted">${m.agenda_published ? t('agenda_pub') : t('agenda_none')}</span>`;
          return `<div class="meeting"><div class="d"><b>${d.getDate()}</b><span>${d.toLocaleDateString(LANG === 'pt' ? 'pt-BR' : 'en-GB', { month: 'short' })}</span></div>
            <div><a href="${esc(m.url)}" target="_blank" rel="noopener">${fmtDateLong(m.date)} · ${esc(m.time || '')}</a><br>${st}</div></div>`;
        }).join('') : `<p class="muted small">—</p>`}
      </div>
    </section>
    <section>
      <h4 class="sec-title">${t('log')}</h4>
      ${log}
    </section>
    <section>
      <h4 class="sec-title">${t('comments')}</h4>
      <div class="card">
        <p style="margin:0 0 8px">${t('comments_total', c.total, c.by_stance.Object || 0, c.by_stance.Support || 0)}${other ? ` <span class="muted">(+${nf(other)} ${t('other').toLowerCase()})</span>` : ''}</p>
        ${commentsChart()}
      </div>
    </section>
    <section>
      <h4 class="sec-title">${t('timeline')}</h4>
      <div class="timeline">${tl}</div>
    </section>
    <section>
      <h4 class="sec-title">${t('documents')}</h4>
      <div class="filter-row"><input id="doc-q" placeholder="${esc(t('filter_ph'))}"><select id="doc-cat"><option value="">${t('all_cats')}</option>${cats.map(x => `<option>${esc(x)}</option>`).join('')}</select></div>
      <div class="small muted" id="doc-count"></div>
      <ul class="doc-list" id="doc-list"></ul>
      <div class="btn-row"><button class="btn" id="doc-more">${t('show_more')}</button>
        <a class="btn" href="${esc(a.files_url || a.url)}" target="_blank" rel="noopener">${t('all_docs_register')} ↗</a></div>
    </section>`;
  let limit = 30;
  const renderDocs = () => {
    const q = $('#doc-q').value.trim().toLowerCase(), cat = $('#doc-cat').value;
    const list = pl.documents.filter(d => (!cat || d.category === cat) && (!q || d.title.toLowerCase().includes(q)));
    $('#doc-count').textContent = t('docs_count', Math.min(limit, list.length), list.length);
    $('#doc-list').innerHTML = list.slice(0, limit).map(docItem).join('');
    $('#doc-more').classList.toggle('hidden', list.length <= limit);
  };
  $('#doc-q').addEventListener('input', () => { limit = 30; renderDocs(); });
  $('#doc-cat').addEventListener('change', () => { limit = 30; renderDocs(); });
  $('#doc-more').addEventListener('click', () => { limit += 50; renderDocs(); });
  renderDocs();
}
function updatesBadge() {
  const latest = D.updates[0]?.fetched_at, seen = store.get('rp-seen-update', '');
  const b = $('#upd-badge');
  b.textContent = t('new_badge');
  b.classList.toggle('hidden', !latest || latest <= seen);
}

/* ---------------- list tab ---------------- */
let sortKey = 'id', sortDir = 1;
function initList() {
  const opt = (sel, label, vals, fmt) => { $(sel).innerHTML = `<option value="">${label}</option>` + vals.map(v => `<option value="${esc(v)}">${esc(fmt ? fmt(v) : v)}</option>`).join(''); };
  opt('#f-beds', t('all_beds'), ['1', '2', '3', '4', '5'], v => t('beds_n', +v));
  opt('#f-tenure', t('all_tenure'), Object.keys(TEN), v => tm('tenure', v));
  opt('#f-type', t('all_types'), Object.keys(TYP), v => tm('type', v));
  opt('#f-phase', t('all_phases'), ['1A', '1B'], v => t('phase_n', v));
  ['#f-q', '#f-beds', '#f-tenure', '#f-type', '#f-phase'].forEach(s => { $(s).oninput = renderList; $(s).onchange = renderList; });
  $$('#list-table th').forEach(th => th.onclick = () => { const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : 1; sortKey = k; renderList(); });
  renderList();
}
function renderList() {
  const q = $('#f-q').value.trim().toUpperCase(), fb = $('#f-beds').value, ft = $('#f-tenure').value, fy = $('#f-type').value, fp = $('#f-phase').value;
  const rows = D.homes.filter(h => (!fb || String(h.beds) === fb) && (!ft || h.tenure === ft) && (!fy || h.plot_type === fy) && (!fp || h.phase === fp) &&
    (!q || h.id.toUpperCase().includes(q) || (h.housetype || '').toUpperCase() === q || (h.housetype || '').toUpperCase().includes(q)));
  const val = h => sortKey === 'area' ? (area(h) || 0) : sortKey === 'value' ? (PX('value', h) || 0) : (h[sortKey] ?? '');
  rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sortDir);
  $('#f-count').textContent = t('list_count', rows.length, D.homes.length);
  $('#list-table tbody').innerHTML = rows.map(h => `<tr data-id="${esc(h.id)}"><td><span class="swatch" style="background:${colorOf(h)}"></span> ${esc(h.id)}</td><td class="num">${PX('short', h) || '—'}</td><td>${h.beds}</td>
    <td>${esc(tm('type', h.plot_type))}</td><td>${esc(tm('tenure', h.tenure))}</td><td>${area(h) || '—'}</td><td>${h.phase}</td></tr>`).join('');
  $$('#list-table tbody tr').forEach(tr => tr.onclick = () => select('h', tr.dataset.id, { fly: true }));
}

/* ---------------- tabs / i18n / theme ---------------- */
function switchTab(name) {
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (!$('#tab-' + name)) return;
  ['explore', 'prices', 'phases', 'updates', 'list'].forEach(n => $('#tab-' + n).classList.toggle('hidden', n !== name));
  if (name === 'prices') PX('renderTab', $('#tab-prices'));
  if (name === 'updates' && D.updates[0]) { store.set('rp-seen-update', D.updates[0].fetched_at); updatesBadge(); }
  const sb = $('#sidebar'); if (sb.classList.contains('collapsed')) sb.classList.remove('collapsed');
}
function applyLang() {
  document.documentElement.lang = LANG === 'pt' ? 'pt-BR' : 'en';
  $$('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  $$('[data-tp]').forEach(el => { el.placeholder = t(el.dataset.tp); });
  $$('#lang-seg button').forEach(b => b.classList.toggle('active', b.dataset.lang === LANG));
  $('#map-hint').textContent = t('hint');
  $$('#base-seg button').forEach(b => { b.textContent = t(b.dataset.b === 'map' ? 'map' : 'satellite'); });
  $('#about-data').textContent = t('about', fmtDate(D.planning.fetched_at));
  renderStats(); renderLegend(); renderSheets(); renderPhases(); renderUpdates(); renderStatusChip(); initList(); updatesBadge();
  map.removeLayer(layers.parcelLabels); onZoom();   // map labels in the new language
  sun?.setLang(LANG);
  PX('onLang');
  if (S.sel) { const s = S.sel; S.sel = null; select(s.type, s.id, { unit: s.unit }); }
}
function initTheme() {
  const saved = store.get('rp-theme', '');
  if (saved) document.documentElement.dataset.theme = saved;
  $('#theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    store.set('rp-theme', document.documentElement.dataset.theme);
  });
}

/* ---------------- hash ---------------- */
let hashLock = false;
function setHash(h) { hashLock = true; history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); setTimeout(() => { hashLock = false; }, 0); }
function readHash() {
  if (hashLock) return;
  const m = /^#(h|b|p|t)=(.+)$/.exec(location.hash);
  if (!m) return;
  const v = decodeURIComponent(m[2]);
  if (m[1] === 'h' && D.byId.has(v)) select('h', v, { fly: true });
  else if (m[1] === 'b' && D.blockById.has(v)) select('b', v, { fly: true });
  else if (m[1] === 'p') { showPhase(v); zoomPhase(v); }
  else if (m[1] === 't') switchTab(v);
}

/* ---------------- lightbox ---------------- */
const LB = { items: [], i: 0, s: 1, x: 0, y: 0, ptrs: new Map(), start: null };
function lbApply() { $('#lb-img').style.transform = `translate(${LB.x}px,${LB.y}px) scale(${LB.s})`; }
function lbFit() {
  const st = $('#lb-stage'), im = $('#lb-img'), sw = st.clientWidth, sh = st.clientHeight, iw = im.naturalWidth || 1, ih = im.naturalHeight || 1;
  LB.s = Math.min(sw / iw, sh / ih) * .96; LB.x = (sw - iw * LB.s) / 2; LB.y = (sh - ih * LB.s) / 2; lbApply();
}
function lbShow() {
  const it = LB.items[LB.i], im = $('#lb-img');
  im.onload = lbFit; im.src = it.src;
  if (im.complete && im.naturalWidth) lbFit();
  $('#lb-cap').textContent = it.label + (LB.items.length > 1 ? ` (${LB.i + 1}/${LB.items.length})` : '');
  $('#lb-open').href = it.src;
  $$('.lb-nav').forEach(b => { b.style.display = LB.items.length > 1 ? 'block' : 'none'; });
}
function openLightbox(items, i, title) {
  LB.items = items.filter(x => x.src); if (!LB.items.length) return;
  LB.i = Math.max(0, Math.min(i, LB.items.length - 1));
  $('#lb-title').textContent = title || '';
  $('#lightbox').classList.add('open'); lbShow();
}
function lbZoom(f, cx, cy) {
  const st = $('#lb-stage').getBoundingClientRect();
  cx = cx ?? st.width / 2; cy = cy ?? st.height / 2;
  const ns = Math.max(.03, Math.min(LB.s * f, 16));
  LB.x = cx - (cx - LB.x) * (ns / LB.s); LB.y = cy - (cy - LB.y) * (ns / LB.s); LB.s = ns; lbApply();
}
function initLightbox() {
  const st = $('#lb-stage');
  const close = () => $('#lightbox').classList.remove('open');
  $('#lb-close').onclick = close;
  $('#lb-fit').onclick = lbFit;
  $('#lb-in').onclick = () => lbZoom(1.3);
  $('#lb-out').onclick = () => lbZoom(1 / 1.3);
  $('#lb-prev').onclick = () => { LB.i = (LB.i - 1 + LB.items.length) % LB.items.length; lbShow(); };
  $('#lb-next').onclick = () => { LB.i = (LB.i + 1) % LB.items.length; lbShow(); };
  st.addEventListener('wheel', e => { e.preventDefault(); const r = st.getBoundingClientRect(); lbZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  st.addEventListener('pointerdown', e => {
    if (e.target.closest('.lb-nav')) return;
    st.setPointerCapture(e.pointerId); LB.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    LB.start = { x: LB.x, y: LB.y, s: LB.s, ptrs: new Map(LB.ptrs) }; st.classList.add('drag');
  });
  st.addEventListener('pointermove', e => {
    if (!LB.ptrs.has(e.pointerId)) return;
    LB.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p0 = LB.start;
    if (LB.ptrs.size === 1 && p0.ptrs.size === 1) {
      const a = [...p0.ptrs.values()][0], b = [...LB.ptrs.values()][0];
      LB.x = p0.x + b.x - a.x; LB.y = p0.y + b.y - a.y; lbApply();
    } else if (LB.ptrs.size === 2 && p0.ptrs.size === 2) {
      const [a1, a2] = [...p0.ptrs.values()], [b1, b2] = [...LB.ptrs.values()];
      const d0 = Math.hypot(a1.x - a2.x, a1.y - a2.y), d1 = Math.hypot(b1.x - b2.x, b1.y - b2.y);
      const r = st.getBoundingClientRect(), cx = (a1.x + a2.x) / 2 - r.left, cy = (a1.y + a2.y) / 2 - r.top;
      const ns = Math.max(.03, Math.min(p0.s * d1 / d0, 16));
      LB.x = cx - (cx - p0.x) * (ns / p0.s) + ((b1.x + b2.x) - (a1.x + a2.x)) / 2;
      LB.y = cy - (cy - p0.y) * (ns / p0.s) + ((b1.y + b2.y) - (a1.y + a2.y)) / 2;
      LB.s = ns; lbApply();
    }
  });
  const up = e => { LB.ptrs.delete(e.pointerId); LB.start = { x: LB.x, y: LB.y, s: LB.s, ptrs: new Map(LB.ptrs) }; if (!LB.ptrs.size) st.classList.remove('drag'); };
  st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
  st.addEventListener('dblclick', e => { const r = st.getBoundingClientRect(); lbZoom(2, e.clientX - r.left, e.clientY - r.top); });
  window.addEventListener('keydown', e => {
    if ($('#lightbox').classList.contains('open')) {
      if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') $('#lb-prev').click(); else if (e.key === 'ArrowRight') $('#lb-next').click();
    } else if (e.key === 'Escape') closeDetail();
  });
  window.addEventListener('resize', () => { if ($('#lightbox').classList.contains('open')) lbFit(); });
}

/* ---------------- sun simulation (assets/sun.js) ---------------- */
// after initUI: a persisted open() collapses the mobile sheet, which the sheet observer must see
function initSun() {
  // default focus: the house nearest the centroid of all homes (in Phase 1A, where most of them are)
  const hs = D.homes.filter(h => h.lat), c = [hs.reduce((a, h) => a + h.lat, 0) / hs.length, hs.reduce((a, h) => a + h.lon, 0) / hs.length];
  const k = Math.cos(c[0] * Math.PI / 180), d2 = h => (h.lat - c[0]) ** 2 + ((h.lon - c[1]) * k) ** 2;
  const h0 = D.houses.filter(h => h.lat).reduce((a, h) => d2(h) < d2(a) ? h : a);
  try { sun = window.SunPath?.create(map, { center: [h0.lat, h0.lon], lang: LANG }) || null; } catch (e) { console.error(e); }
}

/* ---------------- price estimates (assets/prices.js) ---------------- */
// the shared overlay canvas hit-tests the last-drawn layer first: keep the homes on top of anything added later
function raiseHomes() { layers.homes.eachLayer(l => l.bringToFront && l.bringToFront()); }
function initPrices() {
  PX('init', {
    map, D, S, layers, t, tm, esc, nf, fmtDate, store, $, $$, raiseHomes,
    lang: () => LANG,
    select: (type, id, o) => select(type, id, o),
    switchTab: name => switchTab(name),
    // the market data arrived (or failed): redraw what shows estimates
    onReady() { refreshDetail(); renderLegend(); renderList(); },
    setMode(mode) { $(`#mode-seg [data-mode="${mode}"]`)?.click(); },
  });
}

/* ---------------- wiring ---------------- */
function initUI() {
  $$('#tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $$('#mode-seg button').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    S.mode = b.dataset.mode;
    $$('#mode-seg button').forEach(x => x.classList.toggle('active', x === b));
    renderLegend(); buildMarkers(); reselect(); renderList();
  }));
  $$('#lang-seg button').forEach(b => b.addEventListener('click', () => { LANG = b.dataset.lang; store.set('rp-lang', LANG); applyLang(); }));
  $('#d-close').addEventListener('click', closeDetail);
  const toggle = (id, layer, extra) => $(id).addEventListener('change', e => { e.target.checked ? layer().addTo(map) : map.removeLayer(layer()); extra && extra(e.target.checked); onZoom(); });
  toggle('#ly-drawings', () => layers.drawings);
  toggle('#ly-phases', () => layers.phases, on => { on ? layers.phaseLabels.addTo(map) : map.removeLayer(layers.phaseLabels); if (on) { layers.phases.bringToBack(); raiseHomes(); } });
  toggle('#ly-parcels', () => layers.parcels);
  toggle('#ly-homes', () => layers.homes, on => { if (!on) map.removeLayer(selRing); });
  $('#ly-opacity').addEventListener('input', e => layers.drawings.setOpacity(e.target.value / 100));
  const sb = $('#sidebar');
  // mirror the mobile sheet state on <body> so map controls can sit above the sheet
  const syncSheet = () => {
    document.body.classList.toggle('sheet-collapsed', sb.classList.contains('collapsed'));
    document.body.classList.toggle('sheet-expanded', sb.classList.contains('expanded'));
  };
  syncSheet();
  new MutationObserver(syncSheet).observe(sb, { attributes: true, attributeFilter: ['class'] });
  $('#grab').addEventListener('click', () => {
    if (sb.classList.contains('expanded')) { sb.classList.remove('expanded'); sb.classList.add('collapsed'); }
    else if (sb.classList.contains('collapsed')) sb.classList.remove('collapsed');
    else sb.classList.add('expanded');
  });
  window.addEventListener('hashchange', readHash);
  setTimeout(() => { $('#map-hint').style.opacity = 0; }, 7000);
}

load().then(() => {
  initTheme();
  initMap();
  initUI();
  initSun();
  initSearch();
  initLightbox();
  applyLang();
  initPrices();   // registers the price module; it fetches data/market/*.json once the map is idle
  readHash();
  $('#loading').remove();
}).catch(err => {
  console.error(err);
  $('#loading').innerHTML = `<div style="max-width:420px;text-align:center">Erro ao carregar os dados / failed to load data.<br><code style="font-size:12px">${esc(err.message)}</code></div>`;
});
})();
