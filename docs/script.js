const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const STORAGE_KEY = 'weekTasks_v1';
// vibrant palette used for slices and swatches
const PALETTE = ['#ef4444','#f97316','#f59e0b','#eab308','#10b981','#06b6d4','#3b82f6','#8b5cf6','#ec4899'];

// load or init
let weekTasks = loadTasks();

const weekGrid = document.getElementById('weekGrid');
const resetBtn = document.getElementById('resetWeek');
// Support both legacy and current IDs for export/import buttons
const exportBtn = document.getElementById('exportJson') || document.getElementById('export');
const importBtn = document.getElementById('importJson') || document.getElementById('import');
const importFile = document.getElementById('importFile');
const THEME_KEY = 'weekTheme_v1';
const COLLAPSE_KEY = 'collapsedDays_v1';
const ACCENTS_KEY = 'accentColors_v1';
const MOBILE_MQ = window.matchMedia('(max-width: 768px)');
let selectedDayIndex = (new Date()).getDay();

// Settings state
const collapsedDays = loadJson(COLLAPSE_KEY, {});
const accentColors = loadJson(ACCENTS_KEY, {});

// Theme handling
function applyTheme(theme) {
  const root = document.documentElement;
  const t = theme || 'light';
  if (t === 'light') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', t);
  }
  try { localStorage.setItem(THEME_KEY, t); } catch(_) {}
  // update active state on buttons
  document.querySelectorAll('.theme-button').forEach(btn => {
    const isActive = (btn.dataset.theme === t);
    // special case: when t === 'light', the dataset is 'light'
    btn.classList.toggle('active', isActive);
  });
}

// initialize theme from storage and wire buttons
(() => {
  const saved = (() => { try { return localStorage.getItem(THEME_KEY); } catch(_) { return null; } })() || 'light';
  applyTheme(saved);
  document.querySelectorAll('.theme-button').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });
})();

// build UI
DAYS.forEach((day, idx) => {
  const card = createDayCard(day, idx);
  weekGrid.appendChild(card);
  renderTasks(idx);
  // Batch summary update to avoid flicker during initial load
  updateProgress(idx, false);
});

// Build the mobile day picker (compact mobile layout)
buildSummaryCard();
buildDayPicker();
applyMobileState(MOBILE_MQ.matches);
try { MOBILE_MQ.addEventListener('change', (e)=> applyMobileState(e.matches)); } catch { /* Safari fallback */ MOBILE_MQ.addListener((e)=> applyMobileState(e.matches)); }

resetBtn.addEventListener('click', async () => {
  const ok = await showConfirm({
    title: 'Refresh week',
    message: 'Clear all tasks for the current week? This cannot be undone.',
    confirmText: 'Refresh',
    cancelText: 'Cancel',
    tone: 'danger'
  });
  if(!ok) return;
  weekTasks = DAYS.map(()=>[]);
  saveTasks();
  // re-render all
  DAYS.forEach((_,i)=>{ renderTasks(i); updateProgress(i, false); });
  // one-time summary recompute to prevent repeated DOM churn
  updateSummary();
  showToast('Week refreshed! All tasks cleared.', 'success', 3200);
});

// Backup: export/import
function buildBackup(){
  const theme = (()=>{ try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; } })();
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    theme,
    weekTasks,
    accentColors,
    collapsedDays
  };
}

function triggerDownload(filename, text){
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
}

if(exportBtn){
  exportBtn.addEventListener('click', ()=>{
    const data = buildBackup();
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    triggerDownload(`week-task-backup-${dateStr}.json`, JSON.stringify(data, null, 2));
    showToast('Backup exported as JSON.', 'success', 2600);
  });
}

// Returns true if import applied without critical issues
async function applyImport(obj){
  // Basic validation and normalization
  if(!obj || typeof obj !== 'object') throw new Error('Invalid backup file');
  if(!Array.isArray(obj.weekTasks) || obj.weekTasks.length !== 7) throw new Error('Invalid tasks in backup');
  // Assign theme
  if(obj.theme){ applyTheme(obj.theme); }
  // Replace in-memory structures
  weekTasks = obj.weekTasks.map(dayArr => Array.isArray(dayArr) ? dayArr.map(t => ({
    text: t.text || '',
    done: !!t.done,
    deadline: t.deadline,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(s=>({ text: s.text||'', done: !!s.done })) : [],
    archived: !!t.archived,
    color: t.color || undefined
  })) : []);
  // Update settings
  const acc = obj.accentColors && typeof obj.accentColors==='object' ? obj.accentColors : {};
  const col = obj.collapsedDays && typeof obj.collapsedDays==='object' ? obj.collapsedDays : {};
  // mutate existing objects to keep references used elsewhere
  Object.keys(accentColors).forEach(k=> delete accentColors[k]);
  Object.assign(accentColors, acc);
  Object.keys(collapsedDays).forEach(k=> delete collapsedDays[k]);
  Object.assign(collapsedDays, col);
  // Persist
  saveTasks();
  saveJson(ACCENTS_KEY, accentColors);
  saveJson(COLLAPSE_KEY, collapsedDays);
  // Re-render all UI defensively to avoid bubbling errors
  try {
    const cards = document.querySelectorAll('.card');
    cards.forEach((card, i)=>{
      // apply accent
      const color = accentColors[i] || PALETTE[i % PALETTE.length];
      if(card && typeof card.style?.setProperty === 'function'){
        card.style.setProperty('--day-accent', color);
      }
      const grad = document.getElementById(`ring-grad-${i}`);
      if(grad){ const stops = grad.querySelectorAll('stop'); if(stops[0]) stops[0].setAttribute('stop-color', color); if(stops[1]) stops[1].setAttribute('stop-color', color); }
      // collapsed
      const btn = card.querySelector('.icon-btn.ghost');
      if(collapsedDays[i]){ card.classList.add('collapsed'); if(btn) btn.textContent = '▸'; } else { card.classList.remove('collapsed'); if(btn) btn.textContent = '▾'; }
      // tasks and progress
      renderTasks(i);
      updateProgress(i, false);
    });
    updateSummary();
  } catch (e) {
    console.error('Post-import render had an issue (import still applied).', e);
    // Import is still considered successful at data level
  }
  return true;
}

if(importBtn && importFile){
  importBtn.addEventListener('click', ()=> importFile.click());
  importFile.addEventListener('change', async ()=>{
    const file = importFile.files && importFile.files[0];
    if(!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      const ok = await showConfirm({ title:'Import backup', message:'This will replace your current data. Continue?', confirmText:'Import', cancelText:'Cancel', tone:'danger' });
      if(!ok) return;
      const applied = await applyImport(obj);
      if(applied){
        showToast('Backup imported successfully.', 'success', 3000);
      } else {
        showToast('Imported with minor issues. Data restored.', 'success', 3200);
      }
    } catch (e){
      console.error(e);
      showToast('Failed to import backup.', 'error', 3500);
    } finally {
      importFile.value = '';
    }
  });
}

// functions
function createDayCard(dayName, dayIndex){
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.day = dayIndex;
  // per-day accent color used by CSS (border/pills/progress)
  const accent = accentColors[dayIndex] || PALETTE[dayIndex % PALETTE.length];
  card.style.setProperty('--day-accent', accent);

  const rightColumn = document.createElement('div');
  rightColumn.className = 'right-column';

  const head = document.createElement('div');
  head.className = 'day-head';

  const name = document.createElement('div');
  name.className = 'day-name';
  name.textContent = dayName;

  // stats pill shows done/total for quick glance
  const statsPill = document.createElement('div');
  statsPill.className = 'count-pill';
  statsPill.id = `count-${dayIndex}`;
  statsPill.textContent = '0 / 0';

  // header actions: complete all, clear done, collapse
  const actions = document.createElement('div');
  actions.className = 'head-actions';
  const btnAll = document.createElement('button');
  btnAll.type = 'button';
  btnAll.className = 'icon-btn';
  btnAll.title = 'Mark all tasks done';
  btnAll.setAttribute('aria-label','Mark all tasks done');
  btnAll.textContent = '✓ All';
  btnAll.addEventListener('click', ()=>{
    if(!weekTasks[dayIndex] || weekTasks[dayIndex].length===0) return;
    weekTasks[dayIndex] = weekTasks[dayIndex].map(t=>({ ...t, done:true }));
    saveTasks();
    renderTasks(dayIndex);
    updateProgress(dayIndex);
  });

  const btnClear = document.createElement('button');
  btnClear.type = 'button';
  btnClear.className = 'icon-btn danger';
  btnClear.title = 'Remove completed tasks';
  btnClear.setAttribute('aria-label','Remove completed tasks');
  btnClear.textContent = 'Clear done';
  btnClear.addEventListener('click', ()=>{
    const tasks = weekTasks[dayIndex] || [];
    if(tasks.length===0) return;
    // Archive tasks that are done instead of deleting them so the pie/percent remains accurate
    weekTasks[dayIndex] = tasks.map(t=>{
      if(t.done){ return { ...t, archived: true }; }
      return t;
    });
    saveTasks();
    renderTasks(dayIndex);
    updateProgress(dayIndex);
  });

  const btnCollapse = document.createElement('button');
  btnCollapse.type = 'button';
  btnCollapse.className = 'icon-btn ghost';
  btnCollapse.title = 'Collapse/Expand this day';
  btnCollapse.setAttribute('aria-label','Collapse or expand this day');
  btnCollapse.textContent = '▾';
  btnCollapse.addEventListener('click', ()=>{
    const collapsed = card.classList.toggle('collapsed');
    btnCollapse.textContent = collapsed ? '▸' : '▾';
    collapsedDays[dayIndex] = collapsed ? true : false;
    saveJson(COLLAPSE_KEY, collapsedDays);
  });

  // Accent color picker
  const accentPicker = document.createElement('input');
  accentPicker.type = 'color';
  accentPicker.className = 'accent-color';
  accentPicker.value = accent;
  accentPicker.title = 'Set accent color for this day';
  accentPicker.addEventListener('input', ()=>{
    const val = accentPicker.value;
    card.style.setProperty('--day-accent', val);
    accentColors[dayIndex] = val;
    saveJson(ACCENTS_KEY, accentColors);
    // update gradient ring stops for this day
    const grad = document.getElementById(`ring-grad-${dayIndex}`);
    if(grad){
      const stops = grad.querySelectorAll('stop');
      if(stops[0]) stops[0].setAttribute('stop-color', val);
      if(stops[1]) stops[1].setAttribute('stop-color', val);
    }
  });

  actions.appendChild(btnAll);
  actions.appendChild(btnClear);
  actions.appendChild(accentPicker);
  actions.appendChild(btnCollapse);

  const progressWrap = document.createElement('div');
  progressWrap.className = 'progress-wrap';

  // svg circular progress
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox','0 0 100 100');
  svg.classList.add('pie');

  // gradient defs for outer ring
  const defs = document.createElementNS(svgNS,'defs');
  const gradId = `ring-grad-${dayIndex}`;
  const lg = document.createElementNS(svgNS,'linearGradient');
  lg.setAttribute('id', gradId);
  lg.setAttribute('x1','0%');
  lg.setAttribute('y1','0%');
  lg.setAttribute('x2','100%');
  lg.setAttribute('y2','0%');
  const stop1 = document.createElementNS(svgNS,'stop');
  stop1.setAttribute('offset','0%');
  stop1.setAttribute('stop-color', PALETTE[dayIndex % PALETTE.length]);
  stop1.setAttribute('stop-opacity','0.9');
  const stop2 = document.createElementNS(svgNS,'stop');
  stop2.setAttribute('offset','100%');
  stop2.setAttribute('stop-color', PALETTE[dayIndex % PALETTE.length]);
  stop2.setAttribute('stop-opacity','0.3');
  lg.appendChild(stop1);
  lg.appendChild(stop2);
  defs.appendChild(lg);

  // background circle
  const bg = document.createElementNS(svgNS,'circle');
  bg.setAttribute('cx',50);
  bg.setAttribute('cy',50);
  bg.setAttribute('r',45);
  bg.setAttribute('fill','#f8fafb');
  bg.setAttribute('stroke','rgba(15,23,36,0.04)');
  bg.setAttribute('stroke-width',1);

  // outer decorative ring
  const ring = document.createElementNS(svgNS,'circle');
  ring.setAttribute('cx',50);
  ring.setAttribute('cy',50);
  ring.setAttribute('r',47);
  ring.setAttribute('fill','none');
  ring.setAttribute('stroke', `url(#${gradId})`);
  ring.setAttribute('stroke-width', '2');

  // (removed extra progress ring to keep focus on horizontal percentage graphs)

  // group to hold slices (each slice is a sector path)
  const slicesGroup = document.createElementNS(svgNS,'g');
  slicesGroup.setAttribute('id', `slices-${dayIndex}`);

  // small center circle to create donut-like feel and place percentage
  const centerHole = document.createElementNS(svgNS,'circle');
  centerHole.setAttribute('cx',50);
  centerHole.setAttribute('cy',50);
  centerHole.setAttribute('r',30);
  centerHole.setAttribute('fill','#ffffff');
  centerHole.setAttribute('stroke','none');
  centerHole.setAttribute('class','center-hole');

  svg.appendChild(defs);
  svg.appendChild(bg);
  svg.appendChild(ring);
  svg.appendChild(slicesGroup);
  svg.appendChild(centerHole);

  // visual wrapper for svg to position absolute center text
  const pieWrap = document.createElement('div'); pieWrap.className = 'pie-wrap';
  const pct = document.createElement('div');
  pct.className = 'pct';
  pct.textContent = '0%';
  const centerBox = document.createElement('div'); centerBox.className = 'pie-center';
  const big = document.createElement('div'); big.className='big'; big.textContent='0%';
  const small = document.createElement('div'); small.className='small'; small.textContent='0 / 0';
  centerBox.appendChild(big);
  centerBox.appendChild(small);

  progressWrap.appendChild(pieWrap);
  pieWrap.appendChild(svg);
  pieWrap.appendChild(centerBox);
  // also keep pct as a label next to pie for accessibility
  const pctLabel = document.createElement('div'); pctLabel.className='pct pct-label'; pctLabel.textContent = '0%';
  progressWrap.appendChild(pctLabel);

  // compose header: name + stats on left; actions on right
  const headLeft = document.createElement('div');
  headLeft.style.display = 'flex';
  headLeft.style.alignItems = 'center';
  headLeft.style.gap = '10px';
  headLeft.appendChild(name);
  headLeft.appendChild(statsPill);

  head.appendChild(headLeft);
  head.appendChild(actions);
  
  rightColumn.appendChild(head);

  // mini progress bar under header
  const miniProg = document.createElement('div');
  miniProg.className = 'mini-progress';
  const miniBar = document.createElement('div');
  miniBar.className = 'bar';
  miniBar.id = `mini-${dayIndex}`;
  miniProg.appendChild(miniBar);
  rightColumn.appendChild(miniProg);

  // add row
  const addRow = document.createElement('div');
  addRow.className = 'add-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'New task...';
  input.setAttribute('aria-label', `Add task for ${dayName}`);
  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add';
  addBtn.addEventListener('click', ()=>{
    const val = input.value && input.value.trim();
    if(!val) return;
    weekTasks[dayIndex].push({text:val,done:false});
    saveTasks();
    input.value='';
    renderTasks(dayIndex);
    updateProgress(dayIndex);
  });
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') addBtn.click(); });
  addRow.appendChild(input);
  addRow.appendChild(addBtn);

  const taskList = document.createElement('div');
  taskList.className='task-list';
  taskList.id = `tasks-${dayIndex}`;

  rightColumn.appendChild(addRow);
  rightColumn.appendChild(taskList);

  card.appendChild(progressWrap);
  card.appendChild(rightColumn);

  // initialize collapsed state
  if (collapsedDays[dayIndex]) {
    card.classList.add('collapsed');
    btnCollapse.textContent = '▸';
  }

  return card;
}

function buildDayPicker(){
  const picker = document.createElement('div');
  picker.className = 'day-picker';
  picker.setAttribute('role','tablist');
  picker.id = 'dayPicker';
  DAYS.forEach((d, i)=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role','tab');
    btn.dataset.dayIndex = String(i);
    btn.textContent = d.slice(0,3);
    if(i === selectedDayIndex) btn.classList.add('active');
    btn.addEventListener('click', ()=> setMobileSelectedDay(i));
    picker.appendChild(btn);
  });
  // insert before the week grid
  const parent = weekGrid.parentElement;
  if(parent){ parent.insertBefore(picker, weekGrid); }
}

function applyMobileState(isMobile){
  const picker = document.getElementById('dayPicker');
  if(!picker) return;
  if(isMobile){
    picker.style.display = 'flex';
    // ensure only selected day's card shows
    setMobileSelectedDay(selectedDayIndex);
  } else {
    picker.style.display = 'none';
    // show all cards in desktop mode
    document.querySelectorAll('.card').forEach(card=> card.classList.remove('hidden'));
  }
}

function setMobileSelectedDay(idx){
  selectedDayIndex = idx;
  // toggle active on buttons
  const picker = document.getElementById('dayPicker');
  if(picker){
    picker.querySelectorAll('button').forEach(btn=>{
      btn.classList.toggle('active', Number(btn.dataset.dayIndex) === idx);
    });
  }
  // show only the selected card
  document.querySelectorAll('.card').forEach(card=>{
    const d = Number(card.dataset.day);
    if(Number.isFinite(d)){
      card.classList.toggle('hidden', d !== idx);
    }
  });
  // optional: scroll the selected card into view
  const sel = document.querySelector(`.card[data-day='${idx}']`);
  if(sel){ sel.scrollIntoView({ behavior:'smooth', block:'start' }); }
}

function renderTasks(dayIndex){
  const listEl = document.getElementById(`tasks-${dayIndex}`);
  listEl.innerHTML='';
  const tasks = weekTasks[dayIndex] || [];
  const visible = tasks.filter(t=>!t.archived);
  if(visible.length===0){
    const e = document.createElement('div'); e.className='empty'; e.textContent='No tasks yet';
    listEl.appendChild(e);
    return;
  }
  let dragSrcIndex = null;
  const indexMap = [];
  visible.forEach((t, i)=>{
    const originalIndex = tasks.indexOf(t);
    indexMap[i] = originalIndex;
    const row = document.createElement('div'); row.className='task';
    row.setAttribute('draggable','true');
    row.dataset.index = String(i);
    row.dataset.originalIndex = String(originalIndex);
    const cb = document.createElement('input'); cb.type='checkbox'; cb.checked = !!t.done; cb.id = `d${dayIndex}-t${originalIndex}`;
    cb.addEventListener('change', ()=>{
      // if subtasks exist, toggle them to match parent
      if (Array.isArray(t.subtasks) && t.subtasks.length>0) {
        t.subtasks = t.subtasks.map(s=>({ ...s, done: cb.checked }));
      }
      weekTasks[dayIndex][originalIndex].done = cb.checked;
      saveTasks();
      renderTasks(dayIndex);
      updateProgress(dayIndex);
    });

    // color swatch to match slice color
    const colorInp = document.createElement('input');
    colorInp.type = 'color';
    colorInp.className = 'task-color';
    colorInp.title = 'Task color';
    colorInp.value = t.color || PALETTE[originalIndex % PALETTE.length];
    colorInp.addEventListener('input', ()=>{
      weekTasks[dayIndex][originalIndex].color = colorInp.value;
      saveTasks();
      updateProgress(dayIndex);
    });

  const label = document.createElement('label'); label.htmlFor = cb.id; label.textContent = t.text;
    if(t.done){ label.style.textDecoration='line-through'; label.style.opacity='0.6'; } else { label.style.textDecoration='none'; label.style.opacity='1'; }

    // listen to changes to update label style
    cb.addEventListener('change', ()=>{
      if(cb.checked){ label.style.textDecoration='line-through'; label.style.opacity='0.6'; } else { label.style.textDecoration='none'; label.style.opacity='1'; }
    });

    // "Deadline" note pill (free-form note, not a real date)
    if (t.deadline) {
      const pill = document.createElement('span');
      pill.className = 'deadline-pill';
      pill.title = 'Deadline';
      pill.textContent = `Deadline: ${t.deadline}`;
      row.appendChild(pill);
    }

    // deadline button to add/edit a free-form note under the heading "Deadline"
    const deadlineBtn = document.createElement('button');
    deadlineBtn.type = 'button';
    deadlineBtn.className = 'deadline-btn';
    deadlineBtn.textContent = 'Deadline';
    deadlineBtn.title = 'Add or edit note under "Deadline"';
    deadlineBtn.addEventListener('click', () => {
      const existing = row.querySelector('.deadline-editor');
      if (existing) { existing.remove(); return; }
      const editor = document.createElement('div');
      editor.className = 'deadline-editor';
      const inp = document.createElement('input'); inp.type='text'; inp.placeholder='Add note...'; inp.value = t.deadline || '';
      const save = document.createElement('button'); save.type='button'; save.className='save'; save.textContent='Save';
      const clear = document.createElement('button'); clear.type='button'; clear.className='clear'; clear.textContent='Clear';

      save.addEventListener('click', ()=>{
        const val = inp.value;
        weekTasks[dayIndex][i].deadline = val || undefined;
        saveTasks();
        renderTasks(dayIndex);
        updateProgress(dayIndex);
      });
      clear.addEventListener('click', ()=>{
        weekTasks[dayIndex][i].deadline = undefined;
        saveTasks();
        renderTasks(dayIndex);
        updateProgress(dayIndex);
      });
      editor.appendChild(inp);
      editor.appendChild(save);
      editor.appendChild(clear);
      row.appendChild(editor);
    });

    // Subtasks button and renderer
    const subBtn = document.createElement('button');
    subBtn.type = 'button';
    subBtn.className = 'subtasks-btn';
    subBtn.textContent = 'Subtasks';
    subBtn.title = 'Add or manage subtasks';
    subBtn.addEventListener('click', ()=>{
      const existing = row.querySelector('.subtasks');
      if(existing){ existing.remove(); return; }
      const box = document.createElement('div'); box.className='subtasks';
      const list = document.createElement('div'); list.className='subtasks-list';
      const arr = Array.isArray(t.subtasks) ? t.subtasks : (t.subtasks = []);
      arr.forEach((st, si)=>{
        const srow = document.createElement('div'); srow.className='subtask-row';
        const sc = document.createElement('input'); sc.type='checkbox'; sc.checked=!!st.done; sc.id=`sd${dayIndex}-t${originalIndex}-s${si}`;
        const sl = document.createElement('label'); sl.htmlFor=sc.id; sl.textContent=st.text;
        sc.addEventListener('change', ()=>{
          weekTasks[dayIndex][originalIndex].subtasks[si].done = sc.checked;
          // auto parent completion: all subtasks done => parent done
          const allDone = weekTasks[dayIndex][originalIndex].subtasks.length>0 && weekTasks[dayIndex][originalIndex].subtasks.every(x=>x.done);
          weekTasks[dayIndex][originalIndex].done = allDone;
          saveTasks();
          renderTasks(dayIndex);
          updateProgress(dayIndex);
        });
        const delS = document.createElement('button'); delS.type='button'; delS.className='del-subtask'; delS.title='Remove subtask'; delS.textContent='✕';
        delS.addEventListener('click', ()=>{
          weekTasks[dayIndex][originalIndex].subtasks.splice(si,1);
          const allDone = weekTasks[dayIndex][originalIndex].subtasks.length>0 && weekTasks[dayIndex][originalIndex].subtasks.every(x=>x.done);
          weekTasks[dayIndex][originalIndex].done = allDone ? true : false;
          saveTasks();
          renderTasks(dayIndex);
          updateProgress(dayIndex);
        });
        srow.appendChild(sc); srow.appendChild(sl); srow.appendChild(delS);
        list.appendChild(srow);
      });
      const addWrap = document.createElement('div'); addWrap.className='subtasks-add';
      const sinput = document.createElement('input'); sinput.type='text'; sinput.placeholder='New subtask...';
      const sadd = document.createElement('button'); sadd.type='button'; sadd.className='add-subtask'; sadd.textContent='Add';
      sadd.addEventListener('click', ()=>{
        const val = sinput.value && sinput.value.trim();
        if(!val) return;
        if(!Array.isArray(weekTasks[dayIndex][originalIndex].subtasks)) weekTasks[dayIndex][originalIndex].subtasks = [];
        weekTasks[dayIndex][originalIndex].subtasks.push({ text: val, done: false });
        saveTasks();
        renderTasks(dayIndex);
        updateProgress(dayIndex);
      });
      addWrap.appendChild(sinput); addWrap.appendChild(sadd);
      box.appendChild(list);
      box.appendChild(addWrap);
      row.appendChild(box);
    });

    const del = document.createElement('button'); del.className='del'; del.title='Delete task'; del.innerHTML='✕';
    del.addEventListener('click', ()=>{ weekTasks[dayIndex].splice(originalIndex,1); saveTasks(); renderTasks(dayIndex); updateProgress(dayIndex); });

    row.appendChild(colorInp);
    row.appendChild(cb);
    row.appendChild(label);
    row.appendChild(deadlineBtn);
    row.appendChild(subBtn);
    row.appendChild(del);
    // Drag & drop handlers
    row.addEventListener('dragstart', (e)=>{
      dragSrcIndex = originalIndex;
      row.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(originalIndex)); } catch {}
    });
    row.addEventListener('dragover', (e)=>{ e.preventDefault(); row.classList.add('drop-over'); });
    row.addEventListener('dragleave', ()=>{ row.classList.remove('drop-over'); });
    row.addEventListener('drop', (e)=>{
      e.preventDefault(); row.classList.remove('drop-over');
      const targetOriginal = Number(row.dataset.originalIndex);
      if(dragSrcIndex===null || isNaN(targetOriginal) || dragSrcIndex===targetOriginal) return;
      const arr = weekTasks[dayIndex];
      const [moved] = arr.splice(dragSrcIndex,1);
      // adjust insertion index if removing earlier element
      let insertAt = targetOriginal;
      if(dragSrcIndex < targetOriginal) insertAt = targetOriginal - 1;
      arr.splice(insertAt,0,moved);
      saveTasks();
      renderTasks(dayIndex);
      updateProgress(dayIndex);
    });
    row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); });
    listEl.appendChild(row);
  });
}

function updateProgress(dayIndex, doSummary = true){
  const tasks = weekTasks[dayIndex] || [];
  // For the pie and day card, EXCLUDE archived tasks
  const visible = tasks.map((t,i)=>({ t, i })).filter(x => !x.t.archived);
  const doneVis = visible.filter(x=>x.t.done).length;
  const totalVis = visible.length;
  const pct = totalVis===0 ? 0 : Math.round((doneVis/totalVis)*100);

  // find corresponding card
  const card = document.querySelector(`.card[data-day='${dayIndex}']`);
  if(!card) return;
  // update textual pct displays
  const pctElBig = card.querySelector('.pie-center .big');
  const pctElSmall = card.querySelector('.pie-center .small');
  const pctLabel = card.querySelector('.pct-label');
  if(pctElBig) pctElBig.textContent = `${pct}%`;
  if(pctLabel) pctLabel.textContent = `${pct}%`;
  // update stats pill and mini progress
  const statsPill = card.querySelector(`#count-${dayIndex}`);
  if(statsPill) statsPill.textContent = `${doneVis} / ${totalVis}`;
  const miniBar = card.querySelector(`#mini-${dayIndex}`);
  if(miniBar){
    miniBar.style.width = `${pct}%`;
    miniBar.dataset.pct = `${pct}%`;
    miniBar.setAttribute('role','progressbar');
    miniBar.setAttribute('aria-valuemin','0');
    miniBar.setAttribute('aria-valuemax','100');
    miniBar.setAttribute('aria-valuenow', String(pct));
  }

  // draw solid slices for each completed task. Each task occupies a slice of angle = 360/total
  const slicesGroup = card.querySelector(`#slices-${dayIndex}`);
  // clear existing slices
  while(slicesGroup && slicesGroup.firstChild) slicesGroup.removeChild(slicesGroup.firstChild);

  if(totalVis === 0){
    // nothing to draw — ensure center shows 0/0 and 0%
    if(pctElBig) pctElBig.textContent = `0%`;
    if(pctElSmall) pctElSmall.textContent = `0 / 0`;
    if(pctLabel) pctLabel.textContent = `0%`;
    return;
  }

  // use shared palette

  // helpers to compute path for sector
  function polarToCartesian(cx, cy, radius, angleInDegrees) {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
    return {
      x: cx + (radius * Math.cos(angleInRadians)),
      y: cy + (radius * Math.sin(angleInRadians))
    };
  }

  function describeSector(cx, cy, radius, startAngle, endAngle){
    const start = polarToCartesian(cx, cy, radius, endAngle);
    const end = polarToCartesian(cx, cy, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    const d = [
      `M ${cx} ${cy}`,
      `L ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
      'Z'
    ].join(' ');
    return d;
  }

  const sliceAngle = 360 / totalVis;
  visible.forEach(({t, i: originalIndex}, i) => {
    const startAngle = i * sliceAngle;
    const endAngle = startAngle + sliceAngle;
    const pathD = describeSector(50, 50, 45, startAngle, endAngle);
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', pathD);
    const color = (t.color && /^#?[0-9a-fA-F]{3,8}$/.test(t.color)) ? t.color : PALETTE[i % PALETTE.length];
    path.setAttribute('fill', color);
  path.setAttribute('class', 'slice');

	if (t.done) {
		path.classList.add('done');
	} else {
		path.classList.add('incomplete');
	}

    // accessibility & tooltip
    path.setAttribute('role','button');
    path.setAttribute('tabindex','0');
    path.setAttribute('aria-label', `Toggle task: ${t.text}`);
    // native tooltip in SVG
    const titleEl = document.createElementNS('http://www.w3.org/2000/svg','title');
    titleEl.textContent = t.text;
    path.appendChild(titleEl);
    // make interactive: click toggles that task
    path.style.cursor = 'pointer';
    path.addEventListener('click', ()=>{ weekTasks[dayIndex][originalIndex].done = !weekTasks[dayIndex][originalIndex].done; saveTasks(); renderTasks(dayIndex); updateProgress(dayIndex); });
    path.addEventListener('keydown', (ev)=>{ if(ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); path.click(); } });
    // small animation delay so slices appear in order
    path.style.transitionDelay = `${0.03 * i}s`;
    slicesGroup.appendChild(path);
    // trigger show state on next frame
    requestAnimationFrame(()=>{ path.classList.add('show'); });
  });

  // update center "done / total"
  if(pctElSmall) pctElSmall.textContent = `${doneVis} / ${totalVis}`;
  // update weekly summary once unless explicitly suppressed in batch
  if (doSummary) updateSummary();
}

function saveTasks(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(weekTasks)); }
  catch(e){ console.warn('Could not save tasks',e); }
}

function loadTasks(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return DAYS.map(()=>[]);
    const parsed = JSON.parse(raw);
    // ensure 7 entries
    if(!Array.isArray(parsed) || parsed.length!==7) return DAYS.map(()=>[]);
    return parsed;
  }catch(e){ return DAYS.map(()=>[]); }
}

function loadJson(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return fallback;
    const obj = JSON.parse(raw);
    return (obj && typeof obj==='object') ? obj : fallback;
  }catch{ return fallback; }
}
function saveJson(key, obj){
  try{ localStorage.setItem(key, JSON.stringify(obj)); } catch{}
}

// Summary card
function buildSummaryCard(){
  const summary = document.createElement('div');
  summary.id = 'summaryCard';
  summary.className = 'summary-card card';
  const stats = document.createElement('div'); stats.className = 'summary-stats';
  stats.innerHTML = `
    <div class="metric" id="sumTotalWrap">
      <div class="metric-icon" aria-hidden="true">📊</div>
      <span class="metric-value" id="sumTotal">0/0</span>
      <small class="metric-label">Total</small>
    </div>
    <div class="metric hot" id="sumPctWrap">
      <div class="metric-icon" aria-hidden="true">⚡</div>
      <span class="metric-value" id="sumPct">0%</span>
      <small class="metric-label">Overall</small>
    </div>
  `;
  const bars = document.createElement('div'); bars.className = 'summary-bars';
  DAYS.forEach((d,i)=>{
    const row = document.createElement('div'); row.className='bar-row';
    row.id = `row-${i}`;
    row.dataset.day = String(i);
    row.innerHTML = `
      <span class="label">${d.slice(0,3)}</span>
      <div class="bar"><div class="fill" id="bar-${i}"></div></div>
      <span class="val" id="bar-val-${i}">0%</span>
    `;
    bars.appendChild(row);
  });
  summary.appendChild(stats);
  summary.appendChild(bars);
  const parent = weekGrid.parentElement;
  if(parent){ parent.insertBefore(summary, document.getElementById('dayPicker') || weekGrid); }
  updateSummary();
}

function updateSummary(){
  let overallDone = 0, overallTotal = 0;
  DAYS.forEach((_,i)=>{
    const tasks = weekTasks[i] || [];
    const done = tasks.filter(t=>t.done).length;
    const total = tasks.length;
    const pct = total===0 ? 0 : Math.round((done/total)*100);
    overallDone += done; overallTotal += total;
    const fill = document.getElementById(`bar-${i}`);
    const val = document.getElementById(`bar-val-${i}`);
    if(fill){
      fill.style.width = pct+'%';
      fill.dataset.pct = pct+'%';
      const acc = (accentColors && accentColors[i] ? accentColors[i] : PALETTE[i % PALETTE.length]);
      fill.style.setProperty('--bar-accent', acc);
      // Show inline label only when there is enough space inside the bar
      fill.classList.toggle('show-label', pct >= 18);
    }
    if(val) val.textContent = pct+'%';
  });
  const sumTotal = document.getElementById('sumTotal');
  const sumPct = document.getElementById('sumPct');
  if(sumTotal) sumTotal.textContent = `${overallDone}/${overallTotal}`;
  if(sumPct) sumPct.textContent = overallTotal===0 ? '0%' : Math.round((overallDone/overallTotal)*100)+'%';

  // Highlight only today row
  const todayIdx = (new Date()).getDay();
  DAYS.forEach((_,i)=>{
    const row = document.getElementById(`row-${i}`);
    if(row){
      row.classList.toggle('today', i === todayIdx);
    }
  });
  const summary = document.getElementById('summaryCard');
  if(summary){
    const todayAcc = (accentColors && accentColors[todayIdx]) ? accentColors[todayIdx] : PALETTE[todayIdx % PALETTE.length];
    summary.style.setProperty('--overall-accent', todayAcc);
  }
}

// expose small helpers for debugging in console
window.__weekTasks = weekTasks;
window.saveWeek = ()=>{ saveTasks(); alert('Saved'); };
window.clearWeek = ()=>{ localStorage.removeItem(STORAGE_KEY); location.reload(); };

// Toasts
function ensureToastContainer(){
  let container = document.getElementById('toastContainer');
  if(!container){
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    const stack = document.createElement('div');
    stack.className = 'stack';
    container.appendChild(stack);
    document.body.appendChild(container);
  }
  return container.querySelector('.stack');
}

function showToast(message, type = 'success', duration = 3000){
  const stack = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role','status');
  toast.setAttribute('aria-live','polite');
  const icon = document.createElement('span'); icon.className='icon'; icon.textContent = type === 'error' ? '⚠' : '✓';
  const msg = document.createElement('span'); msg.className='msg'; msg.textContent = message;
  const close = document.createElement('button'); close.className='close'; close.setAttribute('aria-label','Dismiss'); close.textContent='✕';
  const remove = () => { toast.classList.remove('show'); setTimeout(()=> toast.remove(), 250); };
  close.addEventListener('click', ()=>{ clearTimeout(timer); remove(); });
  toast.appendChild(icon); toast.appendChild(msg); toast.appendChild(close);
  stack.appendChild(toast);
  // allow CSS transition
  requestAnimationFrame(()=> toast.classList.add('show'));
  const timer = setTimeout(remove, duration);
}

// Styled confirm modal
function showConfirm({ title = 'Confirm', message = 'Are you sure?', confirmText = 'Confirm', cancelText = 'Cancel', tone = 'primary' } = {}){
  return new Promise(resolve => {
    const active = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');

    const modal = document.createElement('div');
    modal.className = 'modal';
    const h = document.createElement('h3'); h.className='title'; h.textContent = title;
    const p = document.createElement('p'); p.className='body'; p.textContent = message;
    const actions = document.createElement('div'); actions.className='actions';
    const cancel = document.createElement('button'); cancel.type='button'; cancel.className='button-secondary'; cancel.textContent = cancelText;
    const confirm = document.createElement('button'); confirm.type='button'; confirm.textContent = confirmText;
    if(tone === 'danger'){ confirm.className = 'button-danger'; } else { /* primary */ }
    actions.appendChild(cancel); actions.appendChild(confirm);
    modal.appendChild(h); modal.appendChild(p); modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // show with transition
    requestAnimationFrame(()=> overlay.classList.add('show'));

    const cleanup = (val)=>{
      overlay.classList.remove('show');
      setTimeout(()=>{ overlay.remove(); if(active && active.focus) active.focus(); }, 150);
      resolve(val);
    };

    cancel.addEventListener('click', ()=> cleanup(false));
    confirm.addEventListener('click', ()=> cleanup(true));
    overlay.addEventListener('click', (e)=>{ if(e.target === overlay) cleanup(false); });
    document.addEventListener('keydown', function onKey(e){
      if(!document.body.contains(overlay)) { document.removeEventListener('keydown', onKey); return; }
      if(e.key === 'Escape'){ e.preventDefault(); cleanup(false); document.removeEventListener('keydown', onKey); }
      if(e.key === 'Enter'){ e.preventDefault(); cleanup(true); document.removeEventListener('keydown', onKey); }
    });
    // focus first action
    cancel.focus();
  });
}

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((registration) => {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
  });
}