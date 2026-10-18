(() => {
  const THEME_KEY = "ikasi-theme";
  const WRITE_KEY_STORAGE = "ikasi-write-key";
  const PROGRESS_STORAGE = "ikasi-local-progress";
  const $ = (q, root=document) => root.querySelector(q);
  const $$ = (q, root=document) => [...root.querySelectorAll(q)];
  const clone = obj => JSON.parse(JSON.stringify(obj));

  const config = window.IKASI_CONFIG || {};
  const API_URL = String(config.API_URL || "").trim();
  const apiConfigured = API_URL && !API_URL.includes("PEGA_AQUI");

  let data = clone(window.IKASI_DEFAULT_DATA);
  let sourceState = apiConfigured ? "loading" : "local";
  let sourceUpdatedAt = null;
  let adminMessage = "";
  let weekOffset = 0;

  function loadProgress(){
    try { return JSON.parse(localStorage.getItem(PROGRESS_STORAGE) || "{}"); }
    catch { return {}; }
  }
  function saveProgress(map){
    localStorage.setItem(PROGRESS_STORAGE, JSON.stringify(map));
  }
  function applyLocalProgress(){
    const p = loadProgress();
    data.schedule.forEach(t => {
      if (Object.prototype.hasOwnProperty.call(p, t.id)) t.completed = !!p[t.id];
    });
  }
  function rememberProgress(id, value){
    const p = loadProgress();
    p[id] = !!value;
    saveProgress(p);
  }

  async function fetchRemoteData(){
    if(!apiConfigured){
      sourceState = "local";
      applyLocalProgress();
      renderAll();
      return false;
    }
    sourceState = "loading";
    renderAdmin();
    try{
      const sep = API_URL.includes("?") ? "&" : "?";
      const res = await fetch(`${API_URL}${sep}_=${Date.now()}`, {cache:"no-store", redirect:"follow"});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const remote = await res.json();
      if(!remote || remote.ok !== true || !Array.isArray(remote.schedule)) throw new Error(remote?.error || "Respuesta no válida");

      data = {
        subjects: remote.subjects || {},
        schedule: remote.schedule || [],
        fixedDays: remote.fixedDays || {},
        settings: remote.settings || {}
      };
      sourceState = "remote";
      sourceUpdatedAt = remote.updatedAt || null;
      applyLocalProgress();
      renderAll();
      return true;
    }catch(err){
      console.warn("Ikasi: no se pudo cargar Google Sheets", err);
      data = clone(window.IKASI_DEFAULT_DATA);
      applyLocalProgress();
      sourceState = "fallback";
      adminMessage = `No se pudo leer Google Sheets: ${String(err && err.message ? err.message : err)}. Se está usando la copia incluida en GitHub.`;
      renderAll();
      return false;
    }
  }

  async function syncCompleted(id, completed){
    const key = localStorage.getItem(WRITE_KEY_STORAGE) || "";
    if(!apiConfigured || !key) return {ok:false, localOnly:true};
    try{
      const res = await fetch(API_URL, {
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body:JSON.stringify({action:"setCompleted", id, completed, key}),
        redirect:"follow"
      });
      const out = await res.json();
      if(!out.ok) throw new Error(out.error || "No se pudo sincronizar");
      return out;
    }catch(err){
      console.warn("Ikasi: fallo al sincronizar check", err);
      return {ok:false, error:String(err.message || err)};
    }
  }

  const pad = n => String(n).padStart(2,"0");
  function localDateKey(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function parseDateKey(s){ const [y,m,d]=String(s).split("-").map(Number); return new Date(y,m-1,d); }
  function formatDate(s, opts={weekday:"long", day:"numeric", month:"long"}){
    return new Intl.DateTimeFormat("es-ES", opts).format(parseDateKey(s));
  }
  function fmtMinutes(min){
    min = Number(min)||0;
    const h=Math.floor(min/60), m=min%60;
    if(h && m) return `${h} h ${m} min`;
    if(h) return `${h} h`;
    return `${m} min`;
  }
  function todayKey(){
    const now=new Date(), key=localDateKey(now);
    const start=data.settings?.startDate || "2026-10-19";
    const end=data.settings?.endDate || "2026-11-13";
    if(key < start) return start;
    if(key > end) return end;
    return key;
  }
  function subj(id){ return data.subjects[id] || {name:id,short:id,color:"#cbd5e1",exam:""}; }
  function tasksForDate(date){ return data.schedule.filter(t=>t.date===date).sort((a,b)=>a.id.localeCompare(b.id)); }
  function totalMinutes(tasks){ return tasks.reduce((a,t)=>a+(Number(t.minutes)||0),0); }
  function doneMinutes(tasks){ return tasks.filter(t=>t.completed).reduce((a,t)=>a+(Number(t.minutes)||0),0); }
  function examDate(s){ return s ? new Date(s) : null; }
  function nextExam(from=new Date()){
    return Object.entries(data.subjects).map(([id,s])=>({id,...s,date:examDate(s.exam)}))
      .filter(x=>x.date && !isNaN(x.date) && x.date>=from).sort((a,b)=>a.date-b.date)[0] || null;
  }
  function daysBetween(a,b){
    const A=new Date(a.getFullYear(),a.getMonth(),a.getDate());
    const B=new Date(b.getFullYear(),b.getMonth(),b.getDate());
    return Math.ceil((B-A)/86400000);
  }
  function escapeHTML(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
  function capitalize(s){ return s.charAt(0).toUpperCase()+s.slice(1); }

  function taskHTML(t){
    const s=subj(t.subject);
    return `
      <article class="task ${t.completed?"done":""}" style="--subject:${s.color}">
        <button class="check" data-toggle="${escapeHTML(t.id)}" aria-label="Marcar ${t.completed?"pendiente":"hecho"}">${t.completed?"✓":""}</button>
        <div>
          <div class="task-title">${escapeHTML(t.title)}</div>
          <div class="task-desc">${escapeHTML(t.description||"")}</div>
        </div>
        <div class="task-meta"><div class="minutes">${fmtMinutes(t.minutes)}</div><div class="subject-name">${escapeHTML(s.short)}</div></div>
      </article>`;
  }

  function renderToday(){
    const view=$("#view-today");
    const key=todayKey(), tasks=tasksForDate(key);
    const total=totalMinutes(tasks), done=doneMinutes(tasks), pct=total?Math.round(done/total*100):0;
    const exam=nextExam(parseDateKey(key));
    let examBlock="";
    if(exam){
      const d=daysBetween(parseDateKey(key),exam.date);
      examBlock=`<div class="card exam-card"><div><div class="eyebrow">PRÓXIMO EXAMEN</div><div class="exam-name">${escapeHTML(exam.short)}</div></div><div><div class="exam-count">${d===0?"HOY":d}</div><div class="muted">${d===0?"":d===1?"día":"días"} · ${new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"short"}).format(exam.date)}</div></div></div>`;
    }
    const sourceBadge = sourceState==="remote" ? "Google Sheets" : sourceState==="loading" ? "Cargando…" : "Copia local";
    view.innerHTML=`
      <div class="hero">
        <div class="card">
          <div class="eyebrow">PLAN DE HOY · ${sourceBadge}</div>
          <h1>${capitalize(formatDate(key))}</h1>
          <div class="muted">${done?`${fmtMinutes(done)} completados de ${fmtMinutes(total)}`:`${fmtMinutes(total)} previstos`}</div>
          <div class="bar" style="margin-top:16px"><span style="width:${pct}%;background:var(--accent)"></span></div>
          ${data.fixedDays?.[key]?`<div class="fixed-note">${escapeHTML(data.fixedDays[key])}</div>`:""}
        </div>
        ${examBlock}
      </div>
      <div class="section-title"><h2>Bloques de estudio</h2><span class="pill">${pct}% completado</span></div>
      <div class="task-list">${tasks.length?tasks.map(taskHTML).join(""):`<div class="empty">No hay bloques de estudio programados para este día.</div>`}</div>
      <div class="install-hint">El horario maestro se edita en Google Sheets. Los checks se guardan localmente y, si configuras la clave en <b>Admin</b>, también se sincronizan con el Sheet.</div>`;
    $$('[data-toggle]',view).forEach(btn=>btn.onclick=()=>toggleTask(btn.dataset.toggle));
  }

  function startOfWeek(date){ const d=new Date(date); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); d.setHours(0,0,0,0); return d; }
  function renderCalendar(){
    const view=$("#view-calendar");
    const base=startOfWeek(parseDateKey(todayKey())); base.setDate(base.getDate()+weekOffset*7);
    const days=Array.from({length:7},(_,i)=>{const d=new Date(base);d.setDate(base.getDate()+i);return d;});
    const nowKey=todayKey();
    const cards=days.map(d=>{
      const key=localDateKey(d), tasks=tasksForDate(key);
      return `<article class="day-card ${key===nowKey?"today":""}">
        <div class="day-head"><div><div class="day-name">${new Intl.DateTimeFormat("es-ES",{weekday:"short"}).format(d).toUpperCase()}</div><div class="day-date">${new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"short"}).format(d)}</div></div><div class="pill">${fmtMinutes(totalMinutes(tasks))}</div></div>
        ${tasks.map(t=>{const s=subj(t.subject);return `<div class="mini-task ${t.completed?"done":""}" style="--subject:${s.color}"><strong>${escapeHTML(s.short)} · ${fmtMinutes(t.minutes)}</strong>${escapeHTML(t.title)}</div>`;}).join("")}
        ${data.fixedDays?.[key]?`<div class="mini-fixed">${escapeHTML(data.fixedDays[key])}</div>`:""}
        ${!tasks.length&&!data.fixedDays?.[key]?`<div class="muted" style="font-size:12px">Sin planificación.</div>`:""}
      </article>`;
    }).join("");
    const label=`${new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"short"}).format(days[0])} – ${new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"short",year:"numeric"}).format(days[6])}`;
    view.innerHTML=`<div class="week-nav"><button class="btn" id="prevWeek">←</button><div class="week-label">${label}</div><button class="btn" id="nextWeek">→</button></div><div class="calendar-grid">${cards}</div>`;
    $("#prevWeek").onclick=()=>{weekOffset--;renderCalendar();};
    $("#nextWeek").onclick=()=>{weekOffset++;renderCalendar();};
  }

  function renderProgress(){
    const view=$("#view-progress");
    const bySubject=Object.keys(data.subjects).map(id=>{
      const tasks=data.schedule.filter(t=>t.subject===id),total=totalMinutes(tasks),done=doneMinutes(tasks),pct=total?Math.round(done/total*100):0;
      return {id,total,done,pct};
    });
    const total=totalMinutes(data.schedule),done=doneMinutes(data.schedule),pct=total?Math.round(done/total*100):0;
    const cards=bySubject.map(x=>{const s=subj(x.id),exam=examDate(s.exam);return `<div class="card progress-card" style="--subject:${s.color}"><div class="progress-title">${escapeHTML(s.short)}</div><div class="progress-row"><span>Hecho</span><strong>${fmtMinutes(x.done)}</strong></div><div class="progress-row"><span>Planificado</span><strong>${fmtMinutes(x.total)}</strong></div><div class="bar"><span style="width:${x.pct}%"></span></div><div class="progress-row"><span>Progreso</span><strong>${x.pct}%</strong></div><div class="muted" style="font-size:12px">Examen · ${exam&&!isNaN(exam)?new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"long"}).format(exam):"—"}</div></div>`;}).join("");
    view.innerHTML=`<div class="section-title"><h2>Progreso por asignatura</h2><span class="pill">${pct}% global</span></div><div class="progress-grid">${cards}</div><div class="overall-grid"><div class="card"><div class="eyebrow">TOTAL DEL PLAN</div><div class="big-number">${fmtMinutes(total)}</div><div class="muted">horas de estudio planificadas</div></div><div class="card"><div class="eyebrow">COMPLETADO</div><div class="big-number">${fmtMinutes(done)}</div><div class="bar" style="margin-top:14px"><span style="width:${pct}%;background:var(--accent)"></span></div></div></div>`;
  }

  function renderAdmin(){
    const view=$("#view-admin");
    if(!view) return;
    const keySaved=!!localStorage.getItem(WRITE_KEY_STORAGE);
    const status = sourceState==="remote" ? "Conectado a Google Sheets" : sourceState==="loading" ? "Conectando…" : sourceState==="fallback" ? "Usando copia local (fallo de conexión)" : "Usando copia local";
    const updated = sourceUpdatedAt ? `<div class="muted" style="font-size:12px;margin-top:6px">Última versión leída: ${new Intl.DateTimeFormat("es-ES",{dateStyle:"medium",timeStyle:"short"}).format(new Date(sourceUpdatedAt))}</div>` : "";
    view.innerHTML=`
      <div class="section-title"><h2>Admin · Google Sheets</h2><span class="pill">${escapeHTML(status)}</span></div>
      <div class="overall-grid">
        <div class="card">
          <div class="eyebrow">HORARIO MAESTRO</div>
          <div class="progress-title" style="margin-top:8px">Editar en Google Sheets</div>
          <div class="muted">Fecha, asignatura, minutos, título, descripción y bloques nuevos se cambian en el Sheet privado. La web solo los lee.</div>
          ${updated}
          <div class="admin-toolbar" style="margin-top:16px"><button class="btn primary" id="reloadRemote">Recargar desde Sheets</button></div>
        </div>
        <div class="card">
          <div class="eyebrow">SINCRONIZACIÓN DE CHECKS</div>
          <div class="progress-title" style="margin-top:8px">Clave de escritura</div>
          <div class="muted">La clave se guarda solo en este navegador y nunca se sube a GitHub.</div>
          <label style="margin-top:14px">WRITE_KEY
            <input id="writeKeyInput" type="password" autocomplete="off" placeholder="${keySaved?"Clave guardada en este dispositivo":"Pega la clave generada en Apps Script"}">
          </label>
          <div class="admin-toolbar"><button class="btn primary" id="saveWriteKey">Guardar clave</button><button class="btn ghost" id="clearWriteKey">Borrar clave</button></div>
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <div class="eyebrow">SEGURIDAD</div>
        <div class="muted" style="margin-top:8px">El repositorio público conoce únicamente la URL del Apps Script. El Google Sheet permanece privado. El endpoint de lectura no modifica datos; para marcar bloques como hechos hace falta la WRITE_KEY.</div>
        ${!apiConfigured?`<div class="fixed-note">Falta pegar la URL /exec en <b>config.js</b>.</div>`:""}
        ${adminMessage?`<div class="fixed-note">${escapeHTML(adminMessage)}</div>`:""}
        <div class="admin-toolbar" style="margin-top:16px"><button class="btn" id="clearLocalProgress">Borrar checks locales</button></div>
      </div>`;

    const reload=$("#reloadRemote"); if(reload) reload.onclick=async()=>{adminMessage="Recargando…";renderAdmin();await fetchRemoteData();adminMessage=sourceState==="remote"?"Datos recargados desde Google Sheets.":adminMessage;renderAdmin();};
    const save=$("#saveWriteKey"); if(save) save.onclick=()=>{const v=$("#writeKeyInput").value.trim();if(!v){adminMessage="Pega primero la WRITE_KEY.";}else{localStorage.setItem(WRITE_KEY_STORAGE,v);adminMessage="Clave guardada en este dispositivo.";}renderAdmin();};
    const clear=$("#clearWriteKey"); if(clear) clear.onclick=()=>{localStorage.removeItem(WRITE_KEY_STORAGE);adminMessage="Clave eliminada de este dispositivo.";renderAdmin();};
    const clearProgress=$("#clearLocalProgress"); if(clearProgress) clearProgress.onclick=()=>{if(confirm("¿Borrar los checks guardados localmente?")){localStorage.removeItem(PROGRESS_STORAGE);adminMessage="Checks locales borrados.";fetchRemoteData();}};
  }

  async function toggleTask(id){
    const t=data.schedule.find(x=>x.id===id); if(!t) return;
    t.completed=!t.completed;
    rememberProgress(id,t.completed);
    renderAll();
    const result=await syncCompleted(id,t.completed);
    if(result.ok){
      adminMessage="Último check sincronizado con Google Sheets.";
    }else if(result.localOnly){
      adminMessage="Check guardado solo en este dispositivo: configura la WRITE_KEY para sincronizar.";
    }else{
      adminMessage="El check queda guardado localmente, pero no se pudo sincronizar con Google Sheets.";
    }
    renderAdmin();
  }

  function renderAll(){ renderToday();renderCalendar();renderProgress();renderAdmin(); }

  $$(".tab").forEach(btn=>btn.onclick=()=>{
    $$(".tab").forEach(x=>x.classList.toggle("active",x===btn));
    $$(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${btn.dataset.view}`));
  });

  function initTheme(){
    const saved=localStorage.getItem(THEME_KEY);
    const dark=saved?saved==="dark":matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme=dark?"dark":"light";
  }
  $("#themeToggle").onclick=()=>{const next=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=next;localStorage.setItem(THEME_KEY,next);};
  initTheme();

  if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));}
  applyLocalProgress();
  renderAll();
  fetchRemoteData();
})();
