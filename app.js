(() => {
  "use strict";

  /** Top-level = depth 0; children allowed while depth < 5 → 6 levels total. */
  const MAX_DEPTH = 5;
  const API = {
    projects: "/api/projects",
    journals: "/api/journals",
    messages: "/api/messages",
    chat: "/api/messages/chat",
  };

  /**
   * @typedef {{
   *   id: string,
   *   name: string,
   *   createdAt: string,
   *   completedAt: string | null,
   *   completed: boolean,
   *   archived: boolean,
   *   collapsed?: boolean,
   *   children: Project[]
   * }} Project
   *
   * @typedef {{
   *   id: string,
   *   text: string,
   *   projectId: string | null
   * }} JournalItem
   *
   * @typedef {{
   *   learning: JournalItem[],
   *   improve: JournalItem[],
   *   thoughts: string
   * }} JournalEntry
   */

  /** @type {Project[]} */
  let projects = [];
  /** @type {Record<string, JournalEntry>} */
  let journals = {};
  /** @type {{ id: string, role: string, content: string, kind?: string, title?: string|null, unread?: boolean, createdAt?: string }[]} */
  let chatMessages = [];
  /** @type {number} */
  let unreadCount = 0;
  /** @type {boolean} */
  let chatBusy = false;
  /** @type {boolean} */
  let detailsEditing = false;
  /** @type {"active" | "archived"} */
  let currentView = "active";
  /** @type {string | null} */
  let selectedId = null;
  /** @type {string | null} */
  let dragId = null;
  /** @type {"project" | "journal" | "weekly"} */
  let detailMode = "project";
  /** @type {string} */
  let journalDate = todayKey();
  /** @type {string | null} */
  let selectedWeeklyId = null;
  /** @type {null | "history" | "messages"} */
  let rightPanel = null;
  /** @type {boolean} */
  let journalEditing = false;

  const treeEl = document.getElementById("tree");
  const emptyEl = document.getElementById("empty");
  const detailEl = document.getElementById("detail");
  const menuEl = document.getElementById("menu");
  const promptDialog = document.getElementById("prompt-dialog");
  const promptForm = document.getElementById("prompt-form");
  const promptTitle = document.getElementById("prompt-title");
  const promptInput = document.getElementById("prompt-input");
  const confirmDialog = document.getElementById("confirm-dialog");
  const confirmForm = document.getElementById("confirm-form");
  const confirmTitle = document.getElementById("confirm-title");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmOk = document.getElementById("confirm-ok");
  const addTopBtn = document.getElementById("add-top");
  const toggleAllBtn = document.getElementById("toggle-all");
  const btnToday = document.getElementById("btn-today");
  const btnCalendar = document.getElementById("btn-calendar");
  const btnMessages = document.getElementById("btn-messages");
  const detailToolbar = document.getElementById("detail-toolbar");
  const toolbarActions = document.getElementById("toolbar-actions");
  const historySidebar = document.getElementById("history-sidebar");
  const historyList = document.getElementById("history-list");
  const historyEmpty = document.getElementById("history-empty");
  const historyCollapse = document.getElementById("history-collapse");
  const messagesSidebar = document.getElementById("messages-sidebar");
  const messagesList = document.getElementById("messages-list");
  const messagesBadge = document.getElementById("messages-badge");
  const messagesCollapse = document.getElementById("messages-collapse");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatSend = document.getElementById("chat-send");
  const chatPresets = document.getElementById("chat-presets");

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatJournalDate(key) {
    const [y, m, day] = key.split("-").map(Number);
    if (!y || !m || !day) return key;
    const d = new Date(y, m - 1, day);
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    return `${y} 年 ${m} 月 ${day} 日 · 周${weekdays[d.getDay()]}`;
  }

  function formatHistoryDate(key) {
    const [y, m, day] = key.split("-").map(Number);
    if (!y || !m || !day) return key;
    return `${m} 月 ${day} 日`;
  }

  /** @param {JournalEntry} entry */
  function journalHasContent(entry) {
    if (!entry) return false;
    if (typeof entry.thoughts === "string" && entry.thoughts.trim()) return true;
    const lists = [entry.learning, entry.improve];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      if (list.some((item) => item && String(item.text || "").trim())) return true;
    }
    return false;
  }

  /** @param {JournalEntry} entry */
  function journalSummary(entry) {
    const learn = Array.isArray(entry.learning)
      ? entry.learning.filter((i) => String(i.text || "").trim()).length
      : 0;
    const improve = Array.isArray(entry.improve)
      ? entry.improve.filter((i) => String(i.text || "").trim()).length
      : 0;
    const parts = [];
    if (learn) parts.push(`学习 ${learn}`);
    if (improve) parts.push(`精进 ${improve}`);
    if (entry.thoughts && entry.thoughts.trim()) parts.push("思考");
    return parts.length ? parts.join(" · ") : "空记录";
  }

  function listJournalDates() {
    const today = todayKey();
    const keys = new Set(Object.keys(journals).filter((k) => journalHasContent(journals[k])));
    keys.add(today);
    if (detailMode === "journal") keys.add(journalDate);
    return Array.from(keys).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }

  async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.json();
  }

  async function apiSend(url, method, body) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = JSON.stringify(await res.json());
      } catch {
        /* ignore */
      }
      throw new Error(`${method} ${url} failed: ${res.status} ${detail}`);
    }
    return res.status === 204 ? null : res.json();
  }

  function updateMessagesBadge() {
    if (!messagesBadge) return;
    if (unreadCount > 0) {
      messagesBadge.hidden = false;
      messagesBadge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
      btnMessages.classList.add("has-unread");
    } else {
      messagesBadge.hidden = true;
      messagesBadge.textContent = "";
      btnMessages.classList.remove("has-unread");
    }
  }

  async function loadFromServer() {
    const [p, j, m] = await Promise.all([
      apiGet(API.projects),
      apiGet(API.journals),
      apiGet(API.messages),
    ]);
    projects = Array.isArray(p) ? p : [];
    journals = j && typeof j === "object" ? j : {};
    if (Array.isArray(m)) {
      chatMessages = m;
      unreadCount = m.filter((x) => x.kind === "weekly" && x.unread).length;
    } else {
      chatMessages = Array.isArray(m?.messages) ? m.messages : [];
      unreadCount = Number(m?.unread || 0);
    }
    updateMessagesBadge();
  }

  function save() {
    apiSend(API.projects, "PUT", projects).catch((err) => {
      console.error(err);
      alert("项目保存失败，请检查服务器连接");
    });
  }

  function saveJournals() {
    apiSend(API.journals, "PUT", journals).catch((err) => {
      console.error(err);
      alert("日记保存失败，请检查服务器连接");
    });
  }

  function loadJournals() {
    return journals;
  }

  /** @returns {JournalEntry} */
  function emptyJournal() {
    return { learning: [], improve: [], thoughts: "" };
  }

  /** @param {string} dateKey */
  function ensureJournal(dateKey) {
    if (!journals[dateKey]) {
      journals[dateKey] = emptyJournal();
    }
    const entry = journals[dateKey];
    if (!Array.isArray(entry.learning)) entry.learning = [];
    if (!Array.isArray(entry.improve)) entry.improve = [];
    if (typeof entry.thoughts !== "string") entry.thoughts = "";
    return entry;
  }

  /** @param {string} [text] */
  function createJournalItem(text = "") {
    return { id: uid(), text, projectId: null };
  }

  /** @param {string} name */
  function createProject(name) {
    return {
      id: uid(),
      name: name.trim(),
      createdAt: nowISO(),
      completedAt: null,
      completed: false,
      archived: false,
      collapsed: false,
      details: "",
      progress: "",
      children: [],
    };
  }

  /**
   * @param {Project[]} list
   * @param {string} id
   * @param {Project | null} parent
   * @param {number} depth
   * @returns {{ node: Project, parent: Project | null, siblings: Project[], index: number, depth: number } | null}
   */
  function locate(list, id, parent = null, depth = 0) {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      if (node.id === id) {
        return { node, parent, siblings: list, index: i, depth };
      }
      const found = locate(node.children, id, node, depth + 1);
      if (found) return found;
    }
    return null;
  }

  /** Subtree height in levels (1 = leaf). */
  function subtreeHeight(node) {
    if (!node.children.length) return 1;
    return 1 + Math.max(...node.children.map(subtreeHeight));
  }

  /** Would nesting `drag` under `target` exceed max depth? targetDepth is depth of target. */
  function canNestUnder(dragNode, targetDepth) {
    const resultingDepthOfDragRoot = targetDepth + 1;
    const deepest = resultingDepthOfDragRoot + subtreeHeight(dragNode) - 1;
    return deepest <= MAX_DEPTH;
  }

  function isAncestor(ancestorId, maybeDescendantId) {
    const loc = locate(projects, ancestorId);
    if (!loc) return false;
    function walk(n) {
      if (n.id === maybeDescendantId) return true;
      return n.children.some(walk);
    }
    return walk(loc.node);
  }

  /**
   * Mark complete/incomplete. Top-level roots auto-archive when completed
   * (and un-archive when unchecked); nested nodes never archive.
   * @param {Project} node
   * @param {boolean} completed
   * @param {boolean} isTopLevel
   */
  function setCompleted(node, completed, isTopLevel) {
    node.completed = completed;
    node.completedAt = completed ? nowISO() : null;
    if (isTopLevel) {
      node.archived = completed;
    }
  }

  function removeNode(id) {
    const loc = locate(projects, id);
    if (!loc) return null;
    const [removed] = loc.siblings.splice(loc.index, 1);
    return removed;
  }

  function visibleRoots() {
    return projects.filter((p) =>
      currentView === "archived" ? p.archived : !p.archived
    );
  }

  function pathNames(id) {
    const parts = [];
    function walk(list, trail) {
      for (const n of list) {
        const next = [...trail, n.name];
        if (n.id === id) {
          parts.push(...next);
          return true;
        }
        if (walk(n.children, next)) return true;
      }
      return false;
    }
    walk(projects, []);
    return parts;
  }

  /** Flatten all projects for linking selects. */
  function flattenProjects() {
    /** @type {{ id: string, label: string }[]} */
    const out = [];
    function walk(list, trail) {
      for (const n of list) {
        const next = [...trail, n.name];
        out.push({ id: n.id, label: next.join(" / ") });
        walk(n.children, next);
      }
    }
    walk(projects, []);
    return out;
  }

  // —— Prompt dialog ——
  /** @returns {Promise<string | null>} */
  function askName(title, initial = "") {
    return new Promise((resolve) => {
      promptTitle.textContent = title;
      promptInput.value = initial;
      const onClose = () => {
        promptDialog.removeEventListener("close", onClose);
        if (promptDialog.returnValue === "ok") {
          const v = promptInput.value.trim();
          resolve(v || null);
        } else {
          resolve(null);
        }
      };
      promptDialog.addEventListener("close", onClose);
      promptDialog.showModal();
      promptInput.focus();
      promptInput.select();
    });
  }

  promptForm.addEventListener("submit", (e) => {
    const submitter = e.submitter;
    if (submitter && submitter.value === "cancel") {
      promptDialog.returnValue = "cancel";
    } else {
      promptDialog.returnValue = "ok";
    }
  });

  /**
   * In-app confirm — WKWebView may not support window.confirm.
   * @param {string} message
   * @param {{ title?: string, okText?: string, danger?: boolean }} [opts]
   * @returns {Promise<boolean>}
   */
  function askConfirm(message, opts = {}) {
    return new Promise((resolve) => {
      confirmTitle.textContent = opts.title || "确认";
      confirmMessage.textContent = message;
      confirmOk.textContent = opts.okText || "确定";
      confirmOk.classList.toggle("btn-danger", !!opts.danger);
      const onClose = () => {
        confirmDialog.removeEventListener("close", onClose);
        resolve(confirmDialog.returnValue === "ok");
      };
      confirmDialog.addEventListener("close", onClose);
      confirmDialog.showModal();
      confirmOk.focus();
    });
  }

  confirmForm.addEventListener("submit", (e) => {
    const submitter = e.submitter;
    if (submitter && submitter.value === "cancel") {
      confirmDialog.returnValue = "cancel";
    } else {
      confirmDialog.returnValue = "ok";
    }
  });

  // —— Context menu ——
  function hideMenu() {
    menuEl.hidden = true;
    menuEl.innerHTML = "";
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{ label: string, danger?: boolean, sepBefore?: boolean, action: () => void, icon: string }[]} items
   */
  function showMenu(x, y, items) {
    menuEl.innerHTML = "";
    for (const item of items) {
      if (item.sepBefore) {
        const sep = document.createElement("div");
        sep.className = "menu-sep";
        menuEl.appendChild(sep);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-item" + (item.danger ? " is-danger" : "");
      btn.setAttribute("role", "menuitem");
      btn.innerHTML = `${item.icon}<span>${item.label}</span>`;
      btn.addEventListener("click", () => {
        hideMenu();
        item.action();
      });
      menuEl.appendChild(btn);
    }
    menuEl.hidden = false;
    const rect = menuEl.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    menuEl.style.left = `${Math.max(8, left)}px`;
    menuEl.style.top = `${Math.max(8, top)}px`;
  }

  document.addEventListener("pointerdown", (e) => {
    if (!menuEl.hidden && !menuEl.contains(e.target)) hideMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideMenu();
  });

  const ICONS = {
    rename: `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M6 10l5-5M11 5v2.5M11 5H8.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    trash: `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 5h9M6 5V3.5h4V5M6.5 7v4.5M9.5 7v4.5M4.5 5l.6 7.2A1 1 0 006.1 13h3.8a1 1 0 00.99-.8L11.5 5" stroke-linecap="round"/></svg>`,
  };

  function openRowMenu(project, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    /** @type {{ label: string, danger?: boolean, sepBefore?: boolean, action: () => void, icon: string }[]} */
    const items = [
      {
        label: "重命名",
        icon: ICONS.rename,
        action: async () => {
          const name = await askName("重命名", project.name);
          if (!name) return;
          const loc = locate(projects, project.id);
          if (!loc) return;
          loc.node.name = name;
          save();
          render();
        },
      },
      {
        label: "删除",
        icon: ICONS.trash,
        danger: true,
        sepBefore: true,
        action: async () => {
          const ok = await askConfirm(`确定删除「${project.name}」及其全部子项目？`, {
            title: "删除项目",
            okText: "删除",
            danger: true,
          });
          if (!ok) return;
          removeNode(project.id);
          if (selectedId === project.id) selectedId = null;
          save();
          render();
        },
      },
    ];
    showMenu(rect.left, rect.bottom + 4, items);
  }

  // —— Drag helpers ——
  function clearDropIndicators() {
    treeEl.querySelectorAll(".row").forEach((el) => {
      el.classList.remove("is-drop-target", "is-drop-before", "is-drop-after");
    });
  }

  /**
   * @param {HTMLElement} rowEl
   * @param {DragEvent} e
   * @returns {"before" | "after" | "into"}
   */
  function dropZone(rowEl, e) {
    const inner = rowEl.querySelector(".row-inner");
    const rect = inner.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;
    if (ratio < 0.25) return "before";
    if (ratio > 0.75) return "after";
    return "into";
  }

  /**
   * Apply drag move. zone: before/after = sibling reorder; into = nest as child.
   * @returns {boolean}
   */
  function applyDrop(dragNodeId, targetId, zone) {
    if (dragNodeId === targetId) return false;
    if (isAncestor(dragNodeId, targetId)) return false;

    const dragLoc = locate(projects, dragNodeId);
    const targetLoc = locate(projects, targetId);
    if (!dragLoc || !targetLoc) return false;

    const dragNode = dragLoc.node;

    if (zone === "into") {
      if (!canNestUnder(dragNode, targetLoc.depth)) return false;
      removeNode(dragNodeId);
      const freshTarget = locate(projects, targetId);
      if (!freshTarget) return false;
      freshTarget.node.children.push(dragNode);
      freshTarget.node.collapsed = false;
      return true;
    }

    if (dragNode.id !== targetId) {
      const newDepth = targetLoc.depth;
      const deepest = newDepth + subtreeHeight(dragNode) - 1;
      if (deepest > MAX_DEPTH) return false;
    }

    removeNode(dragNodeId);
    const freshTarget = locate(projects, targetId);
    if (!freshTarget) return false;

    const siblings = freshTarget.siblings;
    const targetIndex = siblings.findIndex((n) => n.id === targetId);
    if (targetIndex === -1) return false;
    const insertAt = targetIndex + (zone === "after" ? 1 : 0);
    siblings.splice(insertAt, 0, dragNode);

    if (freshTarget.parent !== null) {
      dragNode.archived = false;
    }
    return true;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateToolbarState() {
    const panelOpen = rightPanel !== null;
    // Keep toolbar height so the main workspace does not jump when the right panel opens.
    detailToolbar.hidden = false;
    toolbarActions.hidden = false;
    toolbarActions.classList.toggle("is-panel-open", panelOpen);
    historySidebar.hidden = rightPanel !== "history";
    messagesSidebar.hidden = rightPanel !== "messages";
    if (!panelOpen) {
      const isJournal = detailMode === "journal";
      const isToday = journalDate === todayKey();
      btnToday.classList.toggle("is-active", isJournal && isToday);
      btnCalendar.classList.toggle("is-active", false);
      btnMessages.classList.toggle("is-active", false);
    }
  }

  function clearChatContext() {
    chatMessages = chatMessages.filter((m) => m.kind === "weekly");
    chatBusy = false;
    apiSend(API.chat, "DELETE").catch((err) => console.error(err));
  }

  /** @param {null | "history" | "messages"} panel */
  function setRightPanel(panel) {
    const prev = rightPanel;
    rightPanel = panel;
    updateToolbarState();
    if (prev !== null && panel === null) {
      clearChatContext();
    }
    if (panel === "history") renderHistory();
    if (panel === "messages") renderMessages();
  }

  async function deleteJournal(dateKey) {
    const label = formatJournalDate(dateKey);
    const ok = await askConfirm(`确定删除「${label}」的 Today's 0.1？`, {
      title: "删除记录",
      okText: "删除",
      danger: true,
    });
    if (!ok) return false;
    delete journals[dateKey];
    apiSend(`${API.journals}/${encodeURIComponent(dateKey)}`, "DELETE").catch((err) => {
      console.error(err);
      alert("删除失败，请检查服务器连接");
    });
    if (detailMode === "journal" && journalDate === dateKey) {
      detailMode = "project";
      selectedId = null;
      journalEditing = false;
    }
    return true;
  }

  function formatMessageHtml(role, content, pending = false) {
    if (pending || role === "user") {
      return escapeHtml(content).replace(/\n/g, "<br>");
    }
    if (typeof window.renderMarkdown === "function") {
      return window.renderMarkdown(content);
    }
    return escapeHtml(content).replace(/\n/g, "<br>");
  }

  function appendChatBubble(role, content, pending = false) {
    const el = document.createElement("div");
    el.className =
      "chat-bubble md-content " +
      (role === "user" ? "is-user" : "is-assistant") +
      (pending ? " is-pending" : "");
    el.innerHTML = formatMessageHtml(role, content, pending);
    messagesList.appendChild(el);
    messagesList.scrollTop = messagesList.scrollHeight;
    return el;
  }

  async function openWeekly(msg) {
    selectedWeeklyId = msg.id;
    detailMode = "weekly";
    selectedId = null;
    detailsEditing = false;
    journalEditing = false;
    render();

    if (msg.unread) {
      msg.unread = false;
      try {
        const data = await apiSend(`${API.messages}/${encodeURIComponent(msg.id)}/read`, "POST");
        unreadCount = Number(data?.unread ?? Math.max(0, unreadCount - 1));
        updateMessagesBadge();
      } catch (err) {
        console.error(err);
      }
      if (rightPanel === "messages") renderMessages();
    }
  }

  function appendWeeklyCard(msg) {
    const card = document.createElement("button");
    card.type = "button";
    card.className =
      "weekly-card" +
      (msg.unread ? " is-unread" : "") +
      (detailMode === "weekly" && selectedWeeklyId === msg.id ? " is-active" : "");
    card.dataset.id = msg.id;
    card.innerHTML = `
      <span class="weekly-card-title">${escapeHtml(msg.title || "周报")}</span>
      ${msg.unread ? '<span class="weekly-card-dot">新</span>' : ""}
      <span class="weekly-card-chevron" aria-hidden="true">›</span>
    `;
    card.addEventListener("click", () => {
      openWeekly(msg);
    });
    messagesList.appendChild(card);
  }

  function renderWeeklyDetail() {
    const msg = chatMessages.find((m) => m.id === selectedWeeklyId && m.kind === "weekly");
    if (!msg) {
      detailMode = "project";
      selectedWeeklyId = null;
      detailEl.innerHTML = `<p class="detail-placeholder">选择一个项目查看详情，或点击右上角 + 记录 Today's 0.1</p>`;
      return;
    }
    const bodyHtml =
      typeof window.renderMarkdown === "function"
        ? window.renderMarkdown(msg.content || "")
        : escapeHtml(msg.content || "").replace(/\n/g, "<br>");
    const dateLabel = msg.createdAt ? formatDate(msg.createdAt) : "";

    detailEl.innerHTML = `
      <article class="weekly-doc">
        <header class="weekly-doc-header">
          <p class="journal-kicker">周报</p>
          <h2 class="journal-title">${escapeHtml(msg.title || "周报")}</h2>
          ${dateLabel ? `<p class="journal-date">${escapeHtml(dateLabel)}</p>` : ""}
        </header>
        <div class="weekly-doc-body md-content">${bodyHtml}</div>
      </article>
    `;
  }

  function renderMessages() {
    messagesList.innerHTML = "";
    const weekly = chatMessages.filter((m) => m.kind === "weekly");
    const chat = chatMessages.filter((m) => m.kind !== "weekly");

    for (const msg of weekly) appendWeeklyCard(msg);
    for (const msg of chat) appendChatBubble(msg.role, msg.content);
    if (chatBusy) appendChatBubble("assistant", "思考中…", true);
    messagesList.scrollTop = messagesList.scrollHeight;
  }

  async function sendChat(text) {
    const content = String(text || "").trim();
    if (!content || chatBusy) return;
    chatBusy = true;
    chatSend.disabled = true;
    chatPresets?.querySelectorAll("button").forEach((b) => {
      b.disabled = true;
    });
    chatMessages.push({ id: `tmp-${Date.now()}`, role: "user", content, kind: "chat" });
    renderMessages();
    chatInput.value = "";
    try {
      const data = await apiSend(API.chat, "POST", { content });
      chatMessages = chatMessages.filter((m) => !String(m.id).startsWith("tmp-"));
      if (data?.user) chatMessages.push({ ...data.user, kind: data.user.kind || "chat" });
      if (data?.assistant) {
        chatMessages.push({ ...data.assistant, kind: data.assistant.kind || "chat" });
      }
    } catch (err) {
      console.error(err);
      chatMessages.push({
        id: `err-${Date.now()}`,
        role: "assistant",
        kind: "chat",
        content: "发送失败，请稍后重试。",
      });
    } finally {
      chatBusy = false;
      chatSend.disabled = false;
      chatPresets?.querySelectorAll("button").forEach((b) => {
        b.disabled = false;
      });
      renderMessages();
      chatInput.focus();
    }
  }

  /**
   * @param {string} [dateKey]
   * @param {{ edit?: boolean }} [opts]
   */
  async function reloadJournals() {
    try {
      const j = await apiGet(API.journals);
      journals = j && typeof j === "object" ? j : {};
    } catch (err) {
      console.error(err);
    }
  }

  function openJournal(dateKey, opts = {}) {
    journalDate = dateKey || todayKey();
    const entry = ensureJournal(journalDate);
    detailMode = "journal";
    selectedId = null;
    selectedWeeklyId = null;
    if (typeof opts.edit === "boolean") {
      journalEditing = opts.edit;
    } else {
      journalEditing = !journalHasContent(entry);
    }
    render();
  }

  /** Trim blank rows before switching to view mode. */
  function finalizeJournalEntry(entry) {
    entry.learning = entry.learning.filter((i) => String(i.text || "").trim());
    entry.improve = entry.improve.filter((i) => String(i.text || "").trim());
    entry.thoughts = String(entry.thoughts || "").trim();
    for (const item of [...entry.learning, ...entry.improve]) {
      item.text = String(item.text || "").trim();
    }
  }

  function renderHistory() {
    const dates = listJournalDates();
    const today = todayKey();
    historyList.innerHTML = "";
    historyEmpty.hidden = dates.length > 0;

    for (const key of dates) {
      const entry = journals[key] || emptyJournal();
      const row = document.createElement("div");
      row.className =
        "history-item" + (detailMode === "journal" && journalDate === key ? " is-active" : "");
      row.setAttribute("role", "listitem");

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "history-item-main";
      const badge = key === today ? `<span class="history-item-badge">今天</span>` : "";
      openBtn.innerHTML = `
        <span class="history-item-date">${escapeHtml(formatHistoryDate(key))}${badge}</span>
        <span class="history-item-meta">${escapeHtml(key.slice(0, 4))} · ${escapeHtml(journalSummary(entry))}</span>
      `;
      openBtn.addEventListener("click", () => {
        openJournal(key, { edit: false });
      });

      row.appendChild(openBtn);

      if (journalHasContent(entry)) {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "history-item-delete";
        delBtn.title = "删除";
        delBtn.setAttribute("aria-label", `删除 ${formatHistoryDate(key)} 的记录`);
        delBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 5h9M6 5V3.5h4V5M6.5 7v4.5M9.5 7v4.5M4.5 5l.6 7.2A1 1 0 006.1 13h3.8a1 1 0 00.99-.8L11.5 5"/></svg>`;
        delBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!(await deleteJournal(key))) return;
          render();
        });
        row.appendChild(delBtn);
      }

      historyList.appendChild(row);
    }
  }

  // —— Render ——
  function renderProjectOptions(selectedProjectId) {
    const flat = flattenProjects();
    const opts = [`<option value="">关联项目（可选）</option>`];
    for (const p of flat) {
      const sel = p.id === selectedProjectId ? " selected" : "";
      opts.push(`<option value="${escapeHtml(p.id)}"${sel}>${escapeHtml(p.label)}</option>`);
    }
    return opts.join("");
  }

  function projectLabel(projectId) {
    if (!projectId) return "";
    const parts = pathNames(projectId);
    return parts.length ? parts.join(" / ") : "";
  }

  /**
   * @param {"learning" | "improve"} field
   * @param {JournalItem[]} items
   */
  function renderJournalEditList(field, items) {
    if (!items.length) {
      return `<p class="journal-empty-hint">暂无条目，点击「添加」开始记录</p>`;
    }
    return `<ul class="journal-list" data-field="${field}">${items
      .map(
        (item) => `
      <li class="journal-item" data-id="${escapeHtml(item.id)}">
        <textarea class="journal-item-text" rows="2" placeholder="写下一条记录…" data-action="text">${escapeHtml(item.text)}</textarea>
        <div class="journal-item-meta">
          <select class="journal-link" data-action="link" aria-label="关联项目">
            ${renderProjectOptions(item.projectId)}
          </select>
        </div>
        <button type="button" class="journal-item-remove" data-action="remove" title="删除" aria-label="删除此条">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </li>`
      )
      .join("")}</ul>`;
  }

  /**
   * @param {string} title
   * @param {JournalItem[]} items
   */
  function renderJournalViewList(title, items) {
    const filled = items.filter((i) => String(i.text || "").trim());
    if (!filled.length) {
      return `
        <section class="journal-view-section">
          <h3 class="journal-view-heading">${escapeHtml(title)}</h3>
          <p class="journal-view-empty">暂无记录</p>
        </section>`;
    }
    return `
      <section class="journal-view-section">
        <h3 class="journal-view-heading">${escapeHtml(title)}</h3>
        <ol class="journal-view-list">
          ${filled
            .map((item) => {
              const link = projectLabel(item.projectId);
              return `
            <li class="journal-view-item">
              <p class="journal-view-text">${escapeHtml(item.text)}</p>
              ${link ? `<p class="journal-view-link">${escapeHtml(link)}</p>` : ""}
            </li>`;
            })
            .join("")}
        </ol>
      </section>`;
  }

  function renderJournalView(entry, isToday) {
    const thoughts = String(entry.thoughts || "").trim();
    detailEl.innerHTML = `
      <article class="journal journal-view">
        <header class="journal-header journal-view-header">
          <div class="journal-header-main">
            <p class="journal-kicker">${isToday ? "今日记录" : "历史记录"}</p>
            <h2 class="journal-title">Today's 0.1</h2>
            <p class="journal-date">${escapeHtml(formatJournalDate(journalDate))}</p>
          </div>
          <button type="button" class="btn btn-ghost journal-action-btn" id="journal-edit">编辑</button>
        </header>

        ${renderJournalViewList("今日学习", entry.learning)}
        ${renderJournalViewList("后续精进", entry.improve)}

        <section class="journal-view-section">
          <h3 class="journal-view-heading">我的思考</h3>
          ${
            thoughts
              ? `<div class="journal-view-thoughts">${escapeHtml(thoughts).replace(/\n/g, "<br>")}</div>`
              : `<p class="journal-view-empty">暂无记录</p>`
          }
        </section>
      </article>
    `;

    detailEl.querySelector("#journal-edit")?.addEventListener("click", () => {
      journalEditing = true;
      renderJournal();
    });
  }

  function renderJournalEdit(entry, isToday) {
    detailEl.innerHTML = `
      <div class="journal journal-edit">
        <header class="journal-header journal-edit-header">
          <div class="journal-header-main">
            <p class="journal-kicker">${isToday ? "编辑今日" : "编辑记录"}</p>
            <h2 class="journal-title">Today's 0.1</h2>
            <p class="journal-date">${escapeHtml(formatJournalDate(journalDate))}</p>
          </div>
          <div class="journal-edit-actions">
            <button type="button" class="btn btn-ghost journal-action-btn" id="journal-cancel">取消</button>
            <button type="button" class="btn btn-primary journal-action-btn" id="journal-save">保存</button>
          </div>
        </header>

        <section class="journal-section" data-section="learning">
          <div class="journal-section-head">
            <h3 class="journal-section-title">今日学习</h3>
            <button type="button" class="journal-add-item" data-add="learning">
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
              添加
            </button>
          </div>
          ${renderJournalEditList("learning", entry.learning)}
        </section>

        <section class="journal-section" data-section="improve">
          <div class="journal-section-head">
            <h3 class="journal-section-title">后续精进</h3>
            <button type="button" class="journal-add-item" data-add="improve">
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
              添加
            </button>
          </div>
          ${renderJournalEditList("improve", entry.improve)}
        </section>

        <section class="journal-section" data-section="thoughts">
          <div class="journal-section-head">
            <h3 class="journal-section-title">我的思考</h3>
          </div>
          <textarea class="journal-thoughts" id="journal-thoughts" rows="6" placeholder="今天想到了什么？">${escapeHtml(entry.thoughts)}</textarea>
        </section>
      </div>
    `;

    bindJournalEditEvents();
  }

  function renderJournal() {
    const entry = ensureJournal(journalDate);
    const isToday = journalDate === todayKey();

    if (journalEditing) {
      renderJournalEdit(entry, isToday);
    } else {
      renderJournalView(entry, isToday);
    }
    if (rightPanel === "history") renderHistory();
  }

  function bindJournalEditEvents() {
    const entry = ensureJournal(journalDate);

    detailEl.querySelector("#journal-save")?.addEventListener("click", () => {
      finalizeJournalEntry(entry);
      if (!journalHasContent(entry)) {
        delete journals[journalDate];
      }
      saveJournals();
      ensureJournal(journalDate);
      journalEditing = false;
      renderJournal();
    });

    detailEl.querySelector("#journal-cancel")?.addEventListener("click", async () => {
      await reloadJournals();
      ensureJournal(journalDate);
      journalEditing = false;
      renderJournal();
    });

    detailEl.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const field = /** @type {"learning"|"improve"} */ (btn.getAttribute("data-add"));
        entry[field].push(createJournalItem());
        renderJournal();
        const list = detailEl.querySelector(`[data-field="${field}"]`);
        const last = list && list.querySelector(".journal-item:last-child .journal-item-text");
        if (last) last.focus();
      });
    });

    const thoughts = detailEl.querySelector("#journal-thoughts");
    if (thoughts) {
      thoughts.addEventListener("input", () => {
        entry.thoughts = thoughts.value;
      });
    }

    detailEl.querySelectorAll(".journal-item").forEach((li) => {
      const id = li.getAttribute("data-id");
      const field = li.closest("[data-field]")?.getAttribute("data-field");
      if (!id || (field !== "learning" && field !== "improve")) return;

      const textEl = li.querySelector('[data-action="text"]');
      const linkEl = li.querySelector('[data-action="link"]');
      const removeEl = li.querySelector('[data-action="remove"]');

      if (textEl) {
        textEl.addEventListener("input", () => {
          const item = entry[field].find((x) => x.id === id);
          if (!item) return;
          item.text = textEl.value;
        });
      }

      if (linkEl) {
        linkEl.addEventListener("change", () => {
          const item = entry[field].find((x) => x.id === id);
          if (!item) return;
          item.projectId = linkEl.value || null;
        });
      }

      if (removeEl) {
        removeEl.addEventListener("click", () => {
          entry[field] = entry[field].filter((x) => x.id !== id);
          renderJournal();
        });
      }
    });
  }

  function renderDetail() {
    updateToolbarState();

    if (detailMode === "journal") {
      renderJournal();
      return;
    }

    if (detailMode === "weekly") {
      renderWeeklyDetail();
      return;
    }

    if (!selectedId) {
      detailsEditing = false;
      detailEl.innerHTML = `<p class="detail-placeholder">选择一个项目查看详情，或点击右上角 + 记录 Today's 0.1</p>`;
      return;
    }
    const loc = locate(projects, selectedId);
    if (!loc) {
      detailsEditing = false;
      detailEl.innerHTML = `<p class="detail-placeholder">选择一个项目查看详情，或点击右上角 + 记录 Today's 0.1</p>`;
      return;
    }
    const p = loc.node;
    const path = pathNames(p.id).join(" / ");
    const detailsText = p.details || "";
    const progressText = p.progress || "";

    detailEl.innerHTML = `
      <div class="detail-card${p.completed ? " is-done" : ""}">
        <h2>${escapeHtml(p.name)}</h2>
        <p class="detail-path">${escapeHtml(path)}${loc.depth >= MAX_DEPTH ? ' <span class="depth-cap">已达最大深度（6 层）</span>' : ""}</p>
        <dl class="detail-meta">
          <dt>建立日期</dt>
          <dd>${formatDate(p.createdAt)}</dd>
          <dt>完成日期</dt>
          <dd class="${p.completedAt ? "" : "is-empty"}">${p.completedAt ? formatDate(p.completedAt) : "未完成"}</dd>
        </dl>

        <section class="project-section">
          <div class="project-section-head">
            <h3 class="project-section-title">项目详情</h3>
            <div class="project-section-actions">
              ${
                detailsEditing
                  ? `<button type="button" class="btn btn-ghost journal-action-btn" id="details-cancel">取消</button>
                     <button type="button" class="btn btn-primary journal-action-btn" id="details-save">保存</button>`
                  : `<button type="button" class="btn btn-ghost journal-action-btn" id="details-edit">编辑</button>`
              }
            </div>
          </div>
          ${
            detailsEditing
              ? `<textarea class="project-details-editor" id="details-editor" rows="8" placeholder="写下项目背景、目标、备注…">${escapeHtml(detailsText)}</textarea>`
              : detailsText
                ? `<div class="project-details-view">${escapeHtml(detailsText).replace(/\n/g, "<br>")}</div>`
                : `<p class="project-empty">暂无详情，点击编辑补充</p>`
          }
        </section>

        <section class="project-section">
          <div class="project-section-head">
            <h3 class="project-section-title">目前进度</h3>
          </div>
          ${
            progressText
              ? `<div class="project-progress-view">${escapeHtml(progressText).replace(/\n/g, "<br>")}</div>`
              : `<p class="project-empty">暂无进度</p>`
          }
        </section>
      </div>
    `;

    detailEl.querySelector("#details-edit")?.addEventListener("click", () => {
      detailsEditing = true;
      renderDetail();
    });
    detailEl.querySelector("#details-cancel")?.addEventListener("click", () => {
      detailsEditing = false;
      renderDetail();
    });
    detailEl.querySelector("#details-save")?.addEventListener("click", async () => {
      const editor = detailEl.querySelector("#details-editor");
      const next = editor ? editor.value : "";
      p.details = next;
      detailsEditing = false;
      try {
        await apiSend(`${API.projects}/${encodeURIComponent(p.id)}/details`, "PATCH", {
          details: next,
        });
      } catch (err) {
        console.error(err);
        save();
      }
      renderDetail();
    });
  }

  /**
   * @param {Project} project
   * @param {number} depth
   */
  function renderRow(project, depth) {
    const row = document.createElement("div");
    row.className = "row" + (project.completed ? " is-done" : "");
    if (detailMode === "project" && selectedId === project.id) row.classList.add("is-selected");
    row.dataset.id = project.id;
    row.dataset.depth = String(depth);
    row.setAttribute("role", "treeitem");

    const hasChildren = Array.isArray(project.children) && project.children.length > 0;
    if (hasChildren) {
      row.setAttribute("aria-expanded", project.collapsed ? "false" : "true");
    } else {
      row.removeAttribute("aria-expanded");
    }
    const canAddChild = depth < MAX_DEPTH && !project.archived;

    const inner = document.createElement("div");
    inner.className = "row-inner";
    inner.draggable = currentView === "active" && !project.archived;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "row-toggle" + (hasChildren ? "" : " is-leaf");
    if (hasChildren) {
      const collapsed = !!project.collapsed;
      toggle.title = collapsed ? "展开" : "折叠";
      toggle.setAttribute("aria-label", collapsed ? "展开" : "折叠");
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.innerHTML = `<svg class="chevron${collapsed ? " is-collapsed" : ""}" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 5.5h6L8 11z" fill="currentColor"/></svg>`;
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const loc = locate(projects, project.id);
        if (!loc || !loc.node.children.length) return;
        loc.node.collapsed = !loc.node.collapsed;
        save();
        render();
      });
    } else {
      toggle.tabIndex = -1;
      toggle.setAttribute("aria-hidden", "true");
      toggle.disabled = true;
    }

    const checkLabel = document.createElement("label");
    checkLabel.className = "check-wrap";
    checkLabel.title = "完成";
    checkLabel.addEventListener("click", (e) => e.stopPropagation());
    checkLabel.innerHTML = `<input type="checkbox" ${project.completed ? "checked" : ""} aria-label="完成「${escapeHtml(project.name)}」" /><span class="check-mark" aria-hidden="true"></span>`;
    const checkbox = checkLabel.querySelector("input");
    checkbox.addEventListener("change", () => {
      const loc = locate(projects, project.id);
      if (!loc) return;
      const top = loc.parent === null;
      setCompleted(loc.node, checkbox.checked, top);
      if (top && checkbox.checked && currentView === "active" && selectedId === project.id) {
        selectedId = null;
      }
      save();
      render();
    });

    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = project.name;
    label.title = project.name;

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "icon-btn";
    moreBtn.title = "更多";
    moreBtn.setAttribute("aria-label", "更多");
    moreBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="3.5" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="12.5" r="1.2" fill="currentColor"/></svg>`;
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openRowMenu(project, moreBtn);
    });

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "icon-btn";
    addBtn.title = "添加子项目";
    addBtn.setAttribute("aria-label", "添加子项目");
    addBtn.hidden = !canAddChild;
    addBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    addBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (depth >= MAX_DEPTH) return;
      const name = await askName("新建子项目");
      if (!name) return;
      const loc = locate(projects, project.id);
      if (!loc || loc.depth >= MAX_DEPTH) return;
      loc.node.children.push(createProject(name));
      loc.node.collapsed = false;
      save();
      render();
    });

    actions.appendChild(moreBtn);
    actions.appendChild(addBtn);

    inner.appendChild(toggle);
    inner.appendChild(checkLabel);
    inner.appendChild(label);
    inner.appendChild(actions);

    inner.addEventListener("click", () => {
      selectedId = project.id;
      detailMode = "project";
      selectedWeeklyId = null;
      detailsEditing = false;
      render();
    });

    inner.addEventListener("dragstart", (e) => {
      if (project.archived || currentView !== "active") {
        e.preventDefault();
        return;
      }
      dragId = project.id;
      row.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", project.id);
      hideMenu();
    });
    inner.addEventListener("dragend", () => {
      dragId = null;
      row.classList.remove("is-dragging");
      clearDropIndicators();
    });

    row.addEventListener("dragover", (e) => {
      if (!dragId || dragId === project.id) return;
      if (isAncestor(dragId, project.id)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      clearDropIndicators();
      const zone = dropZone(row, e);
      const dragLoc = locate(projects, dragId);
      if (!dragLoc) return;

      if (zone === "into") {
        if (!canNestUnder(dragLoc.node, depth)) return;
        row.classList.add("is-drop-target");
      } else {
        const deepest = depth + subtreeHeight(dragLoc.node) - 1;
        if (deepest > MAX_DEPTH) return;
        row.classList.add(zone === "before" ? "is-drop-before" : "is-drop-after");
      }
    });

    row.addEventListener("dragleave", (e) => {
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove("is-drop-target", "is-drop-before", "is-drop-after");
      }
    });

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = dragId || e.dataTransfer.getData("text/plain");
      if (!id) return;
      const zone = dropZone(row, e);
      const ok = applyDrop(id, project.id, zone);
      clearDropIndicators();
      dragId = null;
      if (ok) {
        save();
        render();
      }
    });

    row.appendChild(inner);

    if (hasChildren) {
      const kids = document.createElement("div");
      kids.className = "children";
      kids.setAttribute("role", "group");
      if (project.collapsed) kids.hidden = true;
      for (const child of project.children) {
        kids.appendChild(renderRow(child, depth + 1));
      }
      row.appendChild(kids);
    }

    return row;
  }

  function render() {
    hideMenu();
    const roots = visibleRoots();
    treeEl.innerHTML = "";
    emptyEl.hidden = roots.length > 0;
    emptyEl.textContent =
      currentView === "archived" ? "暂无已归档项目。" : "暂无项目。点击右上角 + 新建。";

    for (const p of roots) {
      treeEl.appendChild(renderRow(p, 0));
    }
    renderDetail();
    if (rightPanel === "history") renderHistory();
    if (rightPanel === "messages") renderMessages();
  }

  // —— Top actions ——
  btnToday.addEventListener("click", () => {
    openJournal(todayKey(), { edit: true });
  });

  btnCalendar.addEventListener("click", () => {
    setRightPanel("history");
  });

  btnMessages.addEventListener("click", () => {
    setRightPanel("messages");
  });

  historyCollapse.addEventListener("click", () => {
    setRightPanel(null);
  });

  messagesCollapse.addEventListener("click", () => {
    setRightPanel(null);
  });

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendChat(chatInput.value);
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat(chatInput.value);
    }
  });

  chatPresets?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (!btn) return;
    sendChat(btn.getAttribute("data-preset"));
  });

  addTopBtn.addEventListener("click", async () => {
    currentView = "active";
    document.querySelectorAll(".view-tab").forEach((t) => {
      const on = t.dataset.view === "active";
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    const name = await askName("新建项目");
    if (!name) return;
    const p = createProject(name);
    projects.push(p);
    selectedId = p.id;
    detailMode = "project";
    save();
    render();
  });

  toggleAllBtn.addEventListener("click", () => {
    const roots = visibleRoots();
    const anyExpanded = roots.some(function hasOpen(n) {
      return (!n.collapsed && n.children.length > 0) || n.children.some(hasOpen);
    });
    function setAll(n, collapsed) {
      if (n.children.length) n.collapsed = collapsed;
      n.children.forEach((c) => setAll(c, collapsed));
    }
    roots.forEach((r) => setAll(r, anyExpanded));
    const chevron = toggleAllBtn.querySelector(".chevron");
    if (chevron) chevron.classList.toggle("is-collapsed", anyExpanded);
    save();
    render();
  });

  document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      currentView = /** @type {"active"|"archived"} */ (tab.dataset.view);
      document.querySelectorAll(".view-tab").forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      selectedId = null;
      if (detailMode !== "journal") detailMode = "project";
      render();
    });
  });

  loadFromServer()
    .then(() => render())
    .catch((err) => {
      console.error(err);
      detailEl.innerHTML =
        `<p class="detail-placeholder">无法连接服务器，请确认已启动服务（端口 7000）。</p>`;
    });
})();
