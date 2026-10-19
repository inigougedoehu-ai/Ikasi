(async () => {
  const THEME_KEY = "ikasi-theme";
  const ACCESS_KEY_STORAGE = "ikasi-access-key";
  const PROGRESS_STORAGE = "ikasi-local-progress";
  const KEY_DB = "ikasi-device";
  const KEY_STORE = "settings";
  const KEY_ID = "access-key";

  const $ = (q, root=document) => root.querySelector(q);
  const $$ = (q, root=document) => [...root.querySelectorAll(q)];
  const clone = obj => JSON.parse(JSON.stringify(obj));

  const config = window.IKASI_CONFIG || {};
  const API_URL = String(config.API_URL || "").trim();
  const apiConfigured = API_URL && !API_URL.includes("PEGA_AQUI");

  let data = clone(window.IKASI_DEFAULT_DATA);
  let sourceState = "locked";
  let sourceUpdatedAt = null;
  let adminMessage = "";
  let weekOffset = 0;

  function openKeyDb(){
    return new Promise((resolve,reject)=>{
      if(!("indexedDB" in window)) return reject(new Error("IndexedDB no disponible"));
      const req=indexedDB.open(KEY_DB,1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error || new Error("No se pudo abrir IndexedDB"));
    });
  }

  async function idbGetKey(){
    try{
      const db=await openKeyDb();
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(KEY_STORE,"readonly");
        const req=tx.objectStore(KEY_STORE).get(KEY_ID);
        req.onsuccess=()=>resolve(String(req.result || ""));
        req.onerror=()=>reject(req.error);
        tx.oncomplete=()=>db.close();
      });
    }catch{
      return "";
    }
  }

  async function idbSetKey(key){
    try{
      const db=await openKeyDb();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(KEY_STORE,"readwrite");
        tx.objectStore(KEY_STORE).put(String(key),KEY_ID);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
      });
      db.close();
    }catch{}
  }

  async function idbClearKey(){
    try{
      const db=await openKeyDb();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(KEY_STORE,"readwrite");
        tx.objectStore(KEY_STORE).delete(KEY_ID);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
      });
      db.close();
    }catch{}
  }

  async function getAccessKey(){
    try{
      const local=localStorage.getItem(ACCESS_KEY_STORAGE) || "";
      if(local) return local;
    }catch{}
    const durable=await idbGetKey();
    if(durable){
      try{ localStorage.setItem(ACCESS_KEY_STORAGE,durable); }catch{}
    }
    return durable;
  }

  async function setAccessKey(key){
    try{ localStorage.setItem(ACCESS_KEY_STORAGE,key); }catch{}
    await idbSetKey(key);
    try{
      if(navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    }catch{}
  }

  async function clearAccessKey(){
    try{ localStorage.removeItem(ACCESS_KEY_STORAGE); }catch{}
    await idbClearKey();
  }

  function showLoading(message="Comprobando acceso…"){
    sourceState = "loading";
    $("#appShell").hidden = true;
    $("#authGate").hidden = true;
    $("#loadingGate").hidden = false;
    $("#loadingStatus").textContent = message;
  }

  function showLocked(message=""){
    sourceState = "locked";
    $("#loadingGate").hidden = true;
    $("#appShell").hidden = true;
    $("#authGate").hidden = false;
    $("#authError").textContent = message;
    const input = $("#authKey");
    if(input) input.value = "";
  }

  function showApp(){
    $("#loadingGate").hidden = true;
    $("#authGate").hidden = true;
    $("#appShell").hidden = false;
  }

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
      t.actualMinutes = Math.max(0, Number(t.actualMinutes) || 0);
      const local = p[t.id];
      if(local && typeof local === "object" && local.pending){
        if(Object.prototype.hasOwnProperty.call(local,"completed")) t.completed = !!local.completed;
        if(Object.prototype.hasOwnProperty.call(local,"actualMinutes")) t.actualMinutes = Math.max(0, Number(local.actualMinutes) || 0);
      }
    });
  }

  function rememberProgress(id, patch){
    const p = loadProgress();
    const old = (p[id] && typeof p[id] === "object") ? p[id] : {};
    p[id] = {...old, ...patch, pending:true};
    saveProgress(p);
  }

  function clearPendingProgress(id){
    const p = loadProgress();
    delete p[id];
    saveProgress(p);
  }

  async function fetchRemoteData(candidateKey=null){
    const key = String(candidateKey || await getAccessKey()).trim();

    if(!apiConfigured){
      showLocked("Falta configurar el endpoint de Google Apps Script.");
      return false;
    }

    if(!key){
      showLocked("");
      return false;
    }

    sourceState = "loading";

    try{
      const sep = API_URL.includes("?") ? "&" : "?";
      const url = `${API_URL}${sep}key=${encodeURIComponent(key)}&_=${Date.now()}`;
      const res = await fetch(url, {cache:"no-store", redirect:"follow"});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);

      const remote = await res.json();

      if(!remote || remote.ok !== true){
        if(remote && remote.error === "unauthorized"){
          await clearAccessKey();
          showLocked("Clave incorrecta.");
          return false;
        }
        throw new Error(remote?.error || "Respuesta no válida");
      }

      data = {
        subjects: remote.subjects || {},
        schedule: (remote.schedule || []).map(t=>({
          ...t,
          actualMinutes:Math.max(0,Number(t.actualMinutes)||0)
        })),
        fixedDays: remote.fixedDays || {},
        settings: remote.settings || {}
      };

      await setAccessKey(key);
      sourceState = "remote";
      sourceUpdatedAt = remote.updatedAt || null;
      applyLocalProgress();
      showApp();
      renderAll();
      if(typeof startAutoSync==="function") startAutoSync();
      return true;
    }catch(err){
      console.warn("Ikasi: no se pudo cargar Google Sheets", err);
      showLocked(`No se pudo abrir Ikasi: ${String(err && err.message ? err.message : err)}`);
      return false;
    }
  }

  async function syncProgress(id, completed, actualMinutes){
    const key = await getAccessKey();
    if(!apiConfigured || !key) return {ok:false, unauthorized:true};

    try{
      const res = await fetch(API_URL, {
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body:JSON.stringify({
          action:"setProgress",
          id,
          completed:!!completed,
          actualMinutes:Math.max(0, Math.round(Number(actualMinutes)||0)),
          key
        }),
        redirect:"follow"
      });

      const out = await res.json();

      if(out && out.error === "unauthorized"){
        await clearAccessKey();
        showLocked("La clave ya no es válida. Vuelve a introducirla.");
        return {ok:false, unauthorized:true};
      }

      if(!out.ok) throw new Error(out.error || "No se pudo sincronizar");
      clearPendingProgress(id);
      return out;
    }catch(err){
      console.warn("Ikasi: fallo al sincronizar progreso", err);
      return {ok:false, error:String(err.message || err)};
    }
  }

  const pad = n => String(n).padStart(2,"0");

  function localDateKey(d){
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }

  function parseDateKey(s){
    const [y,m,d] = String(s).split("-").map(Number);
    return new Date(y,m-1,d);
  }

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
    const start=data.settings?.startDate || key;
    const end=data.settings?.endDate || key;
    if(key < start) return start;
    if(key > end) return end;
    return key;
  }

  function subj(id){
    return data.subjects[id] || {name:id,short:id,color:"#cbd5e1",exam:""};
  }

  function tasksForDate(date){
    return data.schedule.filter(t=>t.date===date).sort((a,b)=>a.id.localeCompare(b.id));
  }

  function totalMinutes(tasks){
    return tasks.reduce((a,t)=>a+(Number(t.minutes)||0),0);
  }

  function doneMinutes(tasks){
    return tasks.filter(t=>t.completed).reduce((a,t)=>a+(Number(t.minutes)||0),0);
  }

  function actualMinutes(tasks){
    return tasks.reduce((a,t)=>a+Math.max(0,Number(t.actualMinutes)||0),0);
  }

  function adherenceMinutes(tasks){
    return tasks.reduce((a,t)=>{
      const planned=Math.max(0,Number(t.minutes)||0);
      const actual=Math.max(0,Number(t.actualMinutes)||0);
      return a+Math.min(planned,actual);
    },0);
  }

  function completedCount(tasks){
    return tasks.filter(t=>t.completed).length;
  }

  function examDate(s){
    return s ? new Date(s) : null;
  }

  function nextExam(from=new Date()){
    return Object.entries(data.subjects)
      .map(([id,s])=>({id,...s,date:examDate(s.exam)}))
      .filter(x=>x.date && !isNaN(x.date) && x.date>=from)
      .sort((a,b)=>a.date-b.date)[0] || null;
  }

  function daysBetween(a,b){
    const A=new Date(a.getFullYear(),a.getMonth(),a.getDate());
    const B=new Date(b.getFullYear(),b.getMonth(),b.getDate());
    return Math.ceil((B-A)/86400000);
  }

  function escapeHTML(s){
    return String(s??"").replace(/[&<>"']/g,c=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  function capitalize(s){
    return s.charAt(0).toUpperCase()+s.slice(1);
  }

  function taskHTML(t){
    const s=subj(t.subject);
    const actual=Math.max(0,Number(t.actualMinutes)||0);
    return `
      <article class="task ${t.completed?"done":""}" style="--subject:${s.color}">
        <button class="check" data-toggle="${escapeHTML(t.id)}" aria-label="Marcar ${t.completed?"pendiente":"hecho"}">${t.completed?"✓":""}</button>
        <div>
          <div class="task-title">${escapeHTML(t.title)}</div>
          <div class="task-desc">${escapeHTML(t.description||"")}</div>
        </div>
        <div class="task-meta">
          <div>
            <div class="time-label">Previsto</div>
            <div class="minutes">${fmtMinutes(t.minutes)}</div>
          </div>
          <button class="actual-time ${actual>0?"has-time":""}" data-time="${escapeHTML(t.id)}">
            Real · ${actual>0?fmtMinutes(actual):"—"}
          </button>
          <div class="subject-name">${escapeHTML(s.short)}</div>
        </div>
      </article>`;
  }

  function renderToday(){
    const view=$("#view-today");
    const key=todayKey(), tasks=tasksForDate(key);
    const total=totalMinutes(tasks);
    const actual=actualMinutes(tasks);
    const adherence=adherenceMinutes(tasks);
    const adherencePct=total?Math.round(adherence/total*100):0;
    const realPct=total?Math.round(actual/total*100):0;
    const sessionsDone=completedCount(tasks);
    const exam=nextExam(parseDateKey(key));

    let examBlock="";
    if(exam){
      const d=daysBetween(parseDateKey(key),exam.date);
      examBlock=`
        <div class="card exam-card">
          <div>
            <div class="eyebrow">PRÓXIMO EXAMEN</div>
            <div class="exam-name">${escapeHTML(exam.short)}</div>
          </div>
          <div>
            <div class="exam-count">${d===0?"HOY":d}</div>
            <div class="muted">${d===0?"":d===1?"día":"días"} · ${new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"short"}).format(exam.date)}</div>
          </div>
        </div>`;
    }

    view.innerHTML=`
      <div class="hero">
        <div class="card">
          <div class="eyebrow">PLAN DE HOY · GOOGLE SHEETS</div>
          <h1>${capitalize(formatDate(key))}</h1>
          <div class="muted">${fmtMinutes(actual)} reales de ${fmtMinutes(total)} previstas</div>
          <div class="bar" style="margin-top:16px">
            <span style="width:${Math.min(100,adherencePct)}%;background:var(--accent)"></span>
          </div>
          <div class="session-stats">
            <span class="stat-chip">Adherencia · ${adherencePct}%</span>
            <span class="stat-chip">Horas reales · ${realPct}%</span>
            <span class="stat-chip">Sesiones · ${sessionsDone}/${tasks.length}</span>
          </div>
          ${data.fixedDays?.[key]?`<div class="fixed-note">${escapeHTML(data.fixedDays[key])}</div>`:""}
        </div>
        ${examBlock}
      </div>

      <div class="section-title">
        <h2>Bloques de estudio</h2>
        <span class="pill">${adherencePct}% adherencia</span>
      </div>

      <div class="task-list">
        ${tasks.length?tasks.map(taskHTML).join(""):`<div class="empty">No hay bloques de estudio programados para este día.</div>`}
      </div>`;

    $$('[data-toggle]',view).forEach(btn=>{
      btn.onclick=()=>toggleTask(btn.dataset.toggle);
    });
    $$('[data-time]',view).forEach(btn=>{
      btn.onclick=()=>openTimeEditor(btn.dataset.time);
    });
  }

  function startOfWeek(date){
    const d=new Date(date);
    const day=(d.getDay()+6)%7;
    d.setDate(d.getDate()-day);
    d.setHours(0,0,0,0);
    return d;
  }

  function renderCalendar(){
    const view=$("#view-calendar");
    const base=startOfWeek(parseDateKey(todayKey()));
    base.setDate(base.getDate()+weekOffset*7);

    const days=Array.from({length:7},(_,i)=>{
      const d=new Date(base);
      d.setDate(base.getDate()+i);
      return d;
    });

    const nowKey=todayKey();

    const cards=days.map(d=>{
      const key=localDateKey(d), tasks=tasksForDate(key);
      return `
        <article class="day-card ${key===nowKey?"today":""}">
          <div class="day-head">
            <div>
              <div class="day-name">${new Intl.DateTimeFormat("es-ES",{weekday:"short"}).format(d).toUpperCase()}</div>
              <div class="day-date">${new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"short"}).format(d)}</div>
            </div>
            <div class="pill">${fmtMinutes(totalMinutes(tasks))}</div>
          </div>

          ${tasks.map(t=>{
            const s=subj(t.subject);
            const actual=Math.max(0,Number(t.actualMinutes)||0);
            return `<div class="mini-task ${t.completed?"done":""}" style="--subject:${s.color}">
              <strong>${escapeHTML(s.short)} · P ${fmtMinutes(t.minutes)} · R ${actual?fmtMinutes(actual):"—"}</strong>${escapeHTML(t.title)}
            </div>`;
          }).join("")}

          ${data.fixedDays?.[key]?`<div class="mini-fixed">${escapeHTML(data.fixedDays[key])}</div>`:""}
          ${!tasks.length&&!data.fixedDays?.[key]?`<div class="muted" style="font-size:12px">Sin planificación.</div>`:""}
        </article>`;
    }).join("");

    const label=`${new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"short"}).format(days[0])} – ${new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"short",year:"numeric"}).format(days[6])}`;

    view.innerHTML=`
      <div class="week-nav">
        <button class="btn" id="prevWeek">←</button>
        <div class="week-label">${label}</div>
        <button class="btn" id="nextWeek">→</button>
      </div>
      <div class="calendar-grid">${cards}</div>`;

    $("#prevWeek").onclick=()=>{weekOffset--;renderCalendar();};
    $("#nextWeek").onclick=()=>{weekOffset++;renderCalendar();};
  }

  function renderProgress(){
    const view=$("#view-progress");

    const bySubject=Object.keys(data.subjects).map(id=>{
      const tasks=data.schedule.filter(t=>t.subject===id);
      const total=totalMinutes(tasks);
      const actual=actualMinutes(tasks);
      const adherence=adherenceMinutes(tasks);
      const adherencePct=total?Math.round(adherence/total*100):0;
      const realPct=total?Math.round(actual/total*100):0;
      return {
        id,total,actual,adherencePct,realPct,
        completed:completedCount(tasks),
        sessions:tasks.length
      };
    });

    const total=totalMinutes(data.schedule);
    const actual=actualMinutes(data.schedule);
    const adherence=adherenceMinutes(data.schedule);
    const adherencePct=total?Math.round(adherence/total*100):0;
    const realPct=total?Math.round(actual/total*100):0;
    const sessionsDone=completedCount(data.schedule);

    const cards=bySubject.map(x=>{
      const s=subj(x.id),exam=examDate(s.exam);
      return `
        <div class="card progress-card" style="--subject:${s.color}">
          <div class="progress-title">${escapeHTML(s.short)}</div>
          <div class="progress-row"><span>Real</span><strong>${fmtMinutes(x.actual)}</strong></div>
          <div class="progress-row"><span>Planificado</span><strong>${fmtMinutes(x.total)}</strong></div>
          <div class="progress-row"><span>Sesiones</span><strong>${x.completed}/${x.sessions}</strong></div>
          <div class="bar"><span style="width:${Math.min(100,x.adherencePct)}%"></span></div>
          <div class="progress-row"><span>Adherencia</span><strong>${x.adherencePct}%</strong></div>
          <div class="progress-row"><span>Horas reales / previstas</span><strong>${x.realPct}%</strong></div>
          <div class="muted" style="font-size:12px">Examen · ${exam&&!isNaN(exam)?new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"long"}).format(exam):"—"}</div>
        </div>`;
    }).join("");

    view.innerHTML=`
      <div class="section-title">
        <h2>Progreso por asignatura</h2>
        <span class="pill">${adherencePct}% adherencia global</span>
      </div>
      <div class="progress-grid">${cards}</div>
      <div class="overall-grid">
        <div class="card">
          <div class="eyebrow">PLANIFICADO</div>
          <div class="big-number">${fmtMinutes(total)}</div>
          <div class="muted">horas previstas</div>
        </div>
        <div class="card">
          <div class="eyebrow">TIEMPO REAL</div>
          <div class="big-number">${fmtMinutes(actual)}</div>
          <div class="muted">${realPct}% de las horas previstas</div>
        </div>
        <div class="card">
          <div class="eyebrow">ADHERENCIA</div>
          <div class="big-number">${adherencePct}%</div>
          <div class="bar" style="margin-top:14px">
            <span style="width:${Math.min(100,adherencePct)}%;background:var(--accent)"></span>
          </div>
        </div>
        <div class="card">
          <div class="eyebrow">SESIONES COMPLETADAS</div>
          <div class="big-number">${sessionsDone}/${data.schedule.length}</div>
          <div class="muted">check y horas son métricas independientes</div>
        </div>
      </div>`;
  }

  function renderAdmin(){
    const view=$("#view-admin");
    if(!view) return;

    const updated = sourceUpdatedAt
      ? `<div class="muted" style="font-size:12px;margin-top:6px">Última versión leída: ${new Intl.DateTimeFormat("es-ES",{dateStyle:"medium",timeStyle:"short"}).format(new Date(sourceUpdatedAt))}</div>`
      : "";

    view.innerHTML=`
      <div class="section-title">
        <h2>Admin · Google Sheets</h2>
        <span class="pill">Acceso protegido</span>
      </div>

      <div class="overall-grid">
        <div class="card">
          <div class="eyebrow">HORARIO MAESTRO</div>
          <div class="progress-title" style="margin-top:8px">Editar en Google Sheets</div>
          <div class="muted">Fecha, asignatura, minutos previstos, título, descripción y bloques nuevos se cambian en el Sheet privado. El tiempo real también queda registrado allí.</div>
          ${updated}
          <div class="admin-toolbar" style="margin-top:16px">
            <button class="btn primary" id="reloadRemote">Recargar desde Sheets</button>
          </div>
        </div>

        <div class="card">
          <div class="eyebrow">ACCESO</div>
          <div class="progress-title" style="margin-top:8px">Clave guardada en este dispositivo</div>
          <div class="muted">La misma clave protege lectura y escritura. No está incluida en GitHub.</div>
          <div class="admin-toolbar" style="margin-top:16px">
            <button class="btn ghost" id="logoutIkasi">Cerrar sesión / olvidar clave</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="eyebrow">SEGURIDAD</div>
        <div class="muted" style="margin-top:8px">
          El repositorio público no contiene el planning. La aplicación necesita una clave válida para leer el Google Sheet y para modificar los checks.
        </div>
        ${adminMessage?`<div class="fixed-note">${escapeHTML(adminMessage)}</div>`:""}
      </div>`;

    $("#reloadRemote").onclick=async()=>{
      adminMessage="Recargando…";
      renderAdmin();
      const ok=await fetchRemoteData();
      if(ok){
        adminMessage="Datos recargados desde Google Sheets.";
        renderAdmin();
      }
    };

    $("#logoutIkasi").onclick=async()=>{
      await clearAccessKey();
      data=clone(window.IKASI_DEFAULT_DATA);
      showLocked("");
    };
  }

  async function toggleTask(id){
    const t=data.schedule.find(x=>x.id===id);
    if(!t) return;

    t.completed=!t.completed;
    if(t.completed && !(Number(t.actualMinutes)>0)){
      t.actualMinutes=Number(t.minutes)||0;
    }

    rememberProgress(id,{
      completed:t.completed,
      actualMinutes:Math.max(0,Number(t.actualMinutes)||0)
    });
    renderAll();

    const result=await syncProgress(id,t.completed,t.actualMinutes);

    if(result.ok){
      adminMessage="Progreso sincronizado con Google Sheets.";
    }else if(result.unauthorized){
      return;
    }else{
      adminMessage="El cambio queda guardado en este dispositivo, pero falta sincronizarlo con Google Sheets.";
      renderAdmin();
    }
  }

  let editingTaskId=null;

  function updateTimePreview(){
    const range=$("#timeRange");
    if(!range) return;
    $("#timeValue").textContent=fmtMinutes(Number(range.value)||0);
  }

  function openTimeEditor(id){
    const t=data.schedule.find(x=>x.id===id);
    if(!t) return;

    editingTaskId=id;
    const planned=Math.max(0,Number(t.minutes)||0);
    const actual=Math.max(0,Number(t.actualMinutes)||0);
    const max=Math.max(240,Math.ceil((planned*2)/15)*15,Math.ceil((actual+60)/15)*15);

    $("#timeDialogTitle").textContent=t.title;
    $("#timeDialogPlanned").textContent=`Previsto: ${fmtMinutes(planned)}`;
    $("#timeRange").max=String(max);
    $("#timeRange").value=String(actual);
    $("#timeCompleted").checked=!!t.completed;
    updateTimePreview();
    $("#timeDialog").showModal();
  }

  async function saveTimeEditor(){
    const t=data.schedule.find(x=>x.id===editingTaskId);
    if(!t) return;

    t.actualMinutes=Math.max(0,Number($("#timeRange").value)||0);
    t.completed=!!$("#timeCompleted").checked;

    rememberProgress(t.id,{
      completed:t.completed,
      actualMinutes:t.actualMinutes
    });

    $("#timeDialog").close();
    renderAll();

    const result=await syncProgress(t.id,t.completed,t.actualMinutes);
    if(result.ok){
      adminMessage="Tiempo real y estado sincronizados con Google Sheets.";
    }else if(!result.unauthorized){
      adminMessage="El tiempo queda guardado en este dispositivo, pero falta sincronizarlo con Google Sheets.";
      renderAdmin();
    }
  }


  function renderAll(){
    renderToday();
    renderCalendar();
    renderProgress();
    renderAdmin();
  }

  $$(".tab").forEach(btn=>{
    btn.onclick=()=>{
      $$(".tab").forEach(x=>x.classList.toggle("active",x===btn));
      $$(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${btn.dataset.view}`));
    };
  });

  $("#authForm").addEventListener("submit", async e=>{
    e.preventDefault();
    const key=$("#authKey").value.trim();

    if(!key){
      $("#authError").textContent="Introduce la clave.";
      return;
    }

    showLoading("Comprobando clave…");
    await fetchRemoteData(key);
  });

  $("#timeRange").addEventListener("input",updateTimePreview);

  $$("[data-time-delta]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const range=$("#timeRange");
      const next=Math.max(0,Math.min(Number(range.max),Number(range.value)+Number(btn.dataset.timeDelta)));
      range.value=String(next);
      updateTimePreview();
    });
  });

  $$("[data-time-quick]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const t=data.schedule.find(x=>x.id===editingTaskId);
      if(!t) return;
      const value=btn.dataset.timeQuick==="planned" ? Number(t.minutes)||0 : Number(btn.dataset.timeQuick)||0;
      const range=$("#timeRange");
      if(value>Number(range.max)) range.max=String(Math.ceil(value/15)*15);
      range.value=String(value);
      updateTimePreview();
    });
  });

  $("#clearTimeBtn").addEventListener("click",()=>{
    $("#timeRange").value="0";
    updateTimePreview();
  });

  $("#saveTimeBtn").addEventListener("click",saveTimeEditor);

  function initTheme(){
    const saved=localStorage.getItem(THEME_KEY);
    const dark=saved?saved==="dark":matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme=dark?"dark":"light";
  }

  $("#themeToggle").onclick=()=>{
    const next=document.documentElement.dataset.theme==="dark"?"light":"dark";
    document.documentElement.dataset.theme=next;
    localStorage.setItem(THEME_KEY,next);
  };

  initTheme();

  if("serviceWorker" in navigator){
    window.addEventListener("load",()=>{
      navigator.serviceWorker.register("./sw.js").catch(()=>{});
    });
  }

  let autoSyncStarted=false;

  function startAutoSync(){
    if(autoSyncStarted) return;
    autoSyncStarted=true;

    setInterval(()=>{
      if(!document.hidden && sourceState==="remote") fetchRemoteData();
    },60000);

    document.addEventListener("visibilitychange",()=>{
      if(!document.hidden && sourceState==="remote") fetchRemoteData();
    });

    window.addEventListener("focus",()=>{
      if(sourceState==="remote") fetchRemoteData();
    });
  }

  showLoading("Cargando tu planificación…");
  const savedKey=await getAccessKey();

  if(savedKey){
    const ok=await fetchRemoteData(savedKey);
    if(ok) startAutoSync();
  }else{
    showLocked("");
  }
})();
