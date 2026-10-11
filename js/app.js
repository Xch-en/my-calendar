'use strict';

/* ===================== 数据层：Dexie / IndexedDB ===================== */
const db = new Dexie('my-calendar');
db.version(1).stores({
  // ++id 自增主键；start 建索引，便于以后按时间范围查询
  events: '++id, start'
});
db.version(2).stores({
  events: '++id, start',
  todos: '++id, createdAt' // 待办：尚未安排到日历的事项
});

const EVENT_COLORS = ['#5b7cfa', '#22b8a0', '#f2994a', '#eb5d94', '#9b6df2'];

function colorFor(id) {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return EVENT_COLORS[h % EVENT_COLORS.length];
}

function rowToEvent(row) {
  return {
    id: String(row.id),
    title: row.title,
    start: row.start,           // ISO 字符串
    end: row.end,
    backgroundColor: colorFor(row.id),
    extendedProps: { location: row.location || '' }
  };
}

/* ===================== 工具 ===================== */
function toLocalInput(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ===================== 表单弹层 ===================== */
const overlay = document.getElementById('overlay');
const form = document.getElementById('event-form');
const fTitle = document.getElementById('f-title');
const fLoc = document.getElementById('f-location');
const fStart = document.getElementById('f-start');
const fEnd = document.getElementById('f-end');
const formError = document.getElementById('form-error');
const sheetHeading = document.getElementById('sheet-heading');
const btnDelete = document.getElementById('btn-delete');

let editingId = null;   // null = 新建
let deleteArmed = false;
let sourceTodoId = null; // 由待办转建事项时，记录待办 id，保存成功后将其消耗
let suppressCreateUntil = 0; // 关闭弹层后的一小段时间内，点空白不触发新建（防止“收起表单”的那一下误触）

function openSheet() {
  overlay.hidden = false;
  void overlay.offsetWidth; // 强制回流，保证过渡动画生效
  overlay.classList.add('show');
}

function closeSheet() {
  suppressCreateUntil = performance.now() + 400; // 关掉弹层后的第一下点击视为“回到时间轴”，不当作新建
  overlay.classList.remove('show');
  setTimeout(() => {
    overlay.hidden = true;
    form.reset();
    formError.textContent = '';
    btnDelete.hidden = true;
    disarmDelete();
    editingId = null;
    sourceTodoId = null;
  }, 220);
}

function disarmDelete() {
  deleteArmed = false;
  btnDelete.classList.remove('armed');
  btnDelete.textContent = '删除';
}

function openCreate(start, end, preset = {}) {
  editingId = null;
  sourceTodoId = preset.todoId ?? null;
  sheetHeading.textContent = '新建事项';
  btnDelete.hidden = true;
  fTitle.value = preset.title || '';
  fLoc.value = preset.location || '';
  fStart.value = toLocalInput(start);
  fEnd.value = toLocalInput(end);
  openSheet();
  if (matchMedia('(hover: hover)').matches) setTimeout(() => fTitle.focus(), 240);
}

function openEdit(ev) {
  editingId = Number(ev.id);
  sheetHeading.textContent = '事项详情';
  btnDelete.hidden = false;
  disarmDelete();
  fTitle.value = ev.title;
  fLoc.value = ev.extendedProps.location || '';
  fStart.value = toLocalInput(ev.start);
  fEnd.value = toLocalInput(ev.end);
  openSheet();
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const title = fTitle.value.trim();
  const start = new Date(fStart.value);
  const end = new Date(fEnd.value);
  if (!title) { formError.textContent = '请填写标题'; fTitle.focus(); return; }
  if (isNaN(start) || isNaN(end)) { formError.textContent = '请填写开始和结束时间'; return; }
  if (end <= start) { formError.textContent = '结束时间必须晚于开始时间'; return; }

  const rec = {
    title,
    location: fLoc.value.trim(),
    start: start.toISOString(),
    end: end.toISOString()
  };
  try {
    if (editingId == null) {
      await db.events.add(rec);
      toast('已添加');
      if (sourceTodoId != null) { // 从待办转建 → 消耗该待办
        await db.todos.delete(sourceTodoId);
        renderTodos();
      }
    } else {
      await db.events.update(editingId, rec);
      toast('已保存');
    }
    calendar.refetchEvents();
    closeSheet();
  } catch (err) {
    formError.textContent = '保存失败，请重试';
  }
});

/* 删除需要二次确认（再次点击） */
btnDelete.addEventListener('click', async () => {
  if (!deleteArmed) {
    deleteArmed = true;
    btnDelete.textContent = '确认删除？';
    btnDelete.classList.add('armed');
    setTimeout(disarmDelete, 2500);
    return;
  }
  try {
    await db.events.delete(editingId);
    calendar.refetchEvents();
    toast('已删除');
  } catch (err) {
    toast('删除失败');
  }
  closeSheet();
});

document.getElementById('btn-cancel').addEventListener('click', closeSheet);
overlay.addEventListener('click', e => { if (e.target === overlay) closeSheet(); });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !overlay.hidden) closeSheet();
});

/* ===================== 日历 ===================== */
function formatTitle(info) {
  // currentStart 是逻辑起点（周一 / 当月1号），info.start 可能含上月溢出的日期
  const s = info.view.currentStart;
  if (info.view.type === 'dayGridMonth') return `${s.getFullYear()}年${s.getMonth() + 1}月`;
  const e = new Date(info.view.currentEnd.getTime() - 1); // currentEnd 为排他边界
  const y = s.getFullYear();
  if (s.getMonth() === e.getMonth()) {
    return `${y}年${s.getMonth() + 1}月${s.getDate()}日 - ${e.getDate()}日`;
  }
  return `${y}年${s.getMonth() + 1}月${s.getDate()}日 - ${e.getMonth() + 1}月${e.getDate()}日`;
}

const calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
  locale: 'zh-cn',
  initialView: 'timeGridWeek',   // 默认周视图（时间格子）
  headerToolbar: false,          // 用自定义顶栏替代
  height: '100%',
  expandRows: true,

  // 周视图时间格子
  allDaySlot: false,
  slotMinTime: '00:00:00',
  slotMaxTime: '24:00:00',
  slotDuration: '00:30',
  snapDuration: '00:15',
  slotLabelInterval: '01:00',
  scrollTime: '07:00:00',
  slotEventOverlap: false, // 重叠事项竖排并列显示，而不是层叠压盖
  slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },

  // 月视图
  dayMaxEventRows: 3,
  fixedWeekCount: false,
  dayPopoverFormat: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
  moreLinkText: n => `+${n}`,

  // 交互
  selectable: true,
  selectMirror: true,
  editable: true, // 事项可整体拖动，直接改时间
  eventResizableFromStart: true, // 事项上、下边缘均可拖动改时间
  eventDurationEditable: true,
  autoScroll: true, // 拖动/拉伸到视图上下边缘时，时间轴自动滚动
  longPressDelay: 250, // 触屏长按 250ms 即可开始拖动/拉伸（默认 1000ms 太迟钝）
  eventLongPressDelay: 250,
  events(fetchInfo, successCallback, failureCallback) {
    db.events.toArray()
      .then(rows => successCallback(rows.map(rowToEvent)))
      .catch(failureCallback);
  },
  dayHeaderContent(arg) {
    const wd = arg.date.toLocaleDateString('zh-CN', { weekday: 'short' });
    return { html: `<div class="dh"><span class="dh-wd">${wd}</span><span class="dh-day">${arg.date.getDate()}</span></div>` };
  },
  eventContent(info) {
    const ev = info.event;
    const loc = ev.extendedProps.location;
    // 不显示时间行，标题直接置顶，短事项也能看清名称
    return {
      html: `<div class="ev-title">${escapeHtml(ev.title)}</div>` +
             (loc ? `<div class="ev-loc">${escapeHtml(loc)}</div>` : '')
    };
  },
  datesSet(info) {
    document.getElementById('date-title').textContent = formatTitle(info);
    const now = new Date();
    document.getElementById('btn-today').disabled = info.start <= now && now < info.end;
  },

  /* 点空白处 / 拖选时间段 → 新建 */
  dateClick(info) {
    if (trayExpanded) { // 抽屉展开时，点日历 = 收回抽屉，不新建
      setTray(false);
      suppressCreateUntil = performance.now() + 400; // 同一次点击随后触发的 select/dateClick 一并拦下
      return;
    }
    if (performance.now() < suppressCreateUntil) return; // 刚回到时间轴的那一下，不新建
    let start;
    if (info.allDay) { // 月视图点击某天，默认当天 9:00（今天则取下个半点）
      start = new Date(info.date);
      const now = new Date();
      if (start.toDateString() === now.toDateString()) {
        start.setHours(now.getHours(), now.getMinutes() <= 30 ? 30 : 60, 0, 0);
      } else {
        start.setHours(9, 0, 0, 0);
      }
    } else {
      start = info.date;
    }
    openCreate(start, new Date(start.getTime() + 3600000));
  },
  select(info) {
    calendar.unselect();
    if (trayExpanded) { // 抽屉展开时，点日历 = 收回抽屉，不新建
      setTray(false);
      suppressCreateUntil = performance.now() + 400;
      return;
    }
    if (performance.now() < suppressCreateUntil) return;
    if (info.allDay) { // 月视图点选某天
      const s = new Date(info.start);
      s.setHours(9, 0, 0, 0);
      openCreate(s, new Date(s.getTime() + 3600000));
      return;
    }
    let { start, end } = info;
    if (end - start < 3600000) end = new Date(start.getTime() + 3600000); // 轻点默认 1 小时
    openCreate(start, end);
  },

  /* 把待办从底部托盘拖进日历 → 创建默认 1 小时的事项 */
  drop(info) {
    let start;
    if (info.allDay) { // 月视图拖到某天，默认当天 9:00
      start = new Date(info.date);
      start.setHours(9, 0, 0, 0);
    } else {
      start = info.date;
    }
    scheduleTodo(Number(info.draggedEl.dataset.id), start);
  },

  /* 点已有事项 → 查看 / 编辑 / 删除 */
  eventClick(info) {
    info.jsEvent.preventDefault();
    openEdit(info.event);
  },

  /* 拖拽 / 拉伸调整时间，自动落库 */
  eventDrop: persistTimeChange,
  eventResize: persistTimeChange
});

async function persistTimeChange(info) {
  try {
    await db.events.update(Number(info.event.id), {
      start: info.event.start.toISOString(),
      end: info.event.end.toISOString()
    });
    toast('时间已更新');
  } catch (err) {
    info.revert();
    toast('保存失败');
  }
}

calendar.render();

/* ===================== 顶栏控件 ===================== */
document.getElementById('btn-prev').addEventListener('click', () => calendar.prev());
document.getElementById('btn-next').addEventListener('click', () => calendar.next());
document.getElementById('btn-today').addEventListener('click', () => calendar.today());

const segBtns = document.querySelectorAll('.seg-btn');
segBtns.forEach(btn => btn.addEventListener('click', () => {
  if (btn.classList.contains('active')) return;
  segBtns.forEach(b => {
    b.classList.toggle('active', b === btn);
    b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
  });
  calendar.changeView(btn.dataset.view);
}));

/* 悬浮 + 按钮：默认从下个半点开始的 1 小时 */
document.getElementById('btn-add').addEventListener('click', () => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(now.getHours(), now.getMinutes() <= 30 ? 30 : 60, 0, 0);
  openCreate(start, new Date(start.getTime() + 3600000));
});

/* ===================== 底部待办托盘 ===================== */
const todoInput = document.getElementById('todo-input');
const todoList = document.getElementById('todo-list');

async function renderTodos() {
  const todos = await db.todos.orderBy('createdAt').toArray();
  document.getElementById('todo-count').textContent = todos.length;
  todoList.innerHTML = '';
  if (!todos.length) {
    const empty = document.createElement('span');
    empty.className = 'todo-empty';
    empty.textContent = '暂无待办，添加后按住左侧把手拖到日历安排时间';
    todoList.appendChild(empty);
    return;
  }
  for (const t of todos) {
    const item = document.createElement('div');
    item.className = 'todo-item';

    // 左侧拖动把手：唯一可拖区域。无文字 + touch-action:none，
    // 按下立即接管手势——不滚动列表、不触发系统选字/识别菜单
    const handle = document.createElement('div');
    handle.className = 'todo-handle';
    handle.dataset.id = t.id;
    handle.title = '按住拖到日历安排时间';
    const grip = document.createElement('span');
    grip.className = 'todo-grip';
    grip.textContent = '⠿';
    handle.appendChild(grip);

    // 标题区：点按转表单新建
    const chip = document.createElement('div');
    chip.className = 'todo-chip';
    chip.title = `${t.title}（点按转新建表单）`;
    const title = document.createElement('span');
    title.className = 'todo-title';
    title.textContent = t.title;
    chip.appendChild(title);
    chip.addEventListener('click', () => {
      const now = new Date();
      const start = new Date(now);
      start.setHours(now.getHours(), now.getMinutes() <= 30 ? 30 : 60, 0, 0);
      openCreate(start, new Date(start.getTime() + 3600000), { title: t.title, todoId: t.id });
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'todo-x';
    del.setAttribute('aria-label', '删除待办');
    del.textContent = '×';
    del.addEventListener('click', async e => {
      e.stopPropagation();
      await db.todos.delete(t.id);
      renderTodos();
    });

    item.append(handle, chip, del);
    todoList.appendChild(item);
  }
}

async function addTodo() {
  const title = todoInput.value.trim();
  if (!title) { todoInput.focus(); return; }
  await db.todos.add({ title, createdAt: Date.now() });
  todoInput.value = '';
  renderTodos();
}
document.getElementById('todo-add').addEventListener('click', addTodo);
todoInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });

/* ===================== 待办抽屉：展开 / 收起 ===================== */
const appEl = document.getElementById('app');
const tray = document.getElementById('todo-tray');
const drawerBar = document.getElementById('todo-drawer-bar');
const drawerToggle = document.getElementById('todo-toggle');
let trayExpanded = false;

function collapsedH() {
  const safe = parseFloat(getComputedStyle(tray).paddingBottom) || 0;
  return drawerBar.offsetHeight + safe;
}
function expandedH() { return Math.round(appEl.clientHeight * 0.65); } // 大半个屏幕

function setTray(expanded) {
  trayExpanded = expanded;
  tray.classList.toggle('expanded', expanded);
  appEl.classList.toggle('tray-open', expanded);
  tray.style.height = expanded ? expandedH() + 'px' : '';
  // 抽屉高度变化会挤压日历，动画结束后同步一次尺寸，保证点击/落点命中不偏移
  setTimeout(() => calendar.updateSize(), 320);
}

function toggleTray() { setTray(!trayExpanded); }
drawerToggle.addEventListener('click', e => { e.stopPropagation(); toggleTray(); });
drawerToggle.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTray(); }
});
window.addEventListener('resize', () => { if (trayExpanded) setTray(true); });

/* 抽屉条手势：跟手上拉展开、下拉收起，松手自动吸附到最近状态 */
let pulling = false, pullMoved = false, pullStartY = 0, pullStartH = 0;
drawerBar.addEventListener('pointerdown', e => {
  if (e.target.closest('.drawer-toggle')) return;
  pulling = true;
  pullMoved = false;
  pullStartY = e.clientY;
  pullStartH = tray.offsetHeight;
  drawerBar.setPointerCapture(e.pointerId);
});
drawerBar.addEventListener('pointermove', e => {
  if (!pulling) return;
  const dy = pullStartY - e.clientY; // 上拉为正
  if (!pullMoved && Math.abs(dy) < 6) return; // 小位移视为点按
  pullMoved = true;
  tray.classList.add('dragging');
  const h = Math.min(Math.max(pullStartH + dy, collapsedH()), expandedH());
  tray.style.height = h + 'px';
});
function endPull() {
  if (!pulling) return;
  pulling = false;
  tray.classList.remove('dragging');
  if (pullMoved) {
    setTray(tray.offsetHeight > (collapsedH() + expandedH()) / 2);
  } else {
    toggleTray(); // 没有拖动 → 点按切换
  }
}
drawerBar.addEventListener('pointerup', endPull);
drawerBar.addEventListener('pointercancel', endPull);

/* 拖动待办：指针一进入日历区域就收回抽屉，不用等松手 */
let todoDragActive = false;    // 正在从清单拖动待办
let collapsedForDrag = false;  // 本次拖动是否已触发收回
todoList.addEventListener('pointerdown', e => {
  if (!e.target.closest('.todo-handle')) return;
  todoDragActive = true;
  collapsedForDrag = false;
});
document.addEventListener('pointermove', e => {
  if (!todoDragActive || collapsedForDrag || !trayExpanded) return;
  const r = document.querySelector('.cal-wrap').getBoundingClientRect();
  if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY < r.bottom) {
    collapsedForDrag = true;
    setTray(false);
    requestAnimationFrame(() => calendar.updateSize()); // 立即同步，保证落点准确
  }
}, { passive: true });
document.addEventListener('pointerup', () => { todoDragActive = false; });
document.addEventListener('pointercancel', () => { todoDragActive = false; });

/* 拖放到日历后：创建默认 1 小时的事项，并消耗该待办 */
async function scheduleTodo(todoId, start) {
  const todo = await db.todos.get(todoId);
  if (!todo) return;
  const end = new Date(start.getTime() + 3600000);
  await db.transaction('rw', db.events, db.todos, async () => {
    await db.events.add({
      title: todo.title,
      location: '',
      start: start.toISOString(),
      end: end.toISOString()
    });
    await db.todos.delete(todoId);
  });
  calendar.refetchEvents();
  renderTodos();
  setTray(false); // 安排完成后自动收回抽屉，露出日历看安排结果
  toast(`已安排「${todo.title}」`);
}

/* FullCalendar 外部拖拽：只认行首把手。把手无滚动冲突，
   触屏按住 150ms 即可跟手拖动（长按不会弹系统菜单） */
new FullCalendar.Draggable(document.getElementById('todo-tray'), {
  itemSelector: '.todo-handle',
  longPressDelay: 150,
  autoscroll: true // 拖到日历边缘时自动滚动时间轴
});

renderTodos();

/* 触屏长按不再弹出系统的复制/选择菜单（配合 CSS user-select:none 双保险） */
document.addEventListener('contextmenu', e => {
  if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) e.preventDefault();
});

/* 暴露给控制台调试 / 自动化测试 */
window.__app = { calendar, db };

/* ===================== PWA：注册 Service Worker ===================== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('Service Worker 注册失败：', err);
    });
  });
}
