// --- PWA offline
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

const $ = (id) => document.getElementById(id);
const money = (n) => "€ " + (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
const pct = (n) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2) + "%";
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

const KEY = "ts_v1";
const DEFAULT = { budgetStart: 0, bets: [] };

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || structuredClone(DEFAULT); }
  catch { return structuredClone(DEFAULT); }
}
function save(state) { localStorage.setItem(KEY, JSON.stringify(state)); }

function todayISO(){
  const d = new Date();
  const z = (n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
}

function calcStakeAmount(budgetBefore, stakePct, stakeAmt) {
  const a = Number(stakeAmt || 0);
  if (a > 0) return a;
  const p = Number(stakePct || 0);
  if (p > 0) return budgetBefore * (p / 100);
  return 0;
}

// Ricalcolo "a scalare" su tutta la lista
function recompute(state){
  let budget = Number(state.budgetStart || 0);

  for (const b of state.bets) {
    b.budgetBefore = budget;

    b.stakeUsed = calcStakeAmount(budget, b.stakePct, b.stakeAmt);
    b.stakeUsed = Math.max(0, b.stakeUsed);

    // scalata immediata
    budget = budget - b.stakeUsed;

    const odds = Number(b.odds || 0);
    b.winGross = b.stakeUsed * odds;

    // chiusura: aggiunte sul budget
    if (b.outcome === "Vinta") {
      budget += b.winGross;
      b.profit = b.stakeUsed * (odds - 1);
    } else if (b.outcome === "Void") {
      budget += b.stakeUsed;
      b.profit = 0;
    } else if (b.outcome === "Persa") {
      b.profit = -b.stakeUsed;
    } else {
      // In corso: profitto non realizzato (0)
      b.profit = 0;
    }

    b.budgetAfter = budget;
  }

  state.budgetNow = budget;
  return state;
}

function badgeClass(outcome){
  if (outcome === "Vinta") return "out-win";
  if (outcome === "Persa") return "out-lose";
  if (outcome === "Void") return "out-void";
  return "out-in";
}

function render(){
  let state = recompute(load());
  save(state);

  $("budgetStart").textContent = money(state.budgetStart || 0);
  $("budgetNow").textContent = money(state.budgetNow || 0);

  // Lista
  const filt = $("filterOutcome").value;
  const q = ($("search").value || "").trim().toLowerCase();

  const bets = state.bets.filter(b => {
    const okF = (filt === "Tutte") || (b.outcome === filt);
    const okQ = !q || (String(b.tipster||"").toLowerCase().includes(q) || String(b.desc||"").toLowerCase().includes(q));
    return okF && okQ;
  });

  const list = $("list");
  list.innerHTML = "";

  if (!bets.length) {
    list.innerHTML = `<div class="hint">Nessuna giocata trovata.</div>`;
  }

  for (const b of bets) {
    const el = document.createElement("div");
    el.className = `item ${badgeClass(b.outcome)}`;
    el.innerHTML = `
      <div class="row between">
        <div class="t1">${b.desc || "(senza descrizione)"}</div>
        <div class="badge">${b.outcome}</div>
      </div>
      <div class="t2">
        <span>${b.date || ""}</span>
        <span>Tipster: <b>${b.tipster || "-"}</b></span>
        <span>Quota: <b>${Number(b.odds||0).toFixed(2)}</b></span>
        <span>Puntata: <b>${money(b.stakeUsed||0)}</b></span>
        <span>Vincita: <b>${money(b.winGross||0)}</b></span>
        <span>Budget: <b>${money(b.budgetAfter||0)}</b></span>
      </div>
    `;
    el.addEventListener("click", ()=>openEdit(b.id));
    list.appendChild(el);
  }

  // Statistiche
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

  $("sTotal").textContent = total;
  $("sClosed").textContent = closed;
  $("sWR").textContent = pct(wr);
  $("sStaked").textContent = money(stakedClosed);
  $("sProfit").textContent = money(profitClosed);
  $("sROI").textContent = pct(roi);

  drawCharts(state);
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

  const b = {
    id: uid(),
    date: $("fDate").value || todayISO(),
    tipster: $("fTipster").value.trim(),
    desc: $("fDesc").value.trim(),
    odds: Number($("fOdds").value || 0),
    stakePct: Number($("fStakePct").value || 0),
    stakeAmt: Number($("fStakeAmt").value || 0),
    outcome: $("fOutcome").value || "In corso"
  };

  if (!b.odds || b.odds <= 1) { alert("Inserisci una quota valida (es. 1.50)"); return; }

  // Inserisci
  state.bets.unshift(b);

  // pulizia campi veloci
  $("fDesc").value = "";
  $("fOdds").value = "";
  $("fStakePct").value = "";
  $("fStakeAmt").value = "";
  $("fOutcome").value = "In corso";

  save(state);
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
  b.tipster = $("eTipster").value.trim();
  b.desc = $("eDesc").value.trim();
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

  if (!confirm("Eliminare questa giocata?")) return;
  state.bets.splice(idx,1);
  save(state);
  closeEdit();
  render();
}

function resetAll(){
  if (!confirm("Reset totale? Cancella giocate e budget.")) return;
  save(structuredClone(DEFAULT));
  render();
}

// --- Backup / restore
function backup(){
  const state = load();
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tracker-scommesse-backup-${todayISO()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
  alert("Backup scaricato. Conservalo in File/iCloud.");
}

// --- Chart helpers (canvas, leggero e offline)
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

  // background
  ctx.fillStyle = "rgba(0,0,0,.10)";
  ctx.fillRect(0,0,W,H);

  if (points.length < 2) {
    drawText(ctx, 16, 28, "Aggiungi almeno 2 giocate per vedere il grafico.", 13, true);
    return;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = (max-min) || 1;

  // axes
  ctx.strokeStyle = "rgba(255,255,255,.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, H-pad);
  ctx.lineTo(W-pad, H-pad);
  ctx.stroke();

  // line
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
    drawText(ctx, 16, 28, "Nessuna giocata chiusa.", 13, true);
    return;
  }

  const cx = 160, cy = 120, r = 80;
  const colors = [
    "rgba(52,211,153,.95)", // win
    "rgba(248,113,113,.95)", // lose
    "rgba(148,163,184,.95)"  // void
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

  // legend
  labels.forEach((lab,i)=>{
    const x = 300, y = 70 + i*28;
    ctx.fillStyle = colors[i];
    ctx.fillRect(x, y-12, 14, 14);
    ctx.fillStyle = "rgba(232,237,247,.92)";
    drawText(ctx, x+22, y, `${lab}: ${values[i]}`, 13, true);
  });
}

function drawBars(canvas, pairs){
  const ctx = clearCanvas(canvas);
  const W = canvas.width, H = canvas.height;
  const pad = 34;
  ctx.fillStyle = "rgba(0,0,0,.10)";
  ctx.fillRect(0,0,W,H);

  if (!pairs.length){
    drawText(ctx, 16, 28, "Nessuna giocata chiusa con tipster.", 13, true);
    return;
  }

  const vals = pairs.map(p=>p.value);
  const max = Math.max(...vals, 1);
  const bw = (W-2*pad) / Math.max(1, pairs.length);

  // axes
  ctx.strokeStyle = "rgba(255,255,255,.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, H-pad);
  ctx.lineTo(W-pad, H-pad);
  ctx.stroke();

  pairs.forEach((p,i)=>{
    const x = pad + i*bw + 10;
    const h = (p.value/max) * (H-2*pad);
    const y = (H-pad) - h;

    ctx.fillStyle = "rgba(43,124,255,.85)";
    ctx.fillRect(x, y, Math.max(8, bw-20), h);

    ctx.fillStyle = "rgba(232,237,247,.92)";
    drawText(ctx, x, H-pad+18, p.label.slice(0,10), 11, true);
  });
}

function drawCharts(state){
  // Bankroll points: start + after each bet
  const points = [Number(state.budgetStart||0)];
  state.bets.slice().reverse().forEach(b => points.push(Number(b.budgetAfter||0)));
  drawLineChart($("cBank"), points);

  const closed = state.bets.filter(b => b.outcome !== "In corso");
  const w = closed.filter(b=>b.outcome==="Vinta").length;
  const l = closed.filter(b=>b.outcome==="Persa").length;
  const v = closed.filter(b=>b.outcome==="Void").length;
  drawPie($("cPie"), [w,l,v], ["Vinte","Perse","Void"]);

  const byTip = new Map();
  closed.forEach(b=>{
    const t = (b.tipster||"Senza tipster").trim() || "Senza tipster";
    byTip.set(t, (byTip.get(t)||0) + Number(b.profit||0));
  });
  const pairs = Array.from(byTip.entries())
    .map(([label,value])=>({label,value}))
    .sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))
    .slice(0,8);

  // per grafico "assoluto": valori negativi tagliati? (semplice)
  // Qui mostro solo profitti >= 0 per pulizia; se vuoi includo anche negativi con barre rosse.
  const nonNeg = pairs.map(p=>({label:p.label,value:Math.max(0,p.value)}));
  drawBars($("cTip"), nonNeg);
}

// --- Init
function init(){
  $("fDate").value = todayISO();

  $("btnSetBudget").addEventListener("click", setBudget);
  $("btnAdd").addEventListener("click", addBet);
  $("btnReset").addEventListener("click", resetAll);

  $("filterOutcome").addEventListener("change", render);
  $("search").addEventListener("input", render);

  $("btnClose").addEventListener("click", closeEdit);
  $("modal").addEventListener("click", (e)=>{ if(e.target.id==="modal") closeEdit(); });
  $("btnSave").addEventListener("click", saveEdit);
  $("btnDelete").addEventListener("click", deleteBet);

  $("btnBackup").addEventListener("click", backup);

  render();
}
init();
