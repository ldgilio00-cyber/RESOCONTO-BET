// --- PWA offline
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

const $ = (id) => document.getElementById(id);
const money = (n) => "€ " + (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
const pct = (n) => (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2) + "%";
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

// ✅ nuova chiave, ma con migrazione automatica
const KEY = "ts_v5";
const OLD_KEYS = ["ts_v4","ts_v3","ts_v2","ts_v1","ts_v0","ts"];
const DEFAULT = { budgetStart: 0, bets: [] };

function safeParse(raw){
  try { return JSON.parse(raw); } catch { return null; }
}

function normalizeState(s){
  const state = (s && typeof s === "object") ? s : structuredClone(DEFAULT);
  if (typeof state.budgetStart !== "number") state.budgetStart = Number(state.budgetStart || 0);

  if (!Array.isArray(state.bets)) state.bets = [];
  state.bets = state.bets.map(b => normalizeBet(b)).filter(Boolean);

  // ordina: più recente prima (per data + fallback)
  state.bets.sort((a,b)=>{
    const da = String(a.date||"");
    const db = String(b.date||"");
    if (da !== db) return db.localeCompare(da);
    return String(b.id).localeCompare(String(a.id));
  });

  return state;
}

function normalizeBet(b){
  if (!b || typeof b !== "object") return null;
  const nb = { ...b };
  if (!nb.id) nb.id = uid();
  nb.date = (nb.date || "").trim() || todayISO();
  nb.tipster = (nb.tipster || "").trim();
  nb.desc = (nb.desc || "").trim();
  nb.odds = Number(nb.odds || 0);
  nb.stakePct = Number(nb.stakePct || 0);
  nb.stakeAmt = Number(nb.stakeAmt || 0);
  nb.outcome = nb.outcome || "In corso";
  if (!["In corso","Vinta","Persa","Void"].includes(nb.outcome)) nb.outcome = "In corso";
  return nb;
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

  return structuredClone(DEFAULT);
}

function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function todayISO(){
  const d = new Date();
  const z = (n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
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
 * - budgetNow (disponibile): scala subito la puntata (anche In corso) e risale/aggiunge a bet chiusa
 * - bankrollClosedPoints: serie grafico (si muove SOLO a bet chiusa)
 */
function recompute(state){
  let budgetAvail = Number(state.budgetStart || 0);    // budget disponibile “reale”
  let bankrollClosed = Number(state.budgetStart || 0); // bankroll grafico (solo chiuse)
  const closedPoints = [bankrollClosed];

  // calcolo da “vecchia -> nuova”
  for (const b of state.bets.slice().reverse()) {
    b.budgetBefore = budgetAvail;

    // ✅ stake% sempre su budget iniziale
    b.stakeUsed = calcStakeAmount(state.budgetStart, b.stakePct, b.stakeAmt);
    b.stakeUsed = Math.max(0, Number(b.stakeUsed || 0));

    // ✅ non permettere che superi il budget disponibile
    b.stakeUsed = Math.min(b.stakeUsed, Math.max(0, budgetAvail));

    // scala subito dal disponibile
    budgetAvail -= b.stakeUsed;

    const odds = Number(b.odds || 0);
    b.winGross = b.stakeUsed * odds;

    if (b.outcome === "Vinta") {
      b.profit = b.stakeUsed * (odds - 1);
      budgetAvail += b.winGross;          // rientra vincita lorda sul disponibile
      bankrollClosed += b.profit;         // grafico sale del profitto
      closedPoints.push(bankrollClosed);
    } else if (b.outcome === "Persa") {
      b.profit = -b.stakeUsed;
      bankrollClosed += b.profit;         // grafico scende solo quando chiudi persa
      closedPoints.push(bankrollClosed);
    } else if (b.outcome === "Void") {
      b.profit = 0;
      budgetAvail += b.stakeUsed;         // rimborso puntata
      closedPoints.push(bankrollClosed);  // punto uguale (chiusa)
    } else {
      // In corso
      b.profit = 0;
    }

    b.budgetAfter = budgetAvail;
  }

  state.budgetNow = budgetAvail;
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

  // filtri scommesse
  const filt = ($("filterOutcome")?.value || "Tutte");
  const q = (($("search")?.value || "").trim().toLowerCase());
  const match = (b) => {
    const okF = (filt === "Tutte") || (b.outcome === filt);
    const okQ = !q || (String(b.tipster||"").toLowerCase().includes(q) || String(b.desc||"").toLowerCase().includes(q));
    return okF && okQ;
  };

  const openBets = state.bets.filter(b => b.outcome === "In corso" && match(b));
  const closedBets = state.bets.filter(b => b.outcome !== "In corso" && match(b));

  renderBetList("listOpen", openBets, true);
  renderBetList("listClosed", closedBets, false);

  // Giorni
  renderDays(state);

  // stats (chiuse)
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
  const roi = stakedClosed > 0 ? (profitClosed / stakedClosed) * 100 : 0;

  if ($("sTotal")) $("sTotal").textContent = total;
  if ($("sClosed")) $("sClosed").textContent = closed;
  if ($("sWR")) $("sWR").textContent = pct(wr);
  if ($("sStaked")) $("sStaked").textContent = money(stakedClosed);
  if ($("sProfit")) $("sProfit").textContent = money(profitClosed);
  if ($("sROI")) $("sROI").textContent = pct(roi);

  // charts
  if ($("cBank")) drawLineChart($("cBank"), state.bankrollClosedPoints || [Number(state.budgetStart||0)]);
  if ($("cPie")) drawPie($("cPie"), [wins, losses, voids], ["Vinte","Perse","Void"]);
  if ($("cTip")) drawBarsSigned($("cTip"), tipsterProfitPairs(state).slice(0, 10));

  renderTipster(state);
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
        <span>Tipster: <b>${escapeHtml(b.tipster || "-")}</b></span>
        <span>Quota: <b>${Number(b.odds||0).toFixed(2)}</b></span>
        <span>Puntata: <b>${money(b.stakeUsed||0)}</b></span>
        <span>Vincita: <b>${money(b.winGross||0)}</b></span>
        ${isOpen ? `<span>Disp.: <b>${money(b.budgetAfter||0)}</b></span>` : `<span>Profitto: <b>${money(b.profit||0)}</b></span>`}
      </div>
      <div class="itemActions">
        ${isOpen ? `
          <button class="miniBtn win" data-act="win">Vinta</button>
          <button class="miniBtn lose" data-act="lose">Persa</button>
          <button class="miniBtn void" data-act="void">Void</button>
        ` : ``}
        <button class="miniBtn edit" data-act="edit">Modifica</button>
      </div>
    `;

    el.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", (ev)=>{
        ev.stopPropagation();
        const act = btn.getAttribute("data-act");
        if (act === "edit") return openEdit(b.id);
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

    // Dentro al body: lista scommesse di quel giorno (con quick close se in corso)
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
      </div>
    `;

    el.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", (ev)=>{
        ev.stopPropagation();
        const act = btn.getAttribute("data-act");
        if (act === "edit") return openEdit(b.id);
        if (act === "win") return setOutcome(b.id, "Vinta");
        if (act === "lose") return setOutcome(b.id, "Persa");
        if (act === "void") return setOutcome(b.id, "Void");
      });
    });

    el.addEventListener("click", ()=>openEdit(b.id));
    containerEl.appendChild(el);
  }
}

function setBudget(){
  const state = load();
  const v = Number($("inpBudget").value || 0);
  state.budgetStart = Math.max(0, v);
  save(state);
  render();
}

function addBet(){
  const state = load();

  const b = normalizeBet({
    id: uid(),
    date: $("fDate").value || todayISO(),
    tipster: ($("fTipster").value || "").trim(),
    desc: ($("fDesc").value || "").trim(),
    odds: Number($("fOdds").value || 0),
    stakePct: Number($("fStakePct").value || 0),
    stakeAmt: Number($("fStakeAmt").value || 0),
    outcome: $("fOutcome").value || "In corso"
  });

  if (!b.odds || b.odds <= 1) { alert("Inserisci una quota valida (es. 1.50)"); return; }

  state.bets.unshift(b);

  $("fDesc").value = "";
  $("fOdds").value = "";
  $("fStakePct").value = "";
  $("fStakeAmt").value = "";
  $("fOutcome").value = "In corso";

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
  if (!confirm("Reset totale? Cancella scommesse e budget.")) return;
  save(structuredClone(DEFAULT));
  render();
}

// --- Modal edit
let editingId = null;

function openEdit(id){
  const state = load();
  const b = state.bets.find(x=>x.id===id);
  if (!b) return;

  editingId = id;
  $("eDate").value = b.date || todayISO();
  $("eTipster").value = b.tipster || "";
  $("eDesc").value = b.desc || "";
  $("eOdds").value = Number(b.odds||0);
  $("eStakePct").value = Number(b.stakePct||0);
  $("eStakeAmt").value = Number(b.stakeAmt||0);
  $("eOutcome").value = b.outcome || "In corso";

  $("modal").classList.add("show");
}

function closeEdit(){
  editingId = null;
  $("modal").classList.remove("show");
}

function saveEdit(){
  const state = load();
  const b = state.bets.find(x=>x.id===editingId);
  if (!b) return;

  b.date = $("eDate").value || todayISO();
  b.tipster = ($("eTipster").value || "").trim();
  b.desc = ($("eDesc").value || "").trim();
  b.odds = Number($("eOdds").value || 0);
  b.stakePct = Number($("eStakePct").value || 0);
  b.stakeAmt = Number($("eStakeAmt").value || 0);
  b.outcome = $("eOutcome").value || "In corso";

  if (!b.odds || b.odds <= 1) { alert("Quota non valida"); return; }

  save(state);
  closeEdit();
  render();
}

function deleteBet(){
  const state = load();
  const idx = state.bets.findIndex(x=>x.id===editingId);
  if (idx < 0) return;

  if (!confirm("Eliminare questa scommessa?")) return;
  state.bets.splice(idx,1);
  save(state);
  closeEdit();
  render();
}

// --- Backup
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

// --- Import
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

    // Merge: dedupe by id
    const ids = new Set(current.bets.map(b=>b.id));
    const merged = current.bets.slice();

    for (const b of incoming.bets) {
      const bet = normalizeBet(b);
      if (!bet.id || ids.has(bet.id)) {
        bet.id = uid();
      }
      ids.add(bet.id);
      merged.push(bet);
    }

    // budgetStart: se il tuo è 0 e l'import ha un valore, prendilo
    if ((Number(current.budgetStart||0) === 0) && Number(incoming.budgetStart||0) > 0) {
      current.budgetStart = incoming.budgetStart;
    }

    current.bets = merged;
    const finalState = normalizeState(current);
    save(finalState);
    render();
    alert("Import completato (unione).");
  };

  reader.readAsText(file);
}

// ---------------------------
// Tipster page
// ---------------------------
function renderTipster(state){
  const box = $("tipList");
  if (!box) return;

  const closed = state.bets.filter(b => b.outcome !== "In corso");

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
  const closed = state.bets.filter(b => b.outcome !== "In corso");
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
  $("btnImport")?.addEventListener("click", ()=> $("fileImport").click());
  $("fileImport")?.addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if (f) importFromFile(f);
    e.target.value = "";
  });

  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=> showPage(btn.dataset.page));
  });

  $("btnTipRefresh")?.addEventListener("click", render);

  render();
}
init();
