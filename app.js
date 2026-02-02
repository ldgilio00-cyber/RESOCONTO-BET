// --- PWA offline
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

const $ = (id) => document.getElementById(id);
const money = (n) => "€ " + (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
const pct = (n) => (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2) + "%";
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

const clone = (x) => {
  try { return structuredClone(x); } catch { return JSON.parse(JSON.stringify(x)); }
};

// ✅ nuova chiave (bookmakers)
const KEY = "ts_v6";
const OLD_KEYS = ["ts_v5","ts_v4","ts_v3","ts_v2","ts_v1","ts_v0","ts"];
const DEFAULT = {
  budgetStart: 0,
  bookmakers: [],
  bets: []
};

function safeParse(raw){
  try { return JSON.parse(raw); } catch { return null; }
}

function todayISO(){
  const d = new Date();
  const z = (n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
}

function normalizeBookmaker(bm){
  if (!bm || typeof bm !== "object") return null;
  const nb = { ...bm };
  if (!nb.id) nb.id = uid();
  nb.name = String(nb.name || "").trim() || "Bookmaker";
  nb.bankrollStart = Number(nb.bankrollStart || 0);
  if (!Number.isFinite(nb.bankrollStart)) nb.bankrollStart = 0;
  nb.bankrollStart = Math.max(0, nb.bankrollStart);
  return nb;
}

function ensureDefaultBookmakers(state){
  if (!Array.isArray(state.bookmakers)) state.bookmakers = [];

  // Se non ci sono bookmakers:
  if (state.bookmakers.length === 0) {
    const hasBets = Array.isArray(state.bets) && state.bets.length > 0;

    if (hasBets) {
      // Migrazione vecchi dati: tutto su "Generico"
      const gen = normalizeBookmaker({ id: uid(), name: "Generico", bankrollStart: Number(state.budgetStart || 0) });
      state.bookmakers = [gen];
      state.bets = state.bets.map(b => ({ ...b, bookmakerId: gen.id }));
    } else {
      // Nuova installazione: default set
      const base = Number(state.budgetStart || 0);
      const names = ["Bet365","Goldbet","Sisal"];
      const each = names.length ? base / names.length : 0;
      state.bookmakers = names.map(n => normalizeBookmaker({ id: uid(), name: n, bankrollStart: each }));
    }
  }

  // Dedupe: per id e per name (case-insensitive)
  const byId = new Map();
  const byName = new Map();
  const out = [];
  for (const bm of state.bookmakers.map(normalizeBookmaker).filter(Boolean)) {
    const keyName = bm.name.trim().toLowerCase();
    if (byId.has(bm.id)) continue;
    if (byName.has(keyName)) continue;
    byId.set(bm.id, true);
    byName.set(keyName, true);
    out.push(bm);
  }
  state.bookmakers = out;

  // Se dopo dedupe resti senza bookmakers, ricrea default
  if (state.bookmakers.length === 0) {
    state.bookmakers = [normalizeBookmaker({ id: uid(), name: "Generico", bankrollStart: Number(state.budgetStart || 0) })];
  }

  return state;
}

function normalizeBet(b){
  if (!b || typeof b !== "object") return null;
  const nb = { ...b };
  if (!nb.id) nb.id = uid();
  nb.date = (String(nb.date || "").trim()) || todayISO();
  nb.tipster = (String(nb.tipster || "").trim());
  nb.desc = (String(nb.desc || "").trim());
  nb.odds = Number(nb.odds || 0);
  nb.stakePct = Number(nb.stakePct || 0);
  nb.stakeAmt = Number(nb.stakeAmt || 0);
  nb.outcome = nb.outcome || "In corso";
  if (!["In corso","Vinta","Persa","Void"].includes(nb.outcome)) nb.outcome = "In corso";

  // Bookmaker mapping:
  // - Prefer bookmakerId
  // - Accept old fields: bookmaker / bookmakerName (string)
  if (typeof nb.bookmakerId !== "string") nb.bookmakerId = "";
  const legacyName = String(nb.bookmakerName || nb.bookmaker || "").trim();
  if (legacyName && !nb.bookmakerId) nb._legacyBookName = legacyName;

  return nb;
}

function normalizeState(s){
  const state = (s && typeof s === "object") ? s : clone(DEFAULT);

  // budgetStart globale (base)
  state.budgetStart = Number(state.budgetStart || 0);
  if (!Number.isFinite(state.budgetStart)) state.budgetStart = 0;
  state.budgetStart = Math.max(0, state.budgetStart);

  // bets
  if (!Array.isArray(state.bets)) state.bets = [];
  state.bets = state.bets.map(b => normalizeBet(b)).filter(Boolean);

  // bookmakers
  if (!Array.isArray(state.bookmakers)) state.bookmakers = [];
  state.bookmakers = state.bookmakers.map(normalizeBookmaker).filter(Boolean);

  // Se mancano bookmakers -> defaults / migrazione
  ensureDefaultBookmakers(state);

  // Mappa bets a bookmakers esistenti
  const nameToId = new Map(state.bookmakers.map(bm => [bm.name.trim().toLowerCase(), bm.id]));
  const firstId = state.bookmakers[0]?.id || "";

  // Se ci sono legacy book names non mappati, creali e assegna budgetStart=0 (utente può sistemare in pagina Bookmakers)
  // IMPORTANTE: se non c'è alcuna allocazione e budgetStart>0, meglio ripartire equamente
  const missingNames = new Set();
  for (const b of state.bets) {
    if (b._legacyBookName) {
      const k = b._legacyBookName.trim().toLowerCase();
      if (k && !nameToId.has(k)) missingNames.add(b._legacyBookName.trim());
    }
  }
  if (missingNames.size) {
    for (const n of missingNames) {
      const bm = normalizeBookmaker({ id: uid(), name: n, bankrollStart: 0 });
      state.bookmakers.push(bm);
      nameToId.set(bm.name.trim().toLowerCase(), bm.id);
    }
  }

  for (const b of state.bets) {
    if (!b.bookmakerId) {
      if (b._legacyBookName) {
        const k = b._legacyBookName.trim().toLowerCase();
        b.bookmakerId = nameToId.get(k) || firstId;
        delete b._legacyBookName;
      } else {
        b.bookmakerId = firstId;
      }
    }
    // Se bookmakerId punta a un id inesistente, fallback al primo
    if (!state.bookmakers.some(x => x.id === b.bookmakerId)) b.bookmakerId = firstId;
  }

  // ordina: più recente prima (per data + fallback)
  state.bets.sort((a,b)=>{
    const da = String(a.date||"");
    const db = String(b.date||"");
    if (da !== db) return db.localeCompare(da);
    return String(b.id).localeCompare(String(a.id));
  });

  return state;
}

function load() {
  // 1) prova nuova key
  const cur = safeParse(localStorage.getItem(KEY));
  if (cur) return normalizeState(cur);

  // 2) migrazione automatica
  for (const k of OLD_KEYS) {
    const old = safeParse(localStorage.getItem(k));
    if (old) {
      const migrated = normalizeState(old);
      save(migrated);
      return migrated;
    }
  }

  return normalizeState(clone(DEFAULT));
}

function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

/**
 * Stake rules:
 * - If stakeAmt (manual €) > 0 => use it
 * - Else if stakePct > 0 => compute from BUDGET START (fixed) => budgetStart * pct/100
 */
function calcStakeAmount(budgetStart, stakePct, stakeAmt) {
  const a = Number(stakeAmt || 0);
  if (a > 0) return a;

  const p = Number(stakePct || 0);
  if (p > 0) return Number(budgetStart || 0) * (p / 100);

  return 0;
}

/**
 * Recompute:
 * - disponibile per bookmaker: scala subito lo stake SOLO dal bookmaker selezionato
 * - chiusura: Vinta rientra stake*odds, Persa resta scalato, Void rientra stake
 * - grafico bankroll: si muove SOLO sulle scommesse chiuse (profit/loss)
 */
function recompute(state){
  // Books availability
  const books = new Map();
  state.bookmakers.forEach(bm=>{
    books.set(bm.id, {
      id: bm.id,
      name: bm.name,
      start: Number(bm.bankrollStart || 0),
      avail: Number(bm.bankrollStart || 0)
    });
  });

  const firstId = state.bookmakers[0]?.id || "";
  const getBook = (id) => books.get(id) || books.get(firstId);

  let bankrollClosed = Number(state.budgetStart || 0); // grafico solo chiuse
  const closedPoints = [bankrollClosed];

  // calcolo da “vecchia -> nuova”
  for (const b of state.bets.slice().reverse()) {
    const book = getBook(b.bookmakerId);
    if (!book) continue;

    b.bookName = book.name;

    b.bookAvailBefore = Number(book.avail || 0);

    // stake% sempre su base globale
    b.stakePlanned = calcStakeAmount(state.budgetStart, b.stakePct, b.stakeAmt);
    b.stakePlanned = Math.max(0, Number(b.stakePlanned || 0));

    // non permettere stake oltre disponibile bookmaker
    b.stakeUsed = Math.min(b.stakePlanned, Math.max(0, book.avail));
    b.stakeUsed = Math.max(0, Number(b.stakeUsed || 0));

    // scala subito dal bookmaker
    book.avail -= b.stakeUsed;

    const odds = Number(b.odds || 0);
    b.winGross = b.stakeUsed * odds;

    if (b.outcome === "Vinta") {
      b.profit = b.stakeUsed * (odds - 1);
      book.avail += b.winGross;          // rientra vincita lorda sullo stesso bookmaker
      bankrollClosed += b.profit;         // grafico sale del profitto
      closedPoints.push(bankrollClosed);
    } else if (b.outcome === "Persa") {
      b.profit = -b.stakeUsed;
      bankrollClosed += b.profit;         // grafico scende solo quando chiudi persa
      closedPoints.push(bankrollClosed);
    } else if (b.outcome === "Void") {
      b.profit = 0;
      book.avail += b.stakeUsed;          // rimborso puntata sullo stesso bookmaker
      closedPoints.push(bankrollClosed);  // punto uguale (chiusa)
    } else {
      // In corso
      b.profit = 0;
    }

    b.bookAvailAfter = Number(book.avail || 0);
  }

  // Disponibili per bookmaker e totale
  const bookAvailArr = [];
  let totalAvail = 0;
  for (const bm of state.bookmakers) {
    const bk = books.get(bm.id);
    const avail = Number(bk?.avail || 0);
    const start = Number(bm.bankrollStart || 0);
    totalAvail += avail;
    bookAvailArr.push({
      id: bm.id,
      name: bm.name,
      start,
      avail
    });
  }

  state.bookmakersAvail = bookAvailArr;
  state.budgetNow = totalAvail;             // disponibile totale
  state.bankrollClosedPoints = closedPoints;

  return state;
}

function badgeClass(outcome){
  if (outcome === "Vinta") return "out-win";
  if (outcome === "Persa") return "out-lose";
  if (outcome === "Void") return "out-void";
  return "out-in";
}

// ---------------------------
// Navigation (tabbar)
// ---------------------------
function showPage(pageId){
  document.querySelectorAll(".page").forEach(p => p.classList.remove("show"));
  const el = $(pageId);
  if (el) el.classList.add("show");

  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(`.tab[data-page="${pageId}"]`).forEach(t => t.classList.add("active"));

  render();
}

// ---------------------------
// Rendering
// ---------------------------
function render(){
  let state = recompute(load());
  save(state);

  // budget top
  if ($("budgetStart")) $("budgetStart").textContent = money(state.budgetStart || 0);
  if ($("budgetNow")) $("budgetNow").textContent = money(state.budgetNow || 0);

  // aggiorna selects bookmakers (Aggiungi/Modifica)
  fillBookmakerSelects(state);

  // Bets filters
  const filt = ($("filterOutcome")?.value || "Tutte");
  const q = (($("search")?.value || "").trim().toLowerCase());
  const match = (b) => {
    const okF = (filt === "Tutte") || (b.outcome === filt);
    const okQ = !q || (
      String(b.tipster||"").toLowerCase().includes(q) ||
      String(b.desc||"").toLowerCase().includes(q) ||
      String(b.bookName||"").toLowerCase().includes(q)
    );
    return okF && okQ;
  };

  const openBets = state.bets.filter(b => b.outcome === "In corso" && match(b));
  const closedBets = state.bets.filter(b => b.outcome !== "In corso" && match(b));

  renderBetList("listOpen", openBets, true);
  renderBetList("listClosed", closedBets, false);

  // Giorni
  renderDays(state);

  // Stats (chiuse)
  const total = state.bets.length;
  const closed = state.bets.filter(b => b.outcome !== "In corso").length;
  const wins = state.bets.filter(b => b.outcome === "Vinta").length;
  const losses = state.bets.filter(b => b.outcome === "Persa").length;
  const voids = state.bets.filter(b => b.outcome === "Void").length;

  const stakedClosed = state.bets
    .filter(b => b.outcome !== "In corso")
    .reduce((s,b)=>s + Number(b.stakeUsed||0), 0);

  const profitClosed = state.bets
    .filter(b => b.outcome !== "In corso")
    .reduce((s,b)=>s + Number(b.profit||0), 0);

  const wr = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

  // ✅ ROI su base = profitto chiuse / bankroll iniziale
  const roiBase = (Number(state.budgetStart || 0) > 0) ? (profitClosed / Number(state.budgetStart || 0)) * 100 : 0;

  if ($("sTotal")) $("sTotal").textContent = total;
  if ($("sClosed")) $("sClosed").textContent = closed;
  if ($("sWR")) $("sWR").textContent = pct(wr);
  if ($("sStaked")) $("sStaked").textContent = money(stakedClosed);
  if ($("sProfit")) $("sProfit").textContent = money(profitClosed);
  if ($("sROI")) $("sROI").textContent = pct(roiBase);

  // charts
  if ($("cBank")) drawLineChart($("cBank"), state.bankrollClosedPoints || [Number(state.budgetStart||0)]);
  if ($("cPie")) drawPie($("cPie"), [wins, losses, voids], ["Vinte","Perse","Void"]);
  if ($("cTip")) drawBarsSigned($("cTip"), tipsterProfitPairs(state).slice(0, 10));

  renderTipster(state);
  renderBookmakers(state);
}

function renderBetList(containerId, bets, isOpen){
  const box = $(containerId);
  if (!box) return;

  box.innerHTML = "";
  if (!bets.length) {
    box.innerHTML = `<div class="hint">Nessuna voce.</div>`;
    return;
  }

  for (const b of bets) {
    const el = document.createElement("div");
    el.className = `item ${badgeClass(b.outcome)}`;
    el.innerHTML = `
      <div class="row between">
        <div class="t1">${escapeHtml(b.desc || "(senza descrizione)")}</div>
        <div class="badge">${b.outcome}</div>
      </div>
      <div class="t2">
        <span>${escapeHtml(b.date || "")}</span>
        <span>Book: <b>${escapeHtml(b.bookName || "-")}</b></span>
        <span>Tipster: <b>${escapeHtml(b.tipster || "-")}</b></span>
        <span>Quota: <b>${Number(b.odds||0).toFixed(2)}</b></span>
        <span>Puntata: <b>${money(b.stakeUsed||0)}</b></span>
        <span>Vincita: <b>${money(b.winGross||0)}</b></span>
        ${
          isOpen
            ? `<span>Disp. book: <b>${money(b.bookAvailAfter||0)}</b></span>`
            : `<span>Profitto: <b>${money(b.profit||0)}</b></span>`
        }
      </div>
      <div class="itemActions">
        ${isOpen ? `
          <button class="miniBtn win" data-act="win">Vinta</button>
          <button class="miniBtn lose" data-act="lose">Persa</button>
          <button class="miniBtn void" data-act="void">Void</button>
        ` : ``}
        <button class="miniBtn edit" data-act="edit">Modifica</button>
        <button class="miniBtn danger" title="Elimina" data-act="del">🗑</button>
      </div>
    `;

    el.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", (ev)=>{
        ev.stopPropagation();
        const act = btn.getAttribute("data-act");
        if (act === "edit") return openEdit(b.id);
        if (act === "del") return deleteBetById(b.id);
        if (act === "win") return setOutcome(b.id, "Vinta");
        if (act === "lose") return setOutcome(b.id, "Persa");
        if (act === "void") return setOutcome(b.id, "Void");
      });
    });

    el.addEventListener("click", ()=>openEdit(b.id));
    box.appendChild(el);
  }
}

// -------- Giorni (accordion)
function renderDays(state){
  const box = $("daysList");
  if (!box) return;

  // raggruppa per data
  const map = new Map();
  for (const b of state.bets) {
    const d = (b.date || "").trim() || "Senza data";
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(b);
  }

  const dates = Array.from(map.keys()).sort((a,b)=> b.localeCompare(a)); // YYYY-MM-DD desc
  box.innerHTML = "";

  if (!dates.length) {
    box.innerHTML = `<div class="hint">Nessuna scommessa ancora.</div>`;
    return;
  }

  for (const d of dates) {
    const bets = map.get(d);

    const closed = bets.filter(x => x.outcome !== "In corso");
    const open = bets.filter(x => x.outcome === "In corso");

    const profit = closed.reduce((s,x)=> s + Number(x.profit||0), 0);
    const wins = closed.filter(x => x.outcome==="Vinta").length;
    const losses = closed.filter(x => x.outcome==="Persa").length;
    const voids = closed.filter(x => x.outcome==="Void").length;

    let cls = "neu";
    if (profit > 0) cls = "pos";
    if (profit < 0) cls = "neg";

    const day = document.createElement("div");
    day.className = "dayCard";

    const header = document.createElement("div");
    header.className = "dayHeader";
    header.innerHTML = `
      <div class="dayTitle">
        <div>${escapeHtml(d)}</div>
        <div class="dayMeta">
          Tot: <b>${bets.length}</b> • In corso: <b>${open.length}</b> • Chiuse: <b>${closed.length}</b>
          • W-L-V: <b>${wins}-${losses}-${voids}</b>
        </div>
      </div>
      <div class="dayProfit ${cls}">${money(profit)}</div>
    `;

    const body = document.createElement("div");
    body.className = "dayBody";

    const inner = document.createElement("div");
    inner.className = "table";
    body.appendChild(inner);
    renderBetsInto(inner, bets);

    header.addEventListener("click", ()=>{
      body.classList.toggle("show");
    });

    day.appendChild(header);
    day.appendChild(body);
    box.appendChild(day);
  }
}

function renderBetsInto(containerEl, bets){
  containerEl.innerHTML = "";

  // ordina: in corso prima, poi chiuse
  const sorted = bets.slice().sort((a,b)=>{
    const ao = a.outcome === "In corso" ? 0 : 1;
    const bo = b.outcome === "In corso" ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return String(b.id).localeCompare(String(a.id));
  });

  for (const b of sorted) {
    const isOpen = b.outcome === "In corso";
    const el = document.createElement("div");
    el.className = `item ${badgeClass(b.outcome)}`;
    el.innerHTML = `
      <div class="row between">
        <div class="t1">${escapeHtml(b.desc || "(senza descrizione)")}</div>
        <div class="badge">${b.outcome}</div>
      </div>
      <div class="t2">
        <span>Book: <b>${escapeHtml(b.bookName || "-")}</b></span>
        <span>Tipster: <b>${escapeHtml(b.tipster || "-")}</b></span>
        <span>Quota: <b>${Number(b.odds||0).toFixed(2)}</b></span>
        <span>Puntata: <b>${money(b.stakeUsed||0)}</b></span>
        ${isOpen ? `` : `<span>Profitto: <b>${money(b.profit||0)}</b></span>`}
      </div>
      <div class="itemActions">
        ${isOpen ? `
          <button class="miniBtn win" data-act="win">Vinta</button>
          <button class="miniBtn lose" data-act="lose">Persa</button>
          <button class="miniBtn void" data-act="void">Void</button>
        ` : ``}
        <button class="miniBtn edit" data-act="edit">Modifica</button>
        <button class="miniBtn danger" title="Elimina" data-act="del">🗑</button>
      </div>
    `;

    el.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", (ev)=>{
        ev.stopPropagation();
        const act = btn.getAttribute("data-act");
        if (act === "edit") return openEdit(b.id);
        if (act === "del") return deleteBetById(b.id);
        if (act === "win") return setOutcome(b.id, "Vinta");
        if (act === "lose") return setOutcome(b.id, "Persa");
        if (act === "void") return setOutcome(b.id, "Void");
      });
    });

    el.addEventListener("click", ()=>openEdit(b.id));
    containerEl.appendChild(el);
  }
}

function fillBookmakerSelects(state){
  const books = (state.bookmakers || []).map(bm => ({ id: bm.id, name: bm.name }));

  const fill = (sel, selectedId) => {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = "";
    for (const b of books) {
      const o = document.createElement("option");
      o.value = b.id;
      o.textContent = b.name;
      sel.appendChild(o);
    }
    const wanted = selectedId || cur || books[0]?.id || "";
    if (wanted && books.some(x=>x.id===wanted)) sel.value = wanted;
    else if (books[0]?.id) sel.value = books[0].id;
  };

  fill($("fBook"), null);
  // eBook viene settato quando apri il modale, ma teniamolo aggiornato se serve
  fill($("eBook"), $("eBook")?.value || null);
}

function setBudget(){
  const state = load();
  const v = Number($("inpBudget")?.value || 0);
  state.budgetStart = Math.max(0, v);

  // Se non ci sono allocazioni valide, crea defaults
  ensureDefaultBookmakers(state);

  save(state);
  render();
}

function addBet(){
  const state = load();
  const bookId = ($("fBook")?.value) || state.bookmakers?.[0]?.id || "";

  const b = normalizeBet({
    id: uid(),
    date: $("fDate")?.value || todayISO(),
    tipster: ($("fTipster")?.value || "").trim(),
    desc: ($("fDesc")?.value || "").trim(),
    odds: Number($("fOdds")?.value || 0),
    stakePct: Number($("fStakePct")?.value || 0),
    stakeAmt: Number($("fStakeAmt")?.value || 0),
    outcome: $("fOutcome")?.value || "In corso",
    bookmakerId: bookId
  });

  if (!b.odds || b.odds <= 1) { alert("Inserisci una quota valida (es. 1.50)"); return; }

  // se stake risulta 0, chiedi conferma (ammesso)
  const planned = calcStakeAmount(state.budgetStart, b.stakePct, b.stakeAmt);
  if (!planned || planned <= 0) {
    const ok = confirm("Attenzione: la puntata risulta 0. Vuoi inserire comunque la bet?");
    if (!ok) return;
  }

  state.bets.unshift(b);

  // reset form
  if ($("fDesc")) $("fDesc").value = "";
  if ($("fOdds")) $("fOdds").value = "";
  if ($("fStakePct")) $("fStakePct").value = "";
  if ($("fStakeAmt")) $("fStakeAmt").value = "";
  if ($("fOutcome")) $("fOutcome").value = "In corso";

  save(state);
  render();
  showPage("page-bets");
}

function setOutcome(id, outcome){
  const state = load();
  const b = state.bets.find(x=>x.id===id);
  if (!b) return;
  b.outcome = outcome;
  save(state);
  render();
}

function resetAll(){
  if (!confirm("Reset totale? Cancella scommesse e bookmakers.")) return;
  save(normalizeState(clone(DEFAULT)));
  render();
  showPage("page-add");
}

// --- Modal edit
let editingId = null;

function openEdit(id){
  const state = load();
  const b = state.bets.find(x=>x.id===id);
  if (!b) return;

  editingId = id;

  if ($("eDate")) $("eDate").value = b.date || todayISO();
  if ($("eTipster")) $("eTipster").value = b.tipster || "";
  if ($("eDesc")) $("eDesc").value = b.desc || "";
  if ($("eOdds")) $("eOdds").value = Number(b.odds||0);
  if ($("eStakePct")) $("eStakePct").value = Number(b.stakePct||0);
  if ($("eStakeAmt")) $("eStakeAmt").value = Number(b.stakeAmt||0);
  if ($("eOutcome")) $("eOutcome").value = b.outcome || "In corso";
  if ($("eBook")) $("eBook").value = b.bookmakerId || (state.bookmakers?.[0]?.id || "");

  $("modal")?.classList.add("show");
}

function closeEdit(){
  editingId = null;
  $("modal")?.classList.remove("show");
}

function saveEdit(){
  const state = load();
  const b = state.bets.find(x=>x.id===editingId);
  if (!b) return;

  b.date = $("eDate")?.value || todayISO();
  b.tipster = ($("eTipster")?.value || "").trim();
  b.desc = ($("eDesc")?.value || "").trim();
  b.odds = Number($("eOdds")?.value || 0);
  b.stakePct = Number($("eStakePct")?.value || 0);
  b.stakeAmt = Number($("eStakeAmt")?.value || 0);
  b.outcome = $("eOutcome")?.value || "In corso";
  b.bookmakerId = $("eBook")?.value || (state.bookmakers?.[0]?.id || "");

  if (!b.odds || b.odds <= 1) { alert("Quota non valida"); return; }

  save(state);
  closeEdit();
  render();
}

function deleteBet(){
  if (!editingId) return;
  deleteBetById(editingId, true);
}

function deleteBetById(id, closeModal=false){
  const state = load();
  const idx = state.bets.findIndex(x=>x.id===id);
  if (idx < 0) return;

  if (!confirm("Eliminare questa scommessa?")) return;

  state.bets.splice(idx, 1);
  save(state);
  if (closeModal) closeEdit();
  render();
}

// ---------------------------
// Bookmakers page
// ---------------------------
function renderBookmakers(state){
  const list = $("booksList");
  if (!list) return;

  // header totals (opzionali)
  const totalStart = (state.bookmakers || []).reduce((s,bm)=> s + Number(bm.bankrollStart||0), 0);
  const totalAvail = (state.bookmakersAvail || []).reduce((s,bm)=> s + Number(bm.avail||0), 0);
  if ($("bmTotalStart")) $("bmTotalStart").textContent = money(totalStart);
  if ($("bmTotalAvail")) $("bmTotalAvail").textContent = money(totalAvail);

  list.innerHTML = "";

  const rows = (state.bookmakers || []).map(bm=>{
    const a = (state.bookmakersAvail || []).find(x=>x.id===bm.id);
    return {
      id: bm.id,
      name: bm.name,
      start: Number(bm.bankrollStart||0),
      avail: Number(a?.avail ?? bm.bankrollStart ?? 0)
    };
  });

  if (!rows.length) {
    list.innerHTML = `<div class="hint">Nessun bookmaker.</div>`;
    return;
  }

  for (const r of rows) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="row between">
        <div class="t1">${escapeHtml(r.name)}</div>
        <div class="badge">Disp: ${money(r.avail)}</div>
      </div>
      <div class="t2">
        <span>Budget iniziale:</span>
        <span><input class="inp inlineInp" type="number" step="0.01" min="0" data-bmstart="${r.id}" value="${String(r.start)}" /></span>
        <span>Usato: <b>${money(Math.max(0, r.start - r.avail))}</b></span>
      </div>
      <div class="itemActions">
        <button class="miniBtn" data-act="rename" data-id="${r.id}">Rinomina</button>
        <button class="miniBtn danger" data-act="delbm" data-id="${r.id}">Elimina</button>
      </div>
    `;

    // update bankrollStart on input
    el.querySelectorAll("input[data-bmstart]").forEach(inp=>{
      inp.addEventListener("change", ()=>{
        const id = inp.getAttribute("data-bmstart");
        const v = Math.max(0, Number(inp.value || 0));
        updateBookmakerStart(id, v);
      });
    });

    el.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", (ev)=>{
        ev.preventDefault();
        const act = btn.getAttribute("data-act");
        const id = btn.getAttribute("data-id");
        if (act === "delbm") return deleteBookmaker(id);
        if (act === "rename") return renameBookmaker(id);
      });
    });

    list.appendChild(el);
  }
}

function addBookmaker(){
  const state = load();
  const name = ($("bmName")?.value || "").trim();
  const start = Math.max(0, Number($("bmStart")?.value || 0));

  if (!name) { alert("Inserisci un nome bookmaker."); return; }

  const exists = (state.bookmakers || []).some(bm => String(bm.name||"").trim().toLowerCase() === name.toLowerCase());
  if (exists) { alert("Esiste già un bookmaker con questo nome."); return; }

  state.bookmakers.push(normalizeBookmaker({ id: uid(), name, bankrollStart: start }));

  // reset inputs
  if ($("bmName")) $("bmName").value = "";
  if ($("bmStart")) $("bmStart").value = "";

  save(state);
  render();
}

function updateBookmakerStart(id, newStart){
  const state = load();
  const bm = (state.bookmakers || []).find(x=>x.id===id);
  if (!bm) return;
  bm.bankrollStart = Math.max(0, Number(newStart || 0));
  save(state);
  render();
}

function renameBookmaker(id){
  const state = load();
  const bm = (state.bookmakers || []).find(x=>x.id===id);
  if (!bm) return;

  const name = prompt("Nuovo nome bookmaker:", bm.name || "");
  if (name === null) return;

  const next = String(name).trim();
  if (!next) { alert("Nome non valido."); return; }

  const exists = (state.bookmakers || []).some(x =>
    x.id !== id && String(x.name||"").trim().toLowerCase() === next.toLowerCase()
  );
  if (exists) { alert("Esiste già un bookmaker con questo nome."); return; }

  bm.name = next;
  save(state);
  render();
}

function deleteBookmaker(id){
  const state = load();
  const bm = (state.bookmakers || []).find(x=>x.id===id);
  if (!bm) return;

  const used = (state.bets || []).some(b => b.bookmakerId === id);
  if (used) {
    alert("Non puoi eliminare questo bookmaker: è usato da almeno una bet.");
    return;
  }

  if (!confirm(`Eliminare bookmaker "${bm.name}"?`)) return;

  state.bookmakers = (state.bookmakers || []).filter(x=>x.id!==id);

  // se rimani senza bookmakers, ricrea default
  ensureDefaultBookmakers(state);

  save(state);
  render();
}

function redistributeEven(){
  const state = load();
  if (!state.bookmakers || state.bookmakers.length === 0) {
    ensureDefaultBookmakers(state);
  }

  const n = state.bookmakers.length;
  if (n <= 0) return;

  const base = Number(state.budgetStart || 0);
  if (!confirm(`Ripartire equamente ${money(base)} tra ${n} bookmakers? Sovrascrive i budget iniziali attuali.`)) return;

  const eachRaw = (n ? (base / n) : 0);
  const round2 = (x)=> Math.round((x + Number.EPSILON)*100)/100;

  // assegna arrotondato, aggiusta ultimo per far tornare esattamente
  let acc = 0;
  for (let i=0;i<n;i++){
    const bm = state.bookmakers[i];
    if (i < n-1) {
      const v = round2(eachRaw);
      bm.bankrollStart = v;
      acc += v;
    } else {
      bm.bankrollStart = round2(base - acc);
    }
  }

  save(state);
  render();
}

// ---------------------------
// Backup / Import JSON
// ---------------------------
function backup(){
  const state = load();
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tracker-scommesse-backup-${todayISO()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
  alert("Backup scaricato. Salvalo in File/iCloud.");
}

function importFromFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    const obj = safeParse(reader.result);
    if (!obj) { alert("File non valido."); return; }

    const incoming = normalizeState(obj);
    const current = load();

    // OK = sostituisci, Annulla = unisci
    const replace = confirm("Import: OK = Sostituisci tutto. Annulla = Unisci ai dati attuali.");
    if (replace) {
      save(incoming);
      render();
      alert("Import completato (sostituzione).");
      return;
    }

    // MERGE
    // 1) merge bookmakers con mapping id
    const idMap = new Map(); // incomingId -> mergedId
    const existingById = new Map((current.bookmakers || []).map(bm=>[bm.id, bm]));
    const existingByName = new Map((current.bookmakers || []).map(bm=>[String(bm.name||"").trim().toLowerCase(), bm]));

    for (const ibm of (incoming.bookmakers || [])) {
      const inId = ibm.id;
      const inNameKey = String(ibm.name||"").trim().toLowerCase();

      // se name già presente -> mappa a quello
      if (existingByName.has(inNameKey)) {
        idMap.set(inId, existingByName.get(inNameKey).id);
        continue;
      }

      // se id collide -> genera nuovo id
      let newId = inId;
      if (existingById.has(newId)) newId = uid();

      const added = normalizeBookmaker({ id: newId, name: ibm.name, bankrollStart: ibm.bankrollStart });
      current.bookmakers.push(added);

      existingById.set(added.id, added);
      existingByName.set(String(added.name||"").trim().toLowerCase(), added);

      idMap.set(inId, added.id);
    }

    ensureDefaultBookmakers(current);

    // 2) merge bets (dedupe by id) + remap bookmakerId
    const ids = new Set((current.bets || []).map(b=>b.id));
    const mergedBets = (current.bets || []).slice();

    const firstId = current.bookmakers?.[0]?.id || "";

    for (const b0 of (incoming.bets || [])) {
      const bet = normalizeBet(b0);

      // remap bookmaker
      const incomingBook = bet.bookmakerId || "";
      if (incomingBook && idMap.has(incomingBook)) bet.bookmakerId = idMap.get(incomingBook);
      if (!bet.bookmakerId || !(current.bookmakers || []).some(x=>x.id===bet.bookmakerId)) bet.bookmakerId = firstId;

      // dedupe id
      if (!bet.id || ids.has(bet.id)) bet.id = uid();
      ids.add(bet.id);

      mergedBets.push(bet);
    }

    current.bets = mergedBets;

    // budgetStart: se il tuo è 0 e l'import ha un valore, prendilo
    if ((Number(current.budgetStart||0) === 0) && Number(incoming.budgetStart||0) > 0) {
      current.budgetStart = Number(incoming.budgetStart||0);
    }

    const finalState = normalizeState(current);
    save(finalState);
    render();
    alert("Import completato (unione).");
  };

  reader.readAsText(file);
}

// ---------------------------
// Tipster page (solo chiuse)
// ---------------------------
function renderTipster(state){
  const box = $("tipList");
  if (!box) return;

  const closed = (state.bets || []).filter(b => b.outcome !== "In corso");

  const m = new Map();
  for (const b of closed) {
    const t = (b.tipster || "Senza tipster").trim() || "Senza tipster";
    if (!m.has(t)) m.set(t, { tipster:t, bets:0, wins:0, losses:0, voids:0, staked:0, profit:0 });
    const x = m.get(t);
    x.bets += 1;
    if (b.outcome === "Vinta") x.wins += 1;
    if (b.outcome === "Persa") x.losses += 1;
    if (b.outcome === "Void") x.voids += 1;
    x.staked += Number(b.stakeUsed||0);
    x.profit += Number(b.profit||0);
  }

  const rows = Array.from(m.values()).sort((a,b)=> (b.profit - a.profit));

  if (!rows.length) {
    box.innerHTML = `<div class="hint">Ancora nessuna scommessa chiusa.</div>`;
    return;
  }

  box.innerHTML = "";
  for (const r of rows) {
    const wr = (r.wins + r.losses) > 0 ? (r.wins / (r.wins + r.losses)) * 100 : 0;
    const roi = r.staked > 0 ? (r.profit / r.staked) * 100 : 0;

    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="row between">
        <div class="t1">${escapeHtml(r.tipster)}</div>
        <div class="badge">${money(r.profit)}</div>
      </div>
      <div class="t2">
        <span>Chiuse: <b>${r.bets}</b></span>
        <span>W-L-V: <b>${r.wins}-${r.losses}-${r.voids}</b></span>
        <span>WR: <b>${pct(wr)}</b></span>
        <span>ROI: <b>${pct(roi)}</b></span>
        <span>Puntato: <b>${money(r.staked)}</b></span>
      </div>
    `;
    box.appendChild(el);
  }
}

function tipsterProfitPairs(state){
  const closed = (state.bets || []).filter(b => b.outcome !== "In corso");
  const byTip = new Map();
  closed.forEach(b=>{
    const t = (b.tipster || "Senza tipster").trim() || "Senza tipster";
    byTip.set(t, (byTip.get(t)||0) + Number(b.profit||0));
  });

  return Array.from(byTip.entries())
    .map(([label,value])=>({label, value}))
    .sort((a,b)=> Math.abs(b.value) - Math.abs(a.value));
}

// ---------------------------
// Charts (canvas, offline)
// ---------------------------
function clearCanvas(c){
  const ctx = c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);
  return ctx;
}
function drawText(ctx, x,y, t, size=12, bold=false){
  ctx.font = `${bold?"800 ":""}${size}px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial`;
  ctx.fillStyle = "rgba(232,237,247,.92)";
  ctx.fillText(t, x,y);
}

function drawLineChart(canvas, points){
  const ctx = clearCanvas(canvas);
  const W = canvas.width, H = canvas.height;
  const pad = 34;

  ctx.fillStyle = "rgba(0,0,0,.10)";
  ctx.fillRect(0,0,W,H);

  if (!points || points.length < 2) {
    drawText(ctx, 16, 28, "Chiudi almeno 1 scommessa per vedere il grafico.", 13, true);
    return;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = (max-min) || 1;

  ctx.strokeStyle = "rgba(255,255,255,.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, H-pad);
  ctx.lineTo(W-pad, H-pad);
  ctx.stroke();

  ctx.strokeStyle = "rgba(43,124,255,.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((v,i)=>{
    const x = pad + (i*( (W-2*pad)/(points.length-1) ));
    const y = (H-pad) - ((v-min)/span)*(H-2*pad);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  drawText(ctx, 16, 22, `Min ${money(min)}  •  Max ${money(max)}`, 12, true);
}

function drawPie(canvas, values, labels){
  const ctx = clearCanvas(canvas);
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = "rgba(0,0,0,.10)";
  ctx.fillRect(0,0,W,H);

  const total = values.reduce((s,v)=>s+v,0);
  if (!total){
    drawText(ctx, 16, 28, "Nessuna scommessa chiusa.", 13, true);
    return;
  }

  const cx = 160, cy = 120, r = 80;
  const colors = [
    "rgba(52,211,153,.95)",
    "rgba(248,113,113,.95)",
    "rgba(148,163,184,.95)"
  ];

  let a = -Math.PI/2;
  values.forEach((v,i)=>{
    const ang = (v/total)*Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.fillStyle = colors[i];
    ctx.arc(cx,cy,r,a,a+ang);
    ctx.closePath();
    ctx.fill();
    a += ang;
  });

  labels.forEach((lab,i)=>{
    const x = 300, y = 70 + i*28;
    ctx.fillStyle = colors[i];
    ctx.fillRect(x, y-12, 14, 14);
    ctx.fillStyle = "rgba(232,237,247,.92)";
    drawText(ctx, x+22, y, `${lab}: ${values[i]}`, 13, true);
  });
}

function drawBarsSigned(canvas, pairs){
  const ctx = clearCanvas(canvas);
  const W = canvas.width, H = canvas.height;
  const pad = 34;

  ctx.fillStyle = "rgba(0,0,0,.10)";
  ctx.fillRect(0,0,W,H);

  if (!pairs || pairs.length === 0) {
    drawText(ctx, 16, 28, "Nessuna scommessa chiusa con tipster.", 13, true);
    return;
  }

  const values = pairs.map(p=>Number(p.value||0));
  const maxAbs = Math.max(...values.map(v=>Math.abs(v)), 1);
  const zeroY = pad + (H-2*pad) / 2;

  ctx.strokeStyle = "rgba(255,255,255,.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, H-pad);
  ctx.lineTo(W-pad, H-pad);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.beginPath();
  ctx.moveTo(pad, zeroY);
  ctx.lineTo(W-pad, zeroY);
  ctx.stroke();

  const bw = (W-2*pad) / Math.max(1, pairs.length);

  pairs.forEach((p,i)=>{
    const v = Number(p.value||0);
    const x = pad + i*bw + 10;
    const barW = Math.max(10, bw-20);
    const h = (Math.abs(v)/maxAbs) * ((H-2*pad)/2 - 8);

    if (v >= 0) {
      ctx.fillStyle = "rgba(52,211,153,.90)";
      ctx.fillRect(x, zeroY - h, barW, h);
    } else {
      ctx.fillStyle = "rgba(248,113,113,.90)";
      ctx.fillRect(x, zeroY, barW, h);
    }

    ctx.fillStyle = "rgba(232,237,247,.92)";
    drawText(ctx, x, H-pad+18, String(p.label).slice(0,10), 11, true);
  });

  drawText(ctx, 16, 22, "Verde = profitto • Rosso = perdita", 12, true);
}

// ---------------------------
// Utils
// ---------------------------
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ---------------------------
// Init
// ---------------------------
function init(){
  if ($("fDate")) $("fDate").value = todayISO();

  $("btnSetBudget")?.addEventListener("click", setBudget);
  $("btnAdd")?.addEventListener("click", addBet);
  $("btnReset")?.addEventListener("click", resetAll);

  $("filterOutcome")?.addEventListener("change", render);
  $("search")?.addEventListener("input", render);

  $("btnClose")?.addEventListener("click", closeEdit);
  $("modal")?.addEventListener("click", (e)=>{ if(e.target.id==="modal") closeEdit(); });
  $("btnSave")?.addEventListener("click", saveEdit);
  $("btnDelete")?.addEventListener("click", deleteBet);

  $("btnBackup")?.addEventListener("click", backup);

  // Import
  $("btnImport")?.addEventListener("click", ()=> $("fileImport")?.click());
  $("fileImport")?.addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if (f) importFromFile(f);
    e.target.value = "";
  });

  // Bookmakers actions
  $("btnBmAdd")?.addEventListener("click", addBookmaker);
  $("btnBmEven")?.addEventListener("click", redistributeEven);

  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=> showPage(btn.dataset.page));
  });

  $("btnTipRefresh")?.addEventListener("click", render);

  render();
}
init();
