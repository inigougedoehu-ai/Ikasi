
(() => {
  const STORAGE_KEY = "ikasi-v1-data";
  const THEME_KEY = "ikasi-theme";
  const $ = (q, root=document) => root.querySelector(q);
  const $$ = (q, root=document) => [...root.querySelectorAll(q)];

  const clone = obj => JSON.parse(JSON.stringify(obj));

  function loadData(){
    try{
      const saved = localStorage.getItem(STORAGE_KEY);
      if(saved) return JSON.parse(saved);
    }catch(e){ console.warn("No se pudo leer localStorage", e); }
    return clone(window.IKASI_DEFAULT_DATA);
  }
  let data = loadData();

  function saveData(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  const pad = n => String(n).padStart(2,"0");
  function localDateKey(d){
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function parseDateKey(s){
    const [y,m,d] = s.split("-").map(Number);
    return new Date(y,m-1,d);
  }
  function formatDate(s, opts={weekday:"long", day:"numeric", month:"long"}){
    return new Intl.DateTimeFormat("es-ES", opts).format(parseDateKey(s));
  }
  function fmtMinutes(min){
    const h = Math.floor(min/60), m = min%60;
    if(h && m) return `${h} h ${m} min`;
    if(h) return `${h} h`;
    return `${m} min`;
  }
  function isoExamToDate(s){ return new Date(s); }
  function todayKey(){
    const now = new Date();
    const key = localDateKey(now);
    const start = data.settings.startDate, end = data.settings.endDate;
    if(key < start) return start;
    if(key > end) return end;
    return key;
  }
  function subj(id){ return data.subjects[id] || {name:id,short:id,color:"#cbd5e1"}; }
  function tasksForDate(date){ return data.schedule.filter(t => t.date===date).sort((a,b)=>a.id.localeCompare(b.id)); }
  function totalMinutes(tasks){ return tasks.reduce((a,t)=>a+t.minutes,0); }
  function doneMinutes(tasks){ return tasks.filter(t=>t.completed).reduce((a,t)=>a+t.minutes,0); }

  function nextExam(from = new Date()){
    return Object.entries(data.subjects)
      .map(([id,s]) => ({id, ...s, date:isoExamToDate(s.exam)}))
      .filter(x => x.date >= from)
      .sort((a,b)=>a.date-b.date)[0] || null;
  }

  function daysBetween(a,b){
    const A = new Date(a.getFullYear(),a.getMonth(),a.getDate());
    const B = new Date(b.getFullYear(),b.getMonth(),b.getDate());
    return Math.ceil((B-A)/86400000);
  }

  function taskHTML(t, interactive=true){
    const s = subj(t.subject);
    return `
      <article class="task ${t.completed?"done":""}" style="--subject:${s.color}">
        ${interactive ? `<button class="check" data-toggle="${t.id}" aria-label="Marcar ${t.completed?"pendiente":"hecho"}">${t.completed?"✓":""}</button>` : `<div></div>`}
        <div>
          <div class="task-title">${escapeHTML(t.title)}</div>
          <div class="task-desc">${escapeHTML(t.description || "")}</div>
        </div>
        <div class="task-meta">
          <div class="minutes">${fmtMinutes(t.minutes)}</div>
          <div class="subject-name">${escapeHTML(s.short)}</div>
        </div>
      </article>`;
  }

  function renderToday(){
    const view = $("#view-today");
    const key = todayKey();
    const tasks = tasksForDate(key);
    const total = totalMinutes(tasks), done = doneMinutes(tasks);
    const pct = total ? Math.round(done/total*100) : 0;
    const exam = nextExam(parseDateKey(key));
    let examBlock = "";
    if(exam){
      const d = daysBetween(parseDateKey(key), exam.date);
      examBlock = `
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
    view.innerHTML = `
      <div class="hero">
        <div class="card">
          <div class="eyebrow">PLAN DE HOY</div>
          <h1>${capitalize(formatDate(key))}</h1>
          <div class="muted">${done ? `${fmtMinutes(done)} completados de ${fmtMinutes(total)}` : `${fmtMinutes(total)} previstos`}</div>
          <div class="bar" style="margin-top:16px"><span style="width:${pct}%;background:var(--accent)"></span></div>
          ${data.fixedDays[key] ? `<div class="fixed-note">${escapeHTML(data.fixedDays[key])}</div>` : ""}
        </div>
        ${examBlock}
      </div>
      <div class="section-title">
        <h2>Bloques de estudio</h2>
        <span class="pill">${pct}% completado</span>
      </div>
      <div class="task-list">
        ${tasks.length ? tasks.map(t=>taskHTML(t)).join("") : `<div class="empty">No hay bloques de estudio programados para este día.</div>`}
      </div>
      <div class="install-hint">Tus cambios y checks se guardan en este navegador. En <b>Admin</b> puedes editar el plan, exportarlo e importarlo.</div>
    `;
    $$("[data-toggle]",view).forEach(btn => btn.onclick = () => toggleTask(btn.dataset.toggle));
  }

  let weekOffset = 0;
  function startOfWeek(date){
    const d = new Date(date);
    const day = (d.getDay()+6)%7;
    d.setDate(d.getDate()-day);
    d.setHours(0,0,0,0);
    return d;
  }
  function renderCalendar(){
    const view = $("#view-calendar");
    const base = startOfWeek(parseDateKey(todayKey()));
    base.setDate(base.getDate()+weekOffset*7);
    const days = Array.from({length:7},(_,i)=>{ const d=new Date(base); d.setDate(base.getDate()+i); return d; });
    const nowKey = todayKey();

    const cards = days.map(d=>{
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
            return `<div class="mini-task ${t.completed?"done":""}" style="--subject:${s.color}">
              <strong>${escapeHTML(s.short)} · ${fmtMinutes(t.minutes)}</strong>${escapeHTML(t.title)}
            </div>`;
          }).join("")}
          ${data.fixedDays[key]?`<div class="mini-fixed">${escapeHTML(data.fixedDays[key])}</div>`:""}
          ${!tasks.length && !data.fixedDays[key] ? `<div class="muted" style="font-size:12px">Sin planificación.</div>` : ""}
        </article>`;
    }).join("");

    const label = `${new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"short"}).format(days[0])} – ${new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"short",year:"numeric"}).format(days[6])}`;
    view.innerHTML = `
      <div class="week-nav">
        <button class="btn" id="prevWeek">←</button>
        <div class="week-label">${label}</div>
        <button class="btn" id="nextWeek">→</button>
      </div>
      <div class="calendar-grid">${cards}</div>
    `;
    $("#prevWeek").onclick = ()=>{ weekOffset--; renderCalendar(); };
    $("#nextWeek").onclick = ()=>{ weekOffset++; renderCalendar(); };
  }

  function renderProgress(){
    const view=$("#view-progress");
    const bySubject = Object.keys(data.subjects).map(id=>{
      const tasks=data.schedule.filter(t=>t.subject===id);
      const total=totalMinutes(tasks), done=doneMinutes(tasks);
      const pct=total?Math.round(done/total*100):0;
      return {id,total,done,pct};
    });
    const total=totalMinutes(data.schedule), done=doneMinutes(data.schedule), pct=total?Math.round(done/total*100):0;

    const cards=bySubject.map(x=>{
      const s=subj(x.id);
      const exam = isoExamToDate(s.exam);
      return `
        <div class="card progress-card" style="--subject:${s.color}">
          <div class="progress-title">${escapeHTML(s.short)}</div>
          <div class="progress-row"><span>Hecho</span><strong>${fmtMinutes(x.done)}</strong></div>
          <div class="progress-row"><span>Planificado</span><strong>${fmtMinutes(x.total)}</strong></div>
          <div class="bar"><span style="width:${x.pct}%"></span></div>
          <div class="progress-row"><span>Progreso</span><strong>${x.pct}%</strong></div>
          <div class="muted" style="font-size:12px">Examen · ${new Intl.DateTimeFormat("es-ES",{day:"numeric",month:"long"}).format(exam)}</div>
        </div>`;
    }).join("");

    view.innerHTML=`
      <div class="section-title"><h2>Progreso por asignatura</h2><span class="pill">${pct}% global</span></div>
      <div class="progress-grid">${cards}</div>
      <div class="overall-grid">
        <div class="card">
          <div class="eyebrow">TOTAL DEL PLAN</div>
          <div class="big-number">${fmtMinutes(total)}</div>
          <div class="muted">horas de estudio planificadas</div>
        </div>
        <div class="card">
          <div class="eyebrow">COMPLETADO</div>
          <div class="big-number">${fmtMinutes(done)}</div>
          <div class="bar" style="margin-top:14px"><span style="width:${pct}%;background:var(--accent)"></span></div>
        </div>
      </div>`;
  }

  function renderAdmin(){
    const view=$("#view-admin");
    const rows=[...data.schedule].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).map(t=>{
      const s=subj(t.subject);
      return `<div class="admin-row">
        <div class="date">${formatDate(t.date,{day:"2-digit",month:"short"})}</div>
        <div>
          <div class="title"><span class="subject-dot" style="background:${s.color}"></span>${escapeHTML(t.title)}</div>
          <div class="desc">${escapeHTML(s.short)} · ${fmtMinutes(t.minutes)}${t.description?` · ${escapeHTML(t.description)}`:""}</div>
        </div>
        <div class="status">${t.completed?"✓ Hecho":"Pendiente"}</div>
        <div class="edit-wrap"><button class="btn" data-edit="${t.id}">Editar</button></div>
      </div>`;
    }).join("");
    view.innerHTML=`
      <div class="section-title">
        <h2>Administrar horario</h2>
        <span class="pill">Guardado local</span>
      </div>
      <div class="admin-toolbar">
        <button class="btn primary" id="newBlock">+ Añadir bloque</button>
        <button class="btn" id="exportData">Exportar copia</button>
        <label class="btn" style="margin:0">Importar copia<input id="importData" type="file" accept="application/json" hidden></label>
        <button class="btn ghost" id="resetData">Restaurar plan inicial</button>
      </div>
      <div class="admin-list">${rows}</div>
    `;
    $("#newBlock").onclick=()=>openEditor(null);
    $$("[data-edit]",view).forEach(b=>b.onclick=()=>openEditor(b.dataset.edit));
    $("#exportData").onclick=exportData;
    $("#importData").onchange=importData;
    $("#resetData").onclick=resetData;
  }

  function toggleTask(id){
    const t=data.schedule.find(x=>x.id===id);
    if(!t)return;
    t.completed=!t.completed; saveData(); renderAll();
  }

  function openEditor(id){
    const dlg=$("#editorDialog"), form=$("#editorForm");
    const select=$("#editSubject");
    select.innerHTML=Object.entries(data.subjects).map(([id,s])=>`<option value="${id}">${escapeHTML(s.name)}</option>`).join("");
    if(id){
      const t=data.schedule.find(x=>x.id===id);
      $("#dialogTitle").textContent="Editar bloque";
      $("#editId").value=t.id;
      $("#editDate").value=t.date;
      $("#editSubject").value=t.subject;
      $("#editMinutes").value=t.minutes;
      $("#editCompleted").value=String(!!t.completed);
      $("#editTitle").value=t.title;
      $("#editDescription").value=t.description||"";
      $("#deleteBlockBtn").style.display="";
    }else{
      $("#dialogTitle").textContent="Añadir bloque";
      $("#editId").value="";
      $("#editDate").value=todayKey();
      $("#editSubject").value=Object.keys(data.subjects)[0];
      $("#editMinutes").value=60;
      $("#editCompleted").value="false";
      $("#editTitle").value="";
      $("#editDescription").value="";
      $("#deleteBlockBtn").style.display="none";
    }
    dlg.showModal();
  }

  function saveEditor(){
    const id=$("#editId").value;
    const obj={
      id:id || `custom-${Date.now()}`,
      date:$("#editDate").value,
      subject:$("#editSubject").value,
      minutes:Number($("#editMinutes").value),
      title:$("#editTitle").value.trim(),
      description:$("#editDescription").value.trim(),
      completed:$("#editCompleted").value==="true"
    };
    if(!obj.date || !obj.subject || !obj.minutes || !obj.title) return;
    if(id){
      const i=data.schedule.findIndex(x=>x.id===id); data.schedule[i]=obj;
    }else data.schedule.push(obj);
    saveData(); $("#editorDialog").close(); renderAll();
  }

  function deleteEditor(){
    const id=$("#editId").value;
    if(!id) return;
    if(confirm("¿Eliminar este bloque?")){
      data.schedule=data.schedule.filter(x=>x.id!==id);
      saveData(); $("#editorDialog").close(); renderAll();
    }
  }

  function exportData(){
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`ikasi-copia-${localDateKey(new Date())}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  function importData(ev){
    const file=ev.target.files?.[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const parsed=JSON.parse(reader.result);
        if(!parsed.schedule || !parsed.subjects) throw new Error("Formato no válido");
        data=parsed; saveData(); renderAll(); alert("Copia importada.");
      }catch(e){ alert("No se pudo importar el archivo."); }
      ev.target.value="";
    };
    reader.readAsText(file);
  }

  function resetData(){
    if(confirm("¿Restaurar el plan original? Se perderán los cambios locales y los checks.")){
      data=clone(window.IKASI_DEFAULT_DATA); saveData(); renderAll();
    }
  }

  function escapeHTML(s){
    return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }
  function capitalize(s){ return s.charAt(0).toUpperCase()+s.slice(1); }

  function renderAll(){
    renderToday(); renderCalendar(); renderProgress(); renderAdmin();
  }

  $$(".tab").forEach(btn=>btn.onclick=()=>{
    $$(".tab").forEach(x=>x.classList.toggle("active",x===btn));
    $$(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${btn.dataset.view}`));
  });

  $("#saveBlockBtn").onclick=saveEditor;
  $("#deleteBlockBtn").onclick=deleteEditor;

  function initTheme(){
    const saved=localStorage.getItem(THEME_KEY);
    const dark=saved ? saved==="dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme=dark?"dark":"light";
  }
  $("#themeToggle").onclick=()=>{
    const next=document.documentElement.dataset.theme==="dark"?"light":"dark";
    document.documentElement.dataset.theme=next; localStorage.setItem(THEME_KEY,next);
  };
  initTheme();

  if("serviceWorker" in navigator){
    window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  }
  renderAll();
})();
