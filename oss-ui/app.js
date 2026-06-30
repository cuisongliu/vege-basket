(function () {
  const SESSION_KEY = "oss-ui-authenticated";
  const PROJECTS_KEY = "oss-ui-projects";
  const CART_KEY = "oss-ui-cart";

  const els = {
    loginView: document.getElementById("loginView"),
    consoleView: document.getElementById("consoleView"),
    topbarEyebrow: document.getElementById("topbarEyebrow"),
    topbarTitle: document.getElementById("topbarTitle"),
    topbarTitleMeta: document.getElementById("topbarTitleMeta"),
    topbarSubtitle: document.getElementById("topbarSubtitle"),
    topbarBackIcon: document.getElementById("topbarBackIcon"),
    packagePage: document.getElementById("packagePage"),
    projectsPage: document.getElementById("projectsPage"),
    projectDetailPage: document.getElementById("projectDetailPage"),
    marketButton: document.getElementById("marketButton"),
    cartButton: document.getElementById("cartButton"),
    cartCount: document.getElementById("cartCount"),
    loginForm: document.getElementById("loginForm"),
    passwordInput: document.getElementById("passwordInput"),
    loginError: document.getElementById("loginError"),
    lockButton: document.getElementById("lockButton"),
    backToProjectsButton: document.getElementById("backToProjectsButton"),
    openProjectModalButton: document.getElementById("openProjectModalButton"),
    exportProjectTimelineButton: document.getElementById("exportProjectTimelineButton"),
    projectModal: document.getElementById("projectModal"),
    closeProjectModalButton: document.getElementById("closeProjectModalButton"),
    cancelProjectModalButton: document.getElementById("cancelProjectModalButton"),
    projectForm: document.getElementById("projectForm"),
    projectNameInput: document.getElementById("projectNameInput"),
    projectOwnerInput: document.getElementById("projectOwnerInput"),
    projectsList: document.getElementById("projectsList"),
    projectDetailContent: document.getElementById("projectDetailContent"),
    cartDialog: document.getElementById("cartDialog"),
    closeCartButton: document.getElementById("closeCartButton"),
    cartItems: document.getElementById("cartItems"),
    cartProjectSelect: document.getElementById("cartProjectSelect"),
    cartProjectLabelText: document.getElementById("cartProjectLabelText"),
    cartEventSelect: document.getElementById("cartEventSelect"),
    cartEventLabelText: document.getElementById("cartEventLabelText"),
    clearCartButton: document.getElementById("clearCartButton"),
    generateRecordButton: document.getElementById("generateRecordButton"),
    projectEventModal: document.getElementById("projectEventModal"),
    closeProjectEventModalButton: document.getElementById("closeProjectEventModalButton"),
    cancelProjectEventModalButton: document.getElementById("cancelProjectEventModalButton"),
    projectEventModalEyebrow: document.getElementById("projectEventModalEyebrow"),
    projectEventModalTitle: document.getElementById("projectEventModalTitle"),
    projectEventForm: document.getElementById("projectEventForm"),
    projectEventTypeInput: document.getElementById("projectEventTypeInput"),
    projectEventTypeError: document.getElementById("projectEventTypeError"),
    submitProjectEventButton: document.getElementById("submitProjectEventButton"),
    projectEventNameInput: document.getElementById("projectEventNameInput"),
    operationDocDialog: document.getElementById("operationDocDialog"),
    operationDocTitle: document.getElementById("operationDocTitle"),
    operationDocForm: document.getElementById("operationDocForm"),
    operationDocNameInput: document.getElementById("operationDocNameInput"),
    operationDocContentInput: document.getElementById("operationDocContentInput"),
    operationDocPreview: document.getElementById("operationDocPreview"),
    operationDocToolbar: document.getElementById("operationDocToolbar"),
    closeOperationDocButton: document.getElementById("closeOperationDocButton"),
    cancelOperationDocButton: document.getElementById("cancelOperationDocButton"),
    exportPreviewDialog: document.getElementById("exportPreviewDialog"),
    exportPreviewTitle: document.getElementById("exportPreviewTitle"),
    exportPreviewMeta: document.getElementById("exportPreviewMeta"),
    exportPreviewContentInput: document.getElementById("exportPreviewContentInput"),
    exportPreviewContentPreview: document.getElementById("exportPreviewContentPreview"),
    exportPreviewToolbar: document.getElementById("exportPreviewToolbar"),
    closeExportPreviewButton: document.getElementById("closeExportPreviewButton"),
    cancelExportPreviewButton: document.getElementById("cancelExportPreviewButton"),
    confirmExportPreviewButton: document.getElementById("confirmExportPreviewButton"),
    operationDeleteDialog: document.getElementById("operationDeleteDialog"),
    operationDeleteEyebrow: document.getElementById("operationDeleteEyebrow"),
    operationDeleteTitle: document.getElementById("operationDeleteTitle"),
    operationDeleteMessage: document.getElementById("operationDeleteMessage"),
    closeOperationDeleteButton: document.getElementById("closeOperationDeleteButton"),
    cancelOperationDeleteButton: document.getElementById("cancelOperationDeleteButton"),
    confirmOperationDeleteButton: document.getElementById("confirmOperationDeleteButton"),
    appsTabs: document.getElementById("appsTabs"),
    middlewareTabs: document.getElementById("middlewareTabs"),
    packageTitle: document.getElementById("packageTitle"),
    packageType: document.getElementById("packageType"),
    packageMeta: document.getElementById("packageMeta"),
    detailControls: document.getElementById("detailControls"),
    linkCards: document.getElementById("linkCards"),
    addPackageToCartButton: document.getElementById("addPackageToCartButton"),
    copyAllButton: document.getElementById("copyAllButton"),
    refreshButton: document.getElementById("refreshButton"),
    channel: document.getElementById("channel"),
    arch: document.getElementById("arch"),
    searchInput: document.getElementById("searchInput"),
    ciVersionField: document.getElementById("ciVersionField"),
    ciVersion: document.getElementById("ciVersion"),
    statusText: document.getElementById("statusText"),
  };

  let selectedPackage = "base-pro";
  let rules = [];
  let detail = null;
  let loadingDetail = false;
  let ciVersions = [];
  let releaseVersions = [];
  let projects = loadStoredList(PROJECTS_KEY);
  let cartItems = loadStoredList(CART_KEY);
  let currentPage = "projects";
  let currentProjectId = "";
  let marketTargetProjectId = "";
  let marketTargetEventId = "";
  let packageReturnPage = "projects";
  let selectedDetailPackageName = "";
  let selectedProjectEventId = "";
  let pendingOperationTarget = null;
  let pendingDeleteTarget = null;
  let pendingProjectEventEditId = "";
  let pendingExportProjectId = "";
  const expandedGroups = new Set(["base"]);
  const customSelects = new Map();
  const operationEvents = [
    { type: "init", label: "初始化安装" },
    { type: "upgrade", label: "升级" },
  ];

  function normalizeEventType(type) {
    const normalized = textValue(type, "upgrade");
    if (normalized === "bugfix" || normalized === "deploy") return "upgrade";
    return normalized === "init" || normalized === "upgrade" ? normalized : "upgrade";
  }

  async function request(path, options) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function loadStoredList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }

  function saveProjects() {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  }

  function saveCartItems() {
    localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
  }

  function projectById(projectId) {
    return projects.find((item) => item.id === projectId) || null;
  }

  function closeProjectModal() {
    els.projectModal.classList.add("hidden");
  }

  function closeProjectEventModal() {
    els.projectEventModal.classList.add("hidden");
    pendingProjectEventEditId = "";
  }

  function setProjectEventTypeError(message = "") {
    if (els.projectEventTypeError) {
      els.projectEventTypeError.textContent = message;
    }
    els.projectEventTypeInput.closest(".custom-select")?.classList.toggle("is-invalid", Boolean(message));
  }

  function openProjectModal() {
    els.projectModal.classList.remove("hidden");
    els.projectNameInput.focus();
  }

  function openProjectEventModal() {
    if (!currentProjectId) return;
    pendingProjectEventEditId = "";
    els.projectEventModalEyebrow.textContent = "new project event";
    els.projectEventModalTitle.textContent = "新增项目事件";
    els.submitProjectEventButton.textContent = "创建事件";
    els.projectEventTypeInput.disabled = false;
    els.projectEventTypeInput.value = "";
    els.projectEventNameInput.value = "";
    setProjectEventTypeError("");
    syncCustomSelect(els.projectEventTypeInput);
    els.projectEventModal.classList.remove("hidden");
    els.projectEventTypeInput.focus();
  }

  function openProjectEventRenameModal(eventId) {
    const project = projectById(currentProjectId);
    if (!project) return;
    const event = eventById(project, eventId);
    if (!event) return;
    pendingProjectEventEditId = event.id;
    els.projectEventModalEyebrow.textContent = "rename project event";
    els.projectEventModalTitle.textContent = "重命名项目事件";
    els.submitProjectEventButton.textContent = "保存事件";
    els.projectEventTypeInput.disabled = true;
    els.projectEventTypeInput.value = normalizeEventType(event.type);
    els.projectEventNameInput.value = textValue(event.title, "");
    setProjectEventTypeError("");
    syncCustomSelect(els.projectEventTypeInput);
    els.projectEventModal.classList.remove("hidden");
    els.projectEventNameInput.focus();
    els.projectEventNameInput.select();
  }

  function showConsole() {
    els.loginView.classList.add("hidden");
    els.consoleView.classList.remove("hidden");
    loadRules();
    showProjectsPage();
  }

  function showLogin() {
    els.consoleView.classList.add("hidden");
    els.loginView.classList.remove("hidden");
    els.passwordInput.focus();
  }

  function showPackagePage() {
    closeCartDialog();
    closeProjectModal();
    closeProjectEventModal();
    closeOperationDocDialog();
    closeOperationDeleteDialog();
    els.projectsPage.classList.add("hidden");
    els.projectDetailPage.classList.add("hidden");
    els.packagePage.classList.remove("hidden");
    els.topbarEyebrow.textContent = "package marketplace";
    els.topbarEyebrow.classList.remove("hidden");
    els.topbarTitle.textContent = "安装包市场";
    els.topbarTitleMeta.textContent = "";
    const targetProject = projectById(marketTargetProjectId);
    const targetEvent = targetProject ? eventById(targetProject, marketTargetEventId) : null;
    els.topbarSubtitle.textContent = targetProject
      ? `正在为项目「${targetProject.name}」${targetEvent ? `的事件「${targetEvent.title}」` : ""}选购安装包`
      : "";
    els.topbarBackIcon.classList.remove("hidden");
    els.marketButton.classList.add("hidden");
    els.openProjectModalButton.classList.add("hidden");
    els.exportProjectTimelineButton.classList.add("hidden");
    els.cartButton.classList.remove("hidden");
    els.backToProjectsButton.classList.add("hidden");
    currentPage = "package";
  }

  function showProjectsPage() {
    closeCartDialog();
    closeProjectModal();
    closeProjectEventModal();
    closeOperationDocDialog();
    closeOperationDeleteDialog();
    els.packagePage.classList.add("hidden");
    els.projectDetailPage.classList.add("hidden");
    els.projectsPage.classList.remove("hidden");
    els.topbarEyebrow.textContent = "project operation records";
    els.topbarEyebrow.classList.remove("hidden");
    els.topbarTitle.textContent = "项目列表";
    els.topbarTitleMeta.textContent = "";
    els.topbarSubtitle.textContent = "";
    els.topbarBackIcon.classList.add("hidden");
    els.marketButton.classList.remove("hidden");
    els.openProjectModalButton.classList.remove("hidden");
    els.exportProjectTimelineButton.classList.add("hidden");
    els.cartButton.classList.add("hidden");
    els.backToProjectsButton.classList.add("hidden");
    packageReturnPage = "projects";
    currentPage = "projects";
    marketTargetEventId = "";
    renderProjects();
  }

  function showProjectDetailPage(projectId) {
    const project = projectById(projectId);
    if (!project) {
      showProjectsPage();
      return;
    }
    closeCartDialog();
    closeProjectModal();
    closeProjectEventModal();
    closeOperationDocDialog();
    closeOperationDeleteDialog();
    currentProjectId = project.id;
    els.packagePage.classList.add("hidden");
    els.projectsPage.classList.add("hidden");
    els.projectDetailPage.classList.remove("hidden");
    els.topbarEyebrow.textContent = "project package timeline";
    els.topbarEyebrow.classList.remove("hidden");
    els.topbarTitle.textContent = project.name;
    els.topbarTitleMeta.textContent = `负责人：${project.owner} · ${project.records.length} 条记录`;
    els.topbarSubtitle.textContent = "";
    els.topbarBackIcon.classList.remove("hidden");
    els.marketButton.classList.add("hidden");
    els.openProjectModalButton.classList.add("hidden");
    els.exportProjectTimelineButton.classList.remove("hidden");
    els.cartButton.classList.add("hidden");
    els.backToProjectsButton.classList.add("hidden");
    packageReturnPage = "project-detail";
    currentPage = "project-detail";
    renderProjectDetail(project);
  }

  function openCartDialog() {
    renderCart();
    els.cartDialog.classList.remove("hidden");
  }

  function closeCartDialog() {
    els.cartDialog.classList.add("hidden");
  }

  function closeOperationDocDialog() {
    els.operationDocDialog.classList.add("hidden");
    pendingOperationTarget = null;
  }

  function closeExportPreviewDialog() {
    els.exportPreviewDialog.classList.add("hidden");
    pendingExportProjectId = "";
  }

  function closeOperationDeleteDialog() {
    els.operationDeleteDialog.classList.add("hidden");
    pendingDeleteTarget = null;
  }

  function bindBackdropDismiss(backdrop, onClose) {
    if (!backdrop) return;
    let startedOnBackdrop = false;

    backdrop.addEventListener("pointerdown", (event) => {
      startedOnBackdrop = event.target === backdrop;
    });

    backdrop.addEventListener("click", (event) => {
      const shouldClose = startedOnBackdrop && event.target === backdrop;
      startedOnBackdrop = false;
      if (shouldClose) onClose();
    });

    backdrop.addEventListener("pointercancel", () => {
      startedOnBackdrop = false;
    });
  }

  function escapeMarkdownInline(value) {
    return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/==(.+?)==/g, "<mark>$1</mark>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }

  function renderInlineLines(lines) {
    return lines.map((line) => escapeMarkdownInline(line)).join("<br />");
  }

  function classifyCodeToken(token) {
    if (/^https?:\/\//.test(token)) return "token-url";
    if (/^(\/\/|#)/.test(token)) return "token-comment";
    if (/^['"]/.test(token)) return "token-string";
    if (/^\d/.test(token)) return "token-number";
    if (/^(kubectl|helm|docker|npm|pnpm|yarn|bash|sh|curl|wget|git)$/.test(token)) return "token-command";
    if (/^(const|let|var|function|return|if|else|for|while|class|new|import|from|export|async|await|try|catch|throw|switch|case|break|continue|true|false|null|undefined)$/.test(token)) return "token-keyword";
    return "token-operator";
  }

  function highlightCode(code, language = "") {
    const tokenPattern = /(https?:\/\/[^\s]+|\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:kubectl|helm|docker|npm|pnpm|yarn|bash|sh|curl|wget|git)\b|\b(?:const|let|var|function|return|if|else|for|while|class|new|import|from|export|async|await|try|catch|throw|switch|case|break|continue|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b|=>|===|!==|==|!=|&&|\|\||[=+\-])/gm;
    let html = "";
    let lastIndex = 0;

    let match;
    while ((match = tokenPattern.exec(code))) {
      const token = match[0];
      const offset = match.index;
      html += escapeHtml(code.slice(lastIndex, offset));
      html += `<span class="${classifyCodeToken(token)}">${escapeHtml(token)}</span>`;
      lastIndex = offset + token.length;
    }

    html += escapeHtml(code.slice(lastIndex));
    return `<pre><code data-language="${escapeAttribute(language)}">${html}</code></pre>`;
  }

  function renderMarkdownPreview(markdown) {
    const source = String(markdown || "").replace(/\r\n/g, "\n");
    if (!source.trim()) {
      return `<p class="operation-empty">预览会显示在这里，支持标题、列表、引用、代码块。</p>`;
    }

    const lines = source.split("\n");
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (/^```/.test(line)) {
        const language = line.slice(3).trim();
        const codeLines = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index])) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        blocks.push(highlightCode(codeLines.join("\n"), language));
        continue;
      }

      if (!line.trim()) {
        index += 1;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const headingText = heading[2].trim();
        let headingClass = "";
        if (level === 2) headingClass = "markdown-section-break";
        if (level === 4 && !/^\d+\./.test(headingText) && headingText !== "事件文档") headingClass = "markdown-package-break";
        blocks.push(`<h${level}${headingClass ? ` class="${headingClass}"` : ""}>${escapeMarkdownInline(headingText)}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quoteLines.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        blocks.push(`<blockquote>${renderInlineLines(quoteLines)}</blockquote>`);
        continue;
      }

      if (/^(-|\*)\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^(-|\*)\s+/.test(lines[index])) {
          items.push(lines[index].replace(/^(-|\*)\s+/, ""));
          index += 1;
        }
        blocks.push(`<ul>${items.map((item) => `<li>${escapeMarkdownInline(item)}</li>`).join("")}</ul>`);
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
          items.push(lines[index].replace(/^\d+\.\s+/, ""));
          index += 1;
        }
        blocks.push(`<ol>${items.map((item) => `<li>${escapeMarkdownInline(item)}</li>`).join("")}</ol>`);
        continue;
      }

      if (/^---+$/.test(line.trim())) {
        blocks.push("<hr />");
        index += 1;
        continue;
      }

      const paragraphLines = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^```/.test(lines[index]) &&
        !/^(#{1,6})\s+/.test(lines[index]) &&
        !/^>\s?/.test(lines[index]) &&
        !/^(-|\*)\s+/.test(lines[index]) &&
        !/^\d+\.\s+/.test(lines[index]) &&
        !/^---+$/.test(lines[index].trim())
      ) {
        paragraphLines.push(lines[index]);
        index += 1;
      }
      blocks.push(`<p>${renderInlineLines(paragraphLines)}</p>`);
    }

    return blocks.join("");
  }

  function syncOperationDocPreview() {
    if (!els.operationDocPreview) return;
    els.operationDocPreview.innerHTML = renderMarkdownPreview(els.operationDocContentInput.value);
  }

  function syncExportPreview() {
    if (!els.exportPreviewContentPreview) return;
    els.exportPreviewContentPreview.innerHTML = renderMarkdownPreview(els.exportPreviewContentInput.value);
  }

  function applyTextareaChange(textarea, nextValue, selectionStart, selectionEnd) {
    textarea.value = nextValue;
    textarea.focus();
    textarea.setSelectionRange(selectionStart, selectionEnd);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function findInlineWrapperAtCursor(value, position, prefix, suffix) {
    const lineStart = value.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
    const lineEndIndex = value.indexOf("\n", position);
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
    const line = value.slice(lineStart, lineEnd);
    const cursorOffset = position - lineStart;
    let searchFrom = 0;

    while (searchFrom < line.length) {
      const openIndex = line.indexOf(prefix, searchFrom);
      if (openIndex === -1) break;
      const contentStart = openIndex + prefix.length;
      const closeIndex = line.indexOf(suffix, contentStart);
      if (closeIndex === -1) break;
      if (cursorOffset >= contentStart && cursorOffset <= closeIndex) {
        return {
          wrapperStart: lineStart + openIndex,
          contentStart: lineStart + contentStart,
          contentEnd: lineStart + closeIndex,
          wrapperEnd: lineStart + closeIndex + suffix.length,
        };
      }
      searchFrom = closeIndex + suffix.length;
    }

    return null;
  }

  function toggleWrappedSelection(textarea, prefix, suffix, placeholder) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selectedText = value.slice(start, end);

    if (selectedText.length >= prefix.length + suffix.length && selectedText.startsWith(prefix) && selectedText.endsWith(suffix)) {
      const content = selectedText.slice(prefix.length, selectedText.length - suffix.length);
      const nextValue = `${value.slice(0, start)}${content}${value.slice(end)}`;
      applyTextareaChange(textarea, nextValue, start, start + content.length);
      return;
    }

    if (start >= prefix.length && value.slice(start - prefix.length, start) === prefix && value.slice(end, end + suffix.length) === suffix) {
      const nextValue = `${value.slice(0, start - prefix.length)}${selectedText}${value.slice(end + suffix.length)}`;
      const nextStart = start - prefix.length;
      applyTextareaChange(textarea, nextValue, nextStart, nextStart + selectedText.length);
      return;
    }

    if (!selectedText) {
      const wrapper = findInlineWrapperAtCursor(value, start, prefix, suffix);
      if (wrapper) {
        const content = value.slice(wrapper.contentStart, wrapper.contentEnd);
        const cursorOffset = start - wrapper.contentStart;
        const nextValue = `${value.slice(0, wrapper.wrapperStart)}${content}${value.slice(wrapper.wrapperEnd)}`;
        const nextCursor = wrapper.wrapperStart + Math.max(0, Math.min(cursorOffset, content.length));
        applyTextareaChange(textarea, nextValue, nextCursor, nextCursor);
        return;
      }
    }

    const content = selectedText || placeholder;
    const nextValue = `${value.slice(0, start)}${prefix}${content}${suffix}${value.slice(end)}`;
    const contentStart = start + prefix.length;
    applyTextareaChange(textarea, nextValue, contentStart, contentStart + content.length);
  }

  function findEnclosingCodeBlock(value, start, end) {
    const fencePattern = /(^|\n)```([^\n]*)\n([\s\S]*?)\n```(?=\n|$)/g;
    let match;

    while ((match = fencePattern.exec(value))) {
      const leadingBreak = match[1].length;
      const blockStart = match.index + leadingBreak;
      const openingFence = `\`\`\`${match[2]}`;
      const contentStart = blockStart + openingFence.length + 1;
      const content = match[3];
      const contentEnd = contentStart + content.length;
      const blockEnd = blockStart + match[0].length - leadingBreak;

      if (start >= blockStart && end <= blockEnd) {
        return {
          blockStart,
          blockEnd,
          contentStart,
          contentEnd,
          content,
        };
      }
    }

    return null;
  }

  function toggleCodeBlockSelection(textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const enclosingBlock = findEnclosingCodeBlock(value, start, end);

    if (enclosingBlock && start >= enclosingBlock.contentStart && end <= enclosingBlock.contentEnd) {
      const nextValue = `${value.slice(0, enclosingBlock.blockStart)}${enclosingBlock.content}${value.slice(enclosingBlock.blockEnd)}`;
      const nextStart = enclosingBlock.blockStart + (start - enclosingBlock.contentStart);
      const nextEnd = enclosingBlock.blockStart + (end - enclosingBlock.contentStart);
      applyTextareaChange(textarea, nextValue, nextStart, nextEnd);
      return;
    }

    const selectedText = value.slice(start, end);
    const leadingBreak = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const trailingBreak = end < value.length && value[end] !== "\n" ? "\n" : "";
    const content = selectedText || "在这里输入代码";
    const block = `${leadingBreak}\`\`\`\n${content}\n\`\`\`${trailingBreak}`;
    const nextValue = `${value.slice(0, start)}${block}${value.slice(end)}`;
    const contentStart = start + leadingBreak.length + "```\n".length;
    applyTextareaChange(textarea, nextValue, contentStart, contentStart + content.length);
  }

  function formatSelectionForTextarea(textarea, format) {
    if (!textarea) return;
    if (format === "highlight") {
      toggleWrappedSelection(textarea, "==", "==", "高亮内容");
      return;
    }
    if (format === "inline-code") {
      toggleWrappedSelection(textarea, "`", "`", "命令");
      return;
    }
    if (format === "code-block") {
      toggleCodeBlockSelection(textarea);
    }
  }

  function formatOperationDocSelection(format) {
    formatSelectionForTextarea(els.operationDocContentInput, format);
  }

  function formatExportPreviewSelection(format) {
    formatSelectionForTextarea(els.exportPreviewContentInput, format);
  }

  function closeEventDropdowns() {
    for (const dropdown of document.querySelectorAll(".event-dropdown.is-open")) {
      dropdown.classList.remove("is-open");
      const trigger = dropdown.querySelector("[data-event-menu-trigger]");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    }
  }

  function generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function formatDateTime(value) {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  }

  function formatDateTimeForFileName(value) {
    const date = new Date(value);
    const parts = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0"),
    ];
    return parts.join("-");
  }

  function sanitizeFileName(value) {
    return String(value == null ? "" : value)
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "record";
  }

  function textValue(value, fallback = "-") {
    const normalized = String(value == null ? "" : value).trim();
    return normalized || fallback;
  }

  function actionLabel(value) {
    return textValue(value, "未知操作");
  }

  function buildRecordMarkdown(project, record) {
    const items = Array.isArray(record.items) ? record.items : [];
    const lines = [
      `# ${textValue(record.title, "安装包操作记录")}`,
      "",
      `- 项目名称：${textValue(project && project.name, "未命名项目")}`,
      `- 项目负责人：${textValue(project && project.owner, "未填写")}`,
      `- 记录创建时间：${formatDateTime(record.createdAt || new Date().toISOString())}`,
      `- 操作数量：${items.length}`,
      `- 导出时间：${formatDateTime(new Date().toISOString())}`,
    ];

    items.forEach((item, index) => {
      const itemValue = textValue(item.value || item.objectKey, "");
      const objectKey = textValue(item.objectKey, "");
      lines.push(
        "",
        `## ${index + 1}. ${textValue(item.packageName, "未命名安装包")}`,
        `- 操作：${actionLabel(item.actionLabel || item.action)}`,
        `- 渠道：${textValue(item.channelLabel)}`,
        `- 架构：${textValue(item.arch)}`,
        `- 版本：${textValue(item.version, "未知版本")}`,
        `- 操作时间：${formatDateTime(item.createdAt || record.createdAt || new Date().toISOString())}`
      );

      if (itemValue) {
        lines.push("", "### 操作内容", "```text", itemValue, "```");
      }

      if (objectKey && objectKey !== itemValue) {
        lines.push("", "### 对象 Key", "```text", objectKey, "```");
      }
    });

    return `${lines.join("\n")}\n`;
  }

  function downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  function buildOperationMarkdown(operation, level = "###", options = {}) {
    const createdAt = formatDateTime(operation.createdAt || new Date().toISOString());
    if (operation.type === "document") {
      return [
        `${level} 文档：${textValue(operation.title, "未命名操作文档")}`,
        "",
        `- 时间：${createdAt}`,
        "",
        textValue(operation.content, "无内容"),
      ];
    }
    const eventLabel = textValue(operation.label, "操作事件");
    const operationTitle = textValue(operation.title, "");
    if (options.listStyle) {
      const lines = [
        `- ${createdAt} · ${eventLabel}`,
      ];
      if (operation.content) {
        if (operationTitle && operationTitle !== eventLabel) {
          lines.push("", `  - ${operationTitle}`);
        }
        lines.push("", textValue(operation.content, "无内容"));
      }
      return lines;
    }
    const detailLevel = `${level}#`;
    const lines = [
      `${level} ${createdAt}`,
      "",
      `${detailLevel} ${eventLabel}`,
    ];
    if (operation.content) {
      if (operationTitle && operationTitle !== eventLabel) {
        lines.push("", `${detailLevel}# ${operationTitle}`, "", operation.content);
      } else {
        lines.push("", operation.content);
      }
    }
    return lines;
  }

  function buildPackageTimelineMarkdown(packageName, nodes, headingLevel = "##") {
    const lines = [];
    const packageOperations = nodes.filter((node) => node.type !== "package-operation");
    const packageRecords = nodes.filter((node) => node.type === "package-operation");
    if (packageRecords.length > 0) {
      const details = packageRecords.map((node) => {
        const item = node.item;
        return [
          textValue(item.channelLabel),
          textValue(item.arch),
          textValue(item.version, "未知版本"),
        ].filter(Boolean).join(" · ");
      });
      lines.push(`${headingLevel} ${packageName} · ${details.join("；")}`, "");
    } else {
      lines.push(`${headingLevel} ${packageName}`, "");
    }
    if (packageOperations.length === 0) {
      lines.push("暂无时间线记录。");
      return lines;
    }
    packageOperations.forEach((node) => {
      lines.push(...buildOperationMarkdown(node, `${headingLevel}#`, { listStyle: true }), "");
    });
    return lines;
  }

  function buildProjectTimelineMarkdown(project) {
    ensureProjectOperationShape(project);
    const events = sortedProjectEvents(project);
    const lines = [
      `# ${textValue(project.name, "未命名项目")} 项目时间线`,
      "",
      `- 项目负责人：${textValue(project.owner, "未填写")}`,
      `- 安装包操作记录：${project.records.length} 条`,
      `- 导出时间：${formatDateTime(new Date().toISOString())}`,
    ];

    if (events.length === 0) {
      lines.push("", "暂无项目事件。");
      return `${lines.join("\n")}\n`;
    }

    events.forEach((event, eventIndex) => {
      const createdAt = formatDateTime(event.createdAt || new Date().toISOString());
      lines.push(
        "",
        `## ${createdAt}`,
        "",
        `### ${eventIndex + 1}. ${textValue(event.title, "未命名事件")}`,
        "",
        "### 事件文档",
        "",
      );
      if (!event.operations || event.operations.length === 0) {
        lines.push("暂无事件文档。", "");
      } else {
        sortedOperations(event.operations).forEach((operation, index) => {
          lines.push(...buildOperationMarkdown(operation, `#### ${index + 1}.`), "");
        });
      }

      const groupedPackages = recordsGroupedByPackage(project, event.id);
      if (groupedPackages.length === 0) {
        lines.push("暂无安装包。", "");
        return;
      }
      groupedPackages.forEach((pkg) => {
        pkg.operations = eventPackageOperations(project, event.id, pkg.name);
        lines.push(...buildPackageTimelineMarkdown(pkg.name, buildPackageTimelineNodes(pkg, "asc"), "####"), "");
      });
    });
    return `${lines.join("\n")}\n`;
  }

  function exportProjectTimeline(project, contentOverride = "") {
    const timestamp = formatDateTimeForFileName(new Date().toISOString());
    const filename = sanitizeFileName(`${project.name}-项目时间线-${timestamp}.md`);
    downloadTextFile(filename, contentOverride || buildProjectTimelineMarkdown(project), "text/markdown;charset=utf-8");
  }

  function openExportPreviewDialog(project) {
    if (!project) return;
    pendingExportProjectId = project.id;
    els.exportPreviewTitle.textContent = `导出 ${textValue(project.name, "项目")} 时间线`;
    els.exportPreviewMeta.textContent = `确认项目「${textValue(project.name, "未命名项目")}」的时间线内容无误后，再点击右下角确认导出。`;
    els.exportPreviewContentInput.value = buildProjectTimelineMarkdown(project);
    syncExportPreview();
    els.exportPreviewDialog.classList.remove("hidden");
    els.exportPreviewContentInput.focus();
  }

  function currentPackageVersion(link) {
    if (link.version) return link.version;
    const versionMeta = (detail && detail.meta ? detail.meta : []).find((item) => {
      return item.label === "最新版本" || item.label === "基础包版本";
    });
    return versionMeta ? versionMeta.value : "";
  }

  function currentChannelLabel() {
    return els.channel.value === "ci" ? "测试包" : "正式包";
  }

  function currentParams() {
    const selectedRelease = document.getElementById("detailReleaseVersion");
    const releaseVersion = selectedRelease && releaseVersions.some((item) => item.version === selectedRelease.value)
      ? selectedRelease.value
      : "";
    return new URLSearchParams({
      channel: els.channel.value,
      deployType: selectedPackage === "base-oss" ? "oss" : "pro",
      releaseVersion,
      arch: els.arch.value,
      ciVersion: els.ciVersion.value,
    });
  }

  function packageMatches(pkg, query) {
    if (!query) return true;
    return [
      pkg.id,
      pkg.name,
      pkg.mode,
      ...(pkg.releaseRoots || []),
      ...(pkg.flatFileRoots || []),
      ...(pkg.fileNameFormats || []),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  }

  function selectedOptionLabel(select) {
    const selected = select.options[select.selectedIndex];
    return selected ? selected.textContent : "";
  }

  function syncCustomSelect(select) {
    const instance = customSelects.get(select);
    if (!instance) return;

    const { root, trigger, value, menu } = instance;
    value.textContent = selectedOptionLabel(select);
    trigger.disabled = select.disabled;
    root.classList.toggle("is-disabled", select.disabled);

    menu.innerHTML = "";
    Array.from(select.options).forEach((option) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "custom-select-option";
      item.dataset.value = option.value;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.selected));
      item.textContent = option.textContent;
      item.addEventListener("click", () => {
        if (select.value !== option.value) {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        closeCustomSelect(root);
        trigger.focus();
      });
      menu.appendChild(item);
    });
  }

  function closeCustomSelect(root) {
    if (!root.classList.contains("is-open")) return;
    root.classList.remove("is-open");
    root.querySelector(".custom-select-trigger").setAttribute("aria-expanded", "false");
  }

  function closeOtherCustomSelects(activeRoot) {
    for (const { root } of customSelects.values()) {
      if (root !== activeRoot) closeCustomSelect(root);
    }
  }

  function moveCustomSelectFocus(root, direction) {
    const options = Array.from(root.querySelectorAll(".custom-select-option"));
    if (options.length === 0) return;
    const currentIndex = options.indexOf(document.activeElement);
    const selectedIndex = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
    const fallbackIndex = selectedIndex === -1 ? 0 : selectedIndex;
    const nextIndex = currentIndex === -1
      ? fallbackIndex
      : (currentIndex + direction + options.length) % options.length;
    options[nextIndex].focus();
  }

  function enhanceSelect(select) {
    if (!select || customSelects.has(select)) return;

    const root = document.createElement("div");
    root.className = "custom-select";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const value = document.createElement("span");
    value.className = "custom-select-value";

    const icon = document.createElement("span");
    icon.className = "custom-select-icon";
    icon.setAttribute("aria-hidden", "true");

    const menu = document.createElement("div");
    menu.className = "custom-select-menu";
    menu.setAttribute("role", "listbox");

    trigger.append(value, icon);
    root.append(trigger, menu);
    select.after(root);
    select.classList.add("native-select");

    customSelects.set(select, { root, trigger, value, menu });

    trigger.addEventListener("click", () => {
      const open = root.classList.toggle("is-open");
      trigger.setAttribute("aria-expanded", String(open));
      if (open) {
        closeOtherCustomSelects(root);
        syncCustomSelect(select);
      }
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        root.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
        closeOtherCustomSelects(root);
        moveCustomSelectFocus(root, 1);
      }
    });

    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeCustomSelect(root);
        trigger.focus();
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveCustomSelectFocus(root, 1);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveCustomSelectFocus(root, -1);
      }
    });

    select.addEventListener("change", () => syncCustomSelect(select));
    syncCustomSelect(select);
  }

  function enhanceSelects(scope) {
    for (const select of scope.querySelectorAll("select")) {
      enhanceSelect(select);
      syncCustomSelect(select);
    }
  }

  function syncCartCount() {
    els.cartCount.textContent = String(cartItems.length);
    els.cartButton.classList.toggle("has-items", cartItems.length > 0);
  }

  function renderProjectOptions() {
    els.cartProjectSelect.innerHTML = projects.length === 0
      ? `<option value="">暂无项目</option>`
      : projects.map((project) => `<option value="${escapeAttribute(project.id)}">${escapeHtml(project.name)}</option>`).join("");
    if (marketTargetProjectId && projects.some((project) => project.id === marketTargetProjectId)) {
      els.cartProjectSelect.value = marketTargetProjectId;
    }
    els.cartProjectSelect.disabled = Boolean(projectById(marketTargetProjectId));
    const targetProject = projectById(marketTargetProjectId);
    els.cartProjectLabelText.textContent = targetProject ? `记录到项目（${targetProject.name}）` : "记录到项目";
    syncCustomSelect(els.cartProjectSelect);
  }

  function renderEventOptions() {
    const projectId = marketTargetProjectId || els.cartProjectSelect.value;
    const project = projectById(projectId);
    const events = project ? sortedProjectEvents(project) : [];
    els.cartEventSelect.innerHTML = events.length === 0
      ? `<option value="">请先创建项目事件</option>`
      : events.map((event) => `<option value="${escapeAttribute(event.id)}">${escapeHtml(event.title)}</option>`).join("");
    if (marketTargetEventId && events.some((event) => event.id === marketTargetEventId)) {
      els.cartEventSelect.value = marketTargetEventId;
    } else if (events[0]) {
      els.cartEventSelect.value = events[0].id;
    }
    els.cartEventSelect.disabled = events.length === 0 || Boolean(marketTargetEventId && project && eventById(project, marketTargetEventId));
    els.cartEventLabelText.textContent = project ? `记录到事件（${project.name}）` : "记录到事件";
    syncCustomSelect(els.cartEventSelect);
  }

  function renderCart() {
    syncCartCount();
    renderProjectOptions();
    renderEventOptions();
    els.generateRecordButton.disabled = cartItems.length === 0 || projects.length === 0 || !els.cartEventSelect.value;
    els.clearCartButton.disabled = cartItems.length === 0;

    if (cartItems.length === 0) {
      els.cartItems.innerHTML = `<p class="empty-text">购物车为空。</p>`;
      return;
    }

    els.cartItems.innerHTML = cartItems.map((item) => `
      <article class="cart-item">
        <div>
          <strong>${escapeHtml(item.packageName)}</strong>
          <p>${escapeHtml(actionLabel(item.actionLabel))} · ${escapeHtml(item.channelLabel || "-")} · ${escapeHtml(item.arch || "-")} · ${escapeHtml(item.version || "未知版本")} · ${escapeHtml(formatDateTime(item.createdAt))}</p>
          <code>${escapeHtml(item.value)}</code>
        </div>
        <button class="text-button danger" type="button" data-remove-cart="${escapeAttribute(item.id)}">删除</button>
      </article>
    `).join("");

    for (const button of els.cartItems.querySelectorAll("[data-remove-cart]")) {
      button.addEventListener("click", () => {
        cartItems = cartItems.filter((item) => item.id !== button.dataset.removeCart);
        saveCartItems();
        renderCart();
      });
    }
  }

  function renderProjects() {
    renderProjectOptions();
    if (projects.length === 0) {
      els.projectsList.innerHTML = `<p class="empty-text">还没有项目，请先新增一个项目。</p>`;
      return;
    }

    els.projectsList.innerHTML = projects.map((project) => `
      <article class="project-card project-summary-card">
        <div class="project-summary-head">
          <span>
            <strong>${escapeHtml(project.name)}</strong>
            <small>负责人：${escapeHtml(project.owner)}</small>
            <small>创建时间：${escapeHtml(formatDateTime(project.createdAt || new Date().toISOString()))}</small>
          </span>
          <span class="record-count">${project.records.length} 条记录</span>
        </div>
        <div class="project-summary-actions">
          <button class="secondary-button" type="button" data-project-detail="${escapeAttribute(project.id)}">详情</button>
          <button
            class="text-button danger project-delete-button"
            type="button"
            aria-label="删除项目 ${escapeAttribute(project.name)}"
            title="删除项目"
            data-delete-project="${escapeAttribute(project.id)}"
          ><span class="trash-icon" aria-hidden="true"></span></button>
        </div>
      </article>
    `).join("");

    for (const button of els.projectsList.querySelectorAll("[data-project-detail]")) {
      button.addEventListener("click", () => {
        showProjectDetailPage(button.dataset.projectDetail);
      });
    }
    for (const button of els.projectsList.querySelectorAll("[data-delete-project]")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openProjectDeleteDialog(button.dataset.deleteProject);
      });
    }
  }

  function eventTypeLabel(type) {
    const found = operationEvents.find((item) => item.type === normalizeEventType(type));
    return found ? found.label : textValue(type, "项目事件");
  }

  function recordsGroupedByPackage(project, eventId = "") {
    const grouped = new Map();
    for (const record of project.records || []) {
      if (eventId && record.eventId !== eventId) continue;
      for (const item of record.items || []) {
        const packageName = textValue(item.packageName, "未命名安装包");
        const group = grouped.get(packageName) || { name: packageName, items: [] };
        group.items.push({ record, item });
        grouped.set(packageName, group);
      }
    }
    return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  function projectEvents(project) {
    if (!Array.isArray(project.events)) {
      project.events = [];
    }
    return project.events;
  }

  function sortedProjectEvents(project) {
    return [...projectEvents(project)].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  }

  function eventById(project, eventId) {
    return projectEvents(project).find((event) => event.id === eventId) || null;
  }

  function eventPackageOperations(project, eventId, packageName) {
    if (!project.eventPackageOperations || typeof project.eventPackageOperations !== "object" || Array.isArray(project.eventPackageOperations)) {
      project.eventPackageOperations = {};
    }
    const eventKey = textValue(eventId, "default-event");
    if (!project.eventPackageOperations[eventKey] || typeof project.eventPackageOperations[eventKey] !== "object" || Array.isArray(project.eventPackageOperations[eventKey])) {
      project.eventPackageOperations[eventKey] = {};
    }
    const packageKey = textValue(packageName, "未命名安装包");
    if (!Array.isArray(project.eventPackageOperations[eventKey][packageKey])) {
      project.eventPackageOperations[eventKey][packageKey] = [];
    }
    return project.eventPackageOperations[eventKey][packageKey];
  }

  function createProjectEvent(project, { type, title, isLegacyDefault = false, createdAt = "" }) {
    const eventType = normalizeEventType(type);
    const eventTitle = textValue(title, `${eventTypeLabel(eventType)} · ${formatDateTime(createdAt || new Date().toISOString())}`);
    const event = {
      id: generateId("event"),
      type: eventType,
      title: eventTitle,
      createdAt: createdAt || new Date().toISOString(),
      operations: [],
      isLegacyDefault,
    };
    projectEvents(project).push(event);
    return event;
  }

  function ensureProjectOperationShape(project) {
    let changed = false;
    if (!Array.isArray(project.operations)) {
      project.operations = [];
      changed = true;
    }
    if (!project.packageOperations || typeof project.packageOperations !== "object" || Array.isArray(project.packageOperations)) {
      project.packageOperations = {};
      changed = true;
    }
    if (!project.eventPackageOperations || typeof project.eventPackageOperations !== "object" || Array.isArray(project.eventPackageOperations)) {
      project.eventPackageOperations = {};
      changed = true;
    }
    if (!Array.isArray(project.events)) {
      project.events = [];
      changed = true;
    }
    for (const event of projectEvents(project)) {
      if (!event.id) {
        event.id = generateId("event");
        changed = true;
      }
      if (!event.type) {
        event.type = "upgrade";
        changed = true;
      }
      const normalizedType = normalizeEventType(event.type);
      if (event.type !== normalizedType) {
        event.type = normalizedType;
        changed = true;
      }
      if (!event.title) {
        event.title = eventTypeLabel(event.type);
        changed = true;
      }
      if (!event.createdAt) {
        event.createdAt = project.createdAt || new Date().toISOString();
        changed = true;
      }
      if (!Array.isArray(event.operations)) {
        event.operations = [];
        changed = true;
      }
    }

    const legacyProjectOps = Array.isArray(project.operations) ? project.operations : [];
    const legacyPackageOps = project.packageOperations && typeof project.packageOperations === "object" && !Array.isArray(project.packageOperations)
      ? project.packageOperations
      : {};
    const recordsWithoutEvent = (project.records || []).filter((record) => !record.eventId);
    const hasLegacyState = legacyProjectOps.length > 0 || Object.keys(legacyPackageOps).length > 0 || recordsWithoutEvent.length > 0;
    let legacyEvent = null;
    if (hasLegacyState) {
      legacyEvent = projectEvents(project).find((event) => event.isLegacyDefault);
      if (!legacyEvent) {
        legacyEvent = createProjectEvent(project, {
          type: "upgrade",
          title: "历史事件",
          isLegacyDefault: true,
          createdAt: recordsWithoutEvent[0]?.createdAt || legacyProjectOps[0]?.createdAt || project.createdAt || new Date().toISOString(),
        });
        changed = true;
      }
      if (legacyProjectOps.length > 0) {
        legacyEvent.operations.push(...legacyProjectOps);
        project.operations = [];
        changed = true;
      }
      for (const record of recordsWithoutEvent) {
        record.eventId = legacyEvent.id;
        changed = true;
      }
      for (const [packageName, operations] of Object.entries(legacyPackageOps)) {
        eventPackageOperations(project, legacyEvent.id, packageName).push(...(Array.isArray(operations) ? operations : []));
        changed = true;
      }
      if (Object.keys(legacyPackageOps).length > 0) {
        project.packageOperations = {};
        changed = true;
      }
    }

    for (const record of project.records || []) {
      if (!record.eventId) {
        const fallbackEvent = projectEvents(project)[0] || createProjectEvent(project, {
          type: "upgrade",
          title: "默认事件",
          createdAt: record.createdAt || project.createdAt || new Date().toISOString(),
        });
        record.eventId = fallbackEvent.id;
        changed = true;
      }
      for (const item of record.items || []) {
        if (!item.id) {
          item.id = generateId("item");
          changed = true;
        }
        if (!Array.isArray(item.operations)) {
          item.operations = [];
          changed = true;
          continue;
        }
        if (item.operations.length > 0) {
          const packageName = textValue(item.packageName, "未命名安装包");
          const targetOperations = eventPackageOperations(project, record.eventId, packageName);
          for (const operation of item.operations) {
            targetOperations.push({
              ...operation,
              migratedFromItemId: item.id,
            });
          }
          item.operations = [];
          changed = true;
        }
      }
    }
    if (changed) saveProjects();
  }

  function findOperationTarget(target) {
    const project = projectById(target.projectId);
    if (!project) return null;
    ensureProjectOperationShape(project);
    if (target.scope === "event") {
      const event = eventById(project, target.eventId);
      if (!event) return null;
      return { project, event, operations: event.operations };
    }
    if (target.scope === "package") {
      const event = eventById(project, target.eventId);
      if (!event) return null;
      return {
        project,
        event,
        packageName: target.packageName,
        operations: eventPackageOperations(project, target.eventId, target.packageName),
      };
    }
    return null;
  }

  function openOperationDocDialog(target, operationId = "") {
    const resolved = findOperationTarget(target);
    if (!resolved) return;
    const operation = operationId
      ? resolved.operations.find((item) => item.id === operationId)
      : null;
    pendingOperationTarget = { ...target, operationId };
    els.operationDocTitle.textContent = operation ? "编辑操作文档" : "添加操作文档";
    els.operationDocNameInput.value = operation ? textValue(operation.title || operation.label, "") : "";
    els.operationDocContentInput.value = operation ? textValue(operation.content, "") : "";
    syncOperationDocPreview();
    els.operationDocDialog.classList.remove("hidden");
    els.operationDocNameInput.focus();
  }

  function operationDisplayName(operation) {
    if (!operation) return "这条操作";
    if (operation.type === "document") return textValue(operation.title, "未命名操作文档");
    return textValue(operation.label, "操作事件");
  }

  function openOperationDeleteDialog(target, operationId) {
    const resolved = findOperationTarget(target);
    if (!resolved) return;
    const operation = resolved.operations.find((item) => item.id === operationId);
    if (!operation) return;
    pendingDeleteTarget = { kind: "operation", ...target, operationId };
    els.operationDeleteEyebrow.textContent = "delete operation";
    els.operationDeleteTitle.textContent = "删除这条操作？";
    els.operationDeleteMessage.textContent = `即将删除「${operationDisplayName(operation)}」，删除后不可恢复。`;
    els.operationDeleteDialog.classList.remove("hidden");
    els.confirmOperationDeleteButton.focus();
  }

  function openProjectDeleteDialog(projectId) {
    const project = projectById(projectId);
    if (!project) return;
    pendingDeleteTarget = { kind: "project", projectId };
    els.operationDeleteEyebrow.textContent = "delete project";
    els.operationDeleteTitle.textContent = "删除这个项目？";
    els.operationDeleteMessage.textContent = `即将删除项目「${textValue(project.name, "未命名项目")}」及其所有时间线记录，删除后不可恢复。`;
    els.operationDeleteDialog.classList.remove("hidden");
    els.confirmOperationDeleteButton.focus();
  }

  function deletePendingTarget() {
    if (!pendingDeleteTarget) return;
    if (pendingDeleteTarget.kind === "project") {
      projects = projects.filter((project) => project.id !== pendingDeleteTarget.projectId);
      if (currentProjectId === pendingDeleteTarget.projectId) {
        currentProjectId = "";
        selectedProjectEventId = "";
        selectedDetailPackageName = "";
        marketTargetEventId = "";
      }
      if (marketTargetProjectId === pendingDeleteTarget.projectId) {
        marketTargetProjectId = "";
        marketTargetEventId = "";
      }
      saveProjects();
      closeOperationDeleteDialog();
      renderProjects();
      return;
    }
    if (pendingDeleteTarget.kind === "event") {
      const project = projectById(pendingDeleteTarget.projectId);
      if (!project) return;
      ensureProjectOperationShape(project);
      project.events = projectEvents(project).filter((event) => event.id !== pendingDeleteTarget.eventId);
      project.records = (project.records || []).filter((record) => record.eventId !== pendingDeleteTarget.eventId);
      if (project.eventPackageOperations && typeof project.eventPackageOperations === "object") {
        delete project.eventPackageOperations[pendingDeleteTarget.eventId];
      }
      const remainingEvents = sortedProjectEvents(project);
      if (selectedProjectEventId === pendingDeleteTarget.eventId) {
        selectedProjectEventId = remainingEvents[0]?.id || "";
      }
      if (marketTargetEventId === pendingDeleteTarget.eventId) {
        marketTargetEventId = remainingEvents[0]?.id || "";
      }
      selectedDetailPackageName = "";
      saveProjects();
      closeOperationDeleteDialog();
      renderProjectDetail(project);
      return;
    }
    if (pendingDeleteTarget.kind === "package") {
      const project = projectById(pendingDeleteTarget.projectId);
      if (!project) return;
      ensureProjectOperationShape(project);
      const eventId = pendingDeleteTarget.eventId;
      const packageName = textValue(pendingDeleteTarget.packageName, "未命名安装包");
      project.records = (project.records || [])
        .map((record) => {
          if (record.eventId !== eventId) return record;
          const nextItems = (record.items || []).filter((item) => textValue(item.packageName, "未命名安装包") !== packageName);
          if (nextItems.length === 0) return null;
          return {
            ...record,
            title: `${nextItems.length} 项安装包操作`,
            items: nextItems,
          };
        })
        .filter(Boolean);
      if (project.eventPackageOperations?.[eventId] && typeof project.eventPackageOperations[eventId] === "object") {
        delete project.eventPackageOperations[eventId][packageName];
      }
      selectedDetailPackageName = "";
      saveProjects();
      closeOperationDeleteDialog();
      renderProjectDetail(project);
      return;
    }
    const resolved = findOperationTarget(pendingDeleteTarget);
    if (!resolved) return;
    resolved.operations = resolved.operations.filter((item) => item.id !== pendingDeleteTarget.operationId);
    if (pendingDeleteTarget.scope === "event") {
      resolved.event.operations = resolved.operations;
    }
    if (pendingDeleteTarget.scope === "package") {
      resolved.project.eventPackageOperations[pendingDeleteTarget.eventId][pendingDeleteTarget.packageName] = resolved.operations;
    }
    saveProjects();
    closeOperationDeleteDialog();
    renderProjectDetail(resolved.project);
  }

  function addOperationEvent(target, eventType) {
    const resolved = findOperationTarget(target);
    const eventOption = operationEvents.find((item) => item.type === eventType);
    if (!resolved || !eventOption) return;
    resolved.operations.push({
      id: generateId("operation"),
      type: "event",
      eventType: eventOption.type,
      label: eventOption.label,
      createdAt: new Date().toISOString(),
    });
    saveProjects();
    renderProjectDetail(resolved.project);
  }

  function sortedOperations(operations) {
    return [...(operations || [])].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  }

  function markdownSummary(value) {
    return textValue(value, "")
      .replace(/(?:https?:\/\/)?[^\s/]+(?:\/[^\s/]+){3,}/g, (match) => {
        const parts = match.split("/").filter(Boolean);
        if (parts.length <= 4) return match;
        return `${parts.slice(0, 3).join("/")}/.../${parts[parts.length - 1]}`;
      })
      .replace(/[#*_`>\-[\]()]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  function renderOperationActions(target) {
    const targetJson = escapeAttribute(JSON.stringify(target));
    return `
      <div class="operation-actions" data-operation-target="${targetJson}">
        <div class="event-dropdown">
          <button class="primary-button compact-button event-dropdown-trigger" type="button" data-event-menu-trigger aria-expanded="false">
            添加事件文档
            <span class="event-dropdown-icon" aria-hidden="true">▾</span>
          </button>
          <div class="event-dropdown-menu" role="menu">
            <button class="event-dropdown-option" type="button" role="menuitem" data-add-operation-doc>空文档</button>
            ${operationEvents.map((event) => `
              <button class="event-dropdown-option" type="button" role="menuitem" data-add-operation-event="${escapeAttribute(event.type)}">${escapeHtml(event.label)}</button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function renderEventTabs(events, activeEventId) {
    return `
      <section class="project-events-panel">
        <div class="project-events-head">
          <div>
            <p class="eyebrow">project events</p>
            <h3>项目事件</h3>
          </div>
          <button class="primary-button" type="button" data-create-project-event>新增事件</button>
        </div>
        <div class="project-event-items">
          ${events.map((event) => `
            <div class="project-event-item${event.id === activeEventId ? " active" : ""}">
              <button
                class="project-event-tab-button"
                type="button"
                data-event-tab="${escapeAttribute(event.id)}"
              >
                <strong>${escapeHtml(event.title)}</strong>
                <span>${escapeHtml(eventTypeLabel(event.type))} · ${escapeHtml(formatDateTime(event.createdAt))}</span>
              </button>
              <div class="project-event-item-actions">
                <button
                  class="text-button project-event-edit-button"
                  type="button"
                  data-rename-project-event="${escapeAttribute(event.id)}"
                  aria-label="重命名事件 ${escapeAttribute(event.title)}"
                  title="重命名当前事件"
                ><span class="edit-icon" aria-hidden="true"></span></button>
                <button
                  class="text-button danger project-event-delete-button"
                  type="button"
                  data-delete-project-event="${escapeAttribute(event.id)}"
                  aria-label="删除事件 ${escapeAttribute(event.title)}"
                  title="删除当前事件"
                ><span class="trash-icon" aria-hidden="true"></span></button>
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderEventSummary(event) {
    return `
      <section class="event-summary-card">
        <div>
          <p class="eyebrow">active event</p>
          <h3>${escapeHtml(event.title)}</h3>
          <p class="event-summary-meta">${escapeHtml(eventTypeLabel(event.type))} · ${escapeHtml(formatDateTime(event.createdAt))} · ${(event.operations || []).length} 条事件文档</p>
        </div>
        <div class="event-summary-actions">
          <button class="primary-button" type="button" data-shop-event-packages>为当前事件选购安装包</button>
        </div>
      </section>
    `;
  }

  function renderOperationStream(operations, emptyText, options = {}) {
    const items = sortedOperations(operations);
    if (items.length === 0) {
      if (options.directCreateDoc) {
        return `
          <button class="operation-empty-card" type="button" data-create-operation-doc>
            <strong>${escapeHtml(options.emptyActionTitle || "点击开始编辑事件文档")}</strong>
            <span>${escapeHtml(emptyText)}</span>
          </button>
        `;
      }
      return `<p class="operation-empty">${escapeHtml(emptyText)}</p>`;
    }
    return `
      <div class="operation-stream">
        ${items.map((operation) => {
          if (operation.type === "document") {
            const summary = markdownSummary(operation.content);
            return `
              <div class="operation-entry document">
                <button class="operation-entry-main" type="button" data-open-operation-doc="${escapeAttribute(operation.id)}">
                  <span class="operation-entry-kind">文档</span>
                  <strong>${escapeHtml(textValue(operation.title, "未命名操作文档"))}</strong>
                  <small>${escapeHtml(formatDateTime(operation.createdAt))}</small>
                  ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
                </button>
                <button
                  class="text-button danger operation-delete-button"
                  type="button"
                  aria-label="删除操作文档"
                  title="删除操作文档"
                  data-delete-operation="${escapeAttribute(operation.id)}"
                ><span class="trash-icon" aria-hidden="true"></span></button>
              </div>
            `;
          }
          return `
            <div class="operation-entry event">
              <button class="operation-entry-main" type="button" data-open-operation-doc="${escapeAttribute(operation.id)}">
                <span class="operation-entry-kind">事件</span>
                <strong>${escapeHtml(operation.label || "操作事件")}</strong>
                <small>${escapeHtml(formatDateTime(operation.createdAt))}</small>
                ${operation.content ? `<p>${escapeHtml(markdownSummary(operation.content))}</p>` : ""}
              </button>
              <button
                class="text-button danger operation-delete-button"
                type="button"
                aria-label="删除操作事件"
                title="删除操作事件"
                data-delete-operation="${escapeAttribute(operation.id)}"
              ><span class="trash-icon" aria-hidden="true"></span></button>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderOperationArea(target, operations, title, emptyText, options = {}) {
    const targetJson = escapeAttribute(JSON.stringify(target));
    return `
      <section class="operation-area" data-operation-area-target="${targetJson}">
        <div class="operation-area-head">
          <div>
            <p class="eyebrow">operation area</p>
            <h4>${escapeHtml(title)}</h4>
          </div>
          ${options.showActions === false ? "" : renderOperationActions(target)}
        </div>
        ${renderOperationStream(operations, emptyText, options)}
      </section>
    `;
  }

  function timelineTimestamp(node) {
    if (node.type === "package-operation") {
      return node.item.createdAt || node.record.createdAt || new Date().toISOString();
    }
    return node.createdAt || new Date().toISOString();
  }

  function buildPackageTimelineNodes(activePackage, direction = "desc") {
    const packageItems = activePackage.items.map((entry) => ({
      type: "package-operation",
      id: `${entry.record.id}-${entry.item.id}`,
      record: entry.record,
      item: entry.item,
      createdAt: entry.item.createdAt || entry.record.createdAt,
    }));
    const operationItems = (activePackage.operations || []).map((operation) => ({
      ...operation,
      type: operation.type === "document" ? "document" : "event",
    }));
    return [...packageItems, ...operationItems].sort((a, b) => {
      const delta = new Date(timelineTimestamp(a)) - new Date(timelineTimestamp(b));
      return direction === "asc" ? delta : -delta;
    });
  }

  function packageRecordSummary(activePackage) {
    const items = [...(activePackage.items || [])]
      .sort((a, b) => new Date((a.item.createdAt || a.record.createdAt || 0)) - new Date((b.item.createdAt || b.record.createdAt || 0)))
      .map((entry) => {
        const item = entry.item;
        return [
          textValue(item.channelLabel),
          textValue(item.arch),
          textValue(item.version, "未知版本"),
        ].filter(Boolean).join(" · ");
      });
    return items.join("；");
  }

  function ensurePackageOperationSeed(project, eventId, items) {
    const event = eventById(project, eventId);
    if (!event) return;
    const createdAt = new Date().toISOString();
    for (const item of items || []) {
      const packageName = textValue(item.packageName, "未命名安装包");
      const operations = eventPackageOperations(project, eventId, packageName);
      if (operations.length > 0) continue;
      operations.push({
        id: generateId("operation"),
        type: "event",
        eventType: normalizeEventType(event.type),
        label: eventTypeLabel(event.type),
        createdAt,
        autoGenerated: true,
      });
    }
  }

  function bindOperationActions(scope) {
    for (const actions of scope.querySelectorAll("[data-operation-target]")) {
      const target = JSON.parse(actions.dataset.operationTarget);
      const eventTrigger = actions.querySelector("[data-event-menu-trigger]");
      if (eventTrigger) {
        eventTrigger.addEventListener("click", (event) => {
          event.stopPropagation();
          const dropdown = eventTrigger.closest(".event-dropdown");
          const nextOpen = !dropdown.classList.contains("is-open");
          closeEventDropdowns();
          dropdown.classList.toggle("is-open", nextOpen);
          eventTrigger.setAttribute("aria-expanded", String(nextOpen));
        });
      }
      for (const button of actions.querySelectorAll("[data-add-operation-doc]")) {
        button.addEventListener("click", () => {
          closeEventDropdowns();
          openOperationDocDialog(target);
        });
      }
      for (const button of actions.querySelectorAll("[data-add-operation-event]")) {
        button.addEventListener("click", () => {
          closeEventDropdowns();
          addOperationEvent(target, button.dataset.addOperationEvent);
        });
      }
    }

    for (const button of scope.querySelectorAll("[data-open-operation-doc]")) {
      button.addEventListener("click", () => {
        const area = button.closest("[data-operation-area-target]");
        const targetContainer = area || button.closest("[data-operation-target]");
        if (!targetContainer) return;
        const target = JSON.parse(targetContainer.dataset.operationAreaTarget || targetContainer.dataset.operationTarget);
        openOperationDocDialog(target, button.dataset.openOperationDoc);
      });
    }

    for (const button of scope.querySelectorAll("[data-create-operation-doc]")) {
      button.addEventListener("click", () => {
        const area = button.closest("[data-operation-area-target]");
        if (!area) return;
        const target = JSON.parse(area.dataset.operationAreaTarget);
        openOperationDocDialog(target);
      });
    }

    for (const button of scope.querySelectorAll("[data-delete-operation]")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const area = button.closest("[data-operation-area-target]");
        const targetContainer = area || button.closest("[data-operation-target]");
        if (!targetContainer) return;
        const target = JSON.parse(targetContainer.dataset.operationAreaTarget || targetContainer.dataset.operationTarget);
        openOperationDeleteDialog(target, button.dataset.deleteOperation);
      });
    }
  }

  function renderPackageOperationTimelineEntry(project, entry, isLatest = false) {
    return `
      <article class="timeline-card${isLatest ? " latest" : ""}">
        <div class="timeline-dot" aria-hidden="true"></div>
        <div class="timeline-body">
          <div class="timeline-head">
            <div>
              <strong>${escapeHtml(entry.record.title)}</strong>
              <p>${escapeHtml(actionLabel(entry.item.actionLabel))} · ${escapeHtml(entry.item.channelLabel || "-")} · ${escapeHtml(entry.item.arch || "-")} · ${escapeHtml(entry.item.version || "未知版本")}</p>
            </div>
            <div class="record-actions">
              <time>${escapeHtml(formatDateTime(entry.item.createdAt || entry.record.createdAt))}</time>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderOperationTimelineEntry(operation, isLatest = false) {
    const summary = markdownSummary(operation.content);
    return `
      <article class="timeline-card timeline-operation-card${isLatest ? " latest" : ""}">
        <div class="timeline-dot" aria-hidden="true"></div>
        <div class="timeline-body operation-node">
          <div class="operation-entry ${operation.type === "document" ? "document" : "event"}">
            <button
              class="operation-entry-main"
              type="button"
              data-open-operation-doc="${escapeAttribute(operation.id)}"
            >
              <span class="operation-entry-kind">${operation.type === "document" ? "文档" : "事件"}</span>
              <strong>${escapeHtml(operation.type === "document" ? textValue(operation.title, "未命名操作文档") : textValue(operation.label, "操作事件"))}</strong>
              <small>${escapeHtml(formatDateTime(operation.createdAt))}</small>
              ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
            </button>
            <button
              class="text-button danger operation-delete-button"
              type="button"
              aria-label="${operation.type === "document" ? "删除操作文档" : "删除操作事件"}"
              title="${operation.type === "document" ? "删除操作文档" : "删除操作事件"}"
              data-delete-operation="${escapeAttribute(operation.id)}"
            ><span class="trash-icon" aria-hidden="true"></span></button>
          </div>
        </div>
      </article>
    `;
  }

  function renderPackageTimelineNode(project, node, isLatest = false) {
    if (node.type === "package-operation") {
      return renderPackageOperationTimelineEntry(project, node, isLatest);
    }
    return renderOperationTimelineEntry(node, isLatest);
  }

  function renderProjectDetail(project) {
    ensureProjectOperationShape(project);
    els.topbarTitleMeta.textContent = `负责人：${project.owner} · ${project.records.length} 条记录`;
    const events = sortedProjectEvents(project);

    if (events.length === 0) {
      selectedProjectEventId = "";
      selectedDetailPackageName = "";
      els.projectDetailContent.innerHTML = `
        <section class="project-empty-state">
          <div class="project-empty-panel">
            <p class="eyebrow">project event required</p>
            <h3>先创建一个项目事件</h3>
            <p>正确路径是「项目 - 事件 - 选购安装包 - 编辑对应文档」，请先创建项目事件。</p>
            <button id="createProjectEventButton" class="primary-button" type="button">新增项目事件</button>
          </div>
        </section>
      `;
      document.getElementById("createProjectEventButton")?.addEventListener("click", openProjectEventModal);
      return;
    }

    if (!events.some((event) => event.id === selectedProjectEventId)) {
      selectedProjectEventId = marketTargetEventId && events.some((event) => event.id === marketTargetEventId)
        ? marketTargetEventId
        : events[0].id;
    }
    const activeEvent = eventById(project, selectedProjectEventId) || events[0];
    selectedProjectEventId = activeEvent.id;
    const groupedPackages = recordsGroupedByPackage(project, activeEvent.id);

    if (groupedPackages.length === 0) {
      selectedDetailPackageName = "";
      els.projectDetailContent.innerHTML = `
        <section class="project-event-layout">
          ${renderEventTabs(events, activeEvent.id)}
          <section class="event-workspace">
            ${renderEventSummary(activeEvent)}
            <div class="event-workspace-body">
              <section class="project-operations-panel">
                ${renderOperationArea(
                  { scope: "event", projectId: project.id, eventId: activeEvent.id },
                  activeEvent.operations || [],
                  "事件文档",
                  "点击这里，直接开始编辑这个事件的文档内容。",
                  {
                    showActions: false,
                    directCreateDoc: true,
                    emptyActionTitle: "点击开始编辑事件文档",
                  },
                )}
              </section>
            </div>
          </section>
        </section>
      `;
      bindProjectEventActions(project);
      bindOperationActions(els.projectDetailContent);
      return;
    }

    if (!groupedPackages.some((item) => item.name === selectedDetailPackageName)) {
      selectedDetailPackageName = groupedPackages[0].name;
    }
    const activePackage = groupedPackages.find((item) => item.name === selectedDetailPackageName) || groupedPackages[0];
    selectedDetailPackageName = activePackage.name;
    activePackage.operations = eventPackageOperations(project, activeEvent.id, activePackage.name);
    const activePackageTarget = { scope: "package", projectId: project.id, eventId: activeEvent.id, packageName: activePackage.name };
    const packageTimelineNodes = buildPackageTimelineNodes(activePackage, "asc");
    const packageOperationNodes = packageTimelineNodes.filter((node) => node.type !== "package-operation");
    const activePackageTargetJson = escapeAttribute(JSON.stringify(activePackageTarget));

    els.projectDetailContent.innerHTML = `
      <section class="project-event-layout">
        ${renderEventTabs(events, activeEvent.id)}
        <section class="event-workspace">
          ${renderEventSummary(activeEvent)}
          <div class="event-workspace-body">
            <section class="project-operations-panel">
              ${renderOperationArea(
                { scope: "event", projectId: project.id, eventId: activeEvent.id },
                activeEvent.operations || [],
                "事件文档",
                "点击这里，直接开始编辑这个事件的文档内容。",
                {
                  showActions: false,
                  directCreateDoc: true,
                  emptyActionTitle: "点击开始编辑事件文档",
                },
              )}
            </section>
            <section class="project-detail-layout">
              <aside class="project-package-list">
                <div class="project-package-list-head">
                <div>
                  <p class="eyebrow">package list</p>
                  <h3>安装包列表</h3>
                </div>
              </div>
                <div class="project-package-items">
                  ${groupedPackages.map((pkg) => `
                    <div class="project-package-item${pkg.name === activePackage.name ? " active" : ""}">
                      <button
                        class="project-package-tab-button"
                        type="button"
                        data-package-tab="${escapeAttribute(pkg.name)}"
                      >
                        <strong>${escapeHtml(pkg.name)}</strong>
                        <span class="package-meta-text">${escapeHtml(packageRecordSummary(pkg) || `${pkg.items.length} 条记录`)}</span>
                      </button>
                      <button
                        class="text-button danger project-package-delete-button"
                        type="button"
                        data-delete-package="${escapeAttribute(pkg.name)}"
                        aria-label="删除安装包 ${escapeAttribute(pkg.name)}"
                        title="删除当前安装包"
                      ><span class="trash-icon" aria-hidden="true"></span></button>
                    </div>
                  `).join("")}
                </div>
              </aside>
              <section class="project-timeline-panel">
                <div class="project-timeline-head">
                  <div>
                    <p class="eyebrow">package timeline</p>
                    <h3>${escapeHtml(activePackage.name)}</h3>
                    <p class="package-meta-text">${escapeHtml(packageRecordSummary(activePackage))}</p>
                  </div>
                  ${renderOperationActions(activePackageTarget)}
                </div>
                <div class="timeline-list" data-operation-area-target="${activePackageTargetJson}">
                  ${packageOperationNodes.length > 0
                    ? packageOperationNodes
                      .map((node, index) => renderPackageTimelineNode(project, node, index === packageOperationNodes.length - 1))
                      .join("")
                    : `<p class="operation-empty">这个安装包还没有补充文档或事件记录。</p>`}
                </div>
              </section>
            </section>
          </div>
        </section>
      </section>
    `;

    for (const button of els.projectDetailContent.querySelectorAll("[data-package-tab]")) {
      button.addEventListener("click", () => {
        selectedDetailPackageName = button.dataset.packageTab;
        renderProjectDetail(project);
      });
    }

    bindProjectEventActions(project);
    bindOperationActions(els.projectDetailContent);
  }

  function bindProjectEventActions(project) {
    for (const button of els.projectDetailContent.querySelectorAll("[data-create-project-event]")) {
      button.addEventListener("click", openProjectEventModal);
    }
    for (const button of els.projectDetailContent.querySelectorAll("[data-event-tab]")) {
      button.addEventListener("click", () => {
        selectedProjectEventId = button.dataset.eventTab;
        selectedDetailPackageName = "";
        renderProjectDetail(project);
      });
    }
    for (const button of els.projectDetailContent.querySelectorAll("[data-rename-project-event]")) {
      button.addEventListener("click", () => {
        openProjectEventRenameModal(button.dataset.renameProjectEvent);
      });
    }
    for (const button of els.projectDetailContent.querySelectorAll("[data-shop-event-packages]")) {
      button.addEventListener("click", () => {
        marketTargetProjectId = project.id;
        marketTargetEventId = selectedProjectEventId;
        packageReturnPage = "project-detail";
        showPackagePage();
      });
    }
    for (const button of els.projectDetailContent.querySelectorAll("[data-delete-project-event]")) {
      button.addEventListener("click", () => {
        const event = eventById(project, button.dataset.deleteProjectEvent);
        if (!event) return;
        pendingDeleteTarget = { kind: "event", projectId: project.id, eventId: event.id };
        els.operationDeleteEyebrow.textContent = "delete project event";
        els.operationDeleteTitle.textContent = "删除这个项目事件？";
        els.operationDeleteMessage.textContent = `即将删除事件「${textValue(event.title, "未命名事件")}」以及该事件下的安装包记录和文档，删除后不可恢复。`;
        els.operationDeleteDialog.classList.remove("hidden");
        els.confirmOperationDeleteButton.focus();
      });
    }
    for (const button of els.projectDetailContent.querySelectorAll("[data-delete-package]")) {
      button.addEventListener("click", () => {
        const packageName = textValue(button.dataset.deletePackage, "未命名安装包");
        pendingDeleteTarget = {
          kind: "package",
          projectId: project.id,
          eventId: selectedProjectEventId,
          packageName,
        };
        els.operationDeleteEyebrow.textContent = "delete package";
        els.operationDeleteTitle.textContent = "删除这个安装包？";
        els.operationDeleteMessage.textContent = `即将删除安装包「${packageName}」以及它在当前事件下的安装记录和文档，删除后不可恢复。`;
        els.operationDeleteDialog.classList.remove("hidden");
        els.confirmOperationDeleteButton.focus();
      });
    }
  }

  function addCurrentPackageToCart(source) {
    if (!detail || !Array.isArray(detail.links) || detail.links.length === 0) return;
    const createdAt = new Date().toISOString();
    const items = detail.links.map((link) => ({
      id: generateId("cart"),
      action: "add-to-cart",
      actionLabel: "添加到项目",
      packageName: link.name || detail.title || selectedPackage,
      channel: els.channel.value,
      channelLabel: currentChannelLabel(),
      arch: els.arch.value,
      version: currentPackageVersion(link),
      objectKey: link.objectKey,
      value: link.downloadUrl,
      createdAt,
    }));
    cartItems = [...items, ...cartItems];
    saveCartItems();
    syncCartCount();
    animateToCart(source);
  }

  function animateToCart(source) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      pulseCartButton();
      return;
    }

    const from = source.getBoundingClientRect();
    const to = els.cartButton.getBoundingClientRect();
    const flyer = document.createElement("span");
    flyer.className = "cart-flyer";
    flyer.textContent = "+1";
    flyer.style.left = `${from.left + from.width / 2}px`;
    flyer.style.top = `${from.top + from.height / 2}px`;
    document.body.appendChild(flyer);

    flyer.animate(
      [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        {
          transform: `translate(${to.left + to.width / 2 - from.left - from.width / 2}px, ${to.top + to.height / 2 - from.top - from.height / 2}px) translate(-50%, -50%) scale(0.55)`,
          opacity: 0.15,
        },
      ],
      { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    ).addEventListener("finish", () => {
      flyer.remove();
      pulseCartButton();
    });
  }

  function pulseCartButton() {
    els.cartButton.classList.remove("cart-pulse");
    void els.cartButton.offsetWidth;
    els.cartButton.classList.add("cart-pulse");
  }

  async function loadRules() {
    try {
      els.statusText.textContent = "正在读取规则...";
      const payload = await request("/api/rules");
      rules = payload.rules || [];
      els.statusText.textContent = `已读取 ${rules.length} 个组合包规则，下载链接有效期 ${payload.expireMinutes} 分钟`;
      renderTabs();
      await loadDetail();
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(SESSION_KEY);
        showLogin();
        return;
      }
      els.statusText.textContent = "";
      els.linkCards.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
    }
  }

  function renderTabs() {
    const query = els.searchInput.value.trim().toLowerCase();
    els.appsTabs.innerHTML = "";
    els.middlewareTabs.innerHTML = "";
    document.querySelector('[data-package="base-pro"]').classList.toggle("active", selectedPackage === "base-pro");
    document.querySelector('[data-package="base-oss"]').classList.toggle("active", selectedPackage === "base-oss");
    syncGroupVisibility();

    for (const pkg of rules.filter((item) => packageMatches(item, query))) {
      const button = document.createElement("button");
      button.className = `package-tab${selectedPackage === pkg.id ? " active" : ""}`;
      button.type = "button";
      button.dataset.package = pkg.id;
      button.innerHTML = `<span>${escapeHtml(pkg.name)}</span><small>${escapeHtml(pkg.id)}</small>`;
      button.addEventListener("click", async () => {
        selectedPackage = pkg.id;
        expandedGroups.add(pkg.category === "middleware" ? "middleware" : "apps");
        ciVersions = [];
        releaseVersions = [];
        els.ciVersion.innerHTML = "";
        renderTabs();
        await loadDetail();
        scrollDetailToTop();
      });
      if (pkg.category === "middleware") {
        els.middlewareTabs.appendChild(button);
      } else {
        els.appsTabs.appendChild(button);
      }
    }
    syncGroupVisibility();
  }

  function syncGroupVisibility() {
    for (const group of document.querySelectorAll(".package-group[data-group]")) {
      const key = group.dataset.group;
      const expanded = expandedGroups.has(key);
      group.classList.toggle("collapsed", !expanded);
      const toggle = group.querySelector("[data-toggle-group]");
      const icon = group.querySelector(".toggle-icon");
      if (toggle) toggle.setAttribute("aria-expanded", String(expanded));
      if (icon) icon.textContent = expanded ? "▾" : "▸";
    }
  }

  function scrollDetailToTop() {
    const panel = document.querySelector(".detail-panel");
    if (!panel) return;
    panel.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async function loadDetail() {
    if (loadingDetail) return;
    loadingDetail = true;
    detail = null;
    syncChannelControls();
    renderDetailLoading();

    try {
      if (!isBasePackage() && els.channel.value === "ci" && ciVersions.length === 0) {
        await loadCiVersions();
      }
      if (els.channel.value === "release" && releaseVersions.length === 0) {
        await loadReleaseVersions();
      }
      const params = currentParams();
      const endpoint = isBasePackage() ? `/api/packages/base?${params}` : `/api/packages/${encodeURIComponent(selectedPackage)}?${params}`;
      detail = await request(endpoint);
      renderDetail();
    } catch (error) {
      detail = {
        title: selectedPackage,
        type: "error",
        meta: [],
        links: [],
        error: error.message,
      };
      renderDetail();
    } finally {
      loadingDetail = false;
    }
  }

  function renderDetailLoading() {
    els.packageTitle.textContent = "正在加载";
    els.packageType.textContent = isBasePackage() ? "base package" : "package";
    els.packageMeta.innerHTML = "";
    els.detailControls.innerHTML = "";
    els.linkCards.innerHTML = `<p>正在从 OSS 拉取真实包数据...</p>`;
  }

  async function loadCiVersions() {
    const params = currentParams();
    const payload = await request(`/api/packages/${encodeURIComponent(selectedPackage)}/ci-versions?${params}`);
    ciVersions = payload.versions || [];
    const previous = els.ciVersion.value;
    els.ciVersion.innerHTML = ciVersions
      .map((item) => `<option value="${escapeAttribute(item.hash)}">${escapeHtml(item.label)}</option>`)
      .join("");
    if (ciVersions.some((item) => item.hash === previous)) {
      els.ciVersion.value = previous;
    } else if (ciVersions.length > 0) {
      els.ciVersion.value = ciVersions[0].hash;
    }
    syncCustomSelect(els.ciVersion);
  }

  async function loadReleaseVersions() {
    const params = currentParams();
    const endpoint = isBasePackage()
      ? `/api/packages/base/release-versions?${params}`
      : `/api/packages/${encodeURIComponent(selectedPackage)}/release-versions?${params}`;
    const payload = await request(endpoint);
    releaseVersions = payload.versions || [];
  }

  function syncChannelControls() {
    const ciMode = els.channel.value === "ci" && !isBasePackage();
    els.ciVersionField.classList.toggle("hidden", !ciMode);
    if (isBasePackage() && els.channel.value === "ci") {
      els.channel.value = "release";
    }
  }

  function renderDetail() {
    if (!detail) return;

    els.packageTitle.textContent = detail.title || selectedPackage;
    els.packageType.textContent = detail.type || "";
    els.packageMeta.innerHTML = (detail.meta || [])
      .map((item) => `<div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.value)}</span></div>`)
      .join("");
    renderDetailControls();

    if (detail.error) {
      els.linkCards.innerHTML = `<p class="error-text">${escapeHtml(detail.error)}</p>`;
      return;
    }

    if (!detail.links || detail.links.length === 0) {
      els.linkCards.innerHTML = "<p>当前参数下没有找到可用对象。</p>";
      return;
    }

    els.linkCards.innerHTML = detail.links.map(renderLinkCard).join("");
    for (const button of els.linkCards.querySelectorAll("[data-copy]")) {
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(button.dataset.copy);
        const original = button.textContent;
        button.textContent = "已复制";
        window.setTimeout(() => {
          button.textContent = original;
        }, 1000);
      });
    }
  }

  function renderDetailControls() {
    const versions = detail && Array.isArray(detail.ciVersions) ? detail.ciVersions : [];
    if (els.channel.value === "ci" && !isBasePackage() && versions.length > 0) {
      const current = els.ciVersion.value || versions[0].hash;
      els.detailControls.innerHTML = `
      <label>
        测试版本（${versions.length} 个）
        <select id="detailCiVersion">
          ${versions
            .map((item) => `<option value="${escapeAttribute(item.hash)}"${item.hash === current ? " selected" : ""}>${escapeHtml(item.label)}</option>`)
            .join("")}
        </select>
      </label>
    `;

      const select = document.getElementById("detailCiVersion");
      enhanceSelect(select);
      select.addEventListener("change", async () => {
        els.ciVersion.value = select.value;
        syncCustomSelect(els.ciVersion);
        await loadDetail();
      });
      return;
    }

    const releaseItems = detail && Array.isArray(detail.releaseVersions) ? detail.releaseVersions : releaseVersions;
    if (els.channel.value === "release" && releaseItems.length > 0) {
      const selectedValue = (detail.meta || []).find((item) => item.label === "最新版本" || item.label === "基础包版本");
      const current = selectedValue ? selectedValue.value : releaseItems[0].version;
      els.detailControls.innerHTML = `
        <label>
          正式版本（${releaseItems.length} 个）
          <select id="detailReleaseVersion">
            ${releaseItems
              .map((item) => `<option value="${escapeAttribute(item.version)}"${item.version === current ? " selected" : ""}>${escapeHtml(item.label)}</option>`)
              .join("")}
          </select>
        </label>
      `;
      const select = document.getElementById("detailReleaseVersion");
      enhanceSelect(select);
      select.addEventListener("change", async () => {
        await loadDetail();
      });
      return;
    }

    els.detailControls.innerHTML = "";
  }

  function isBasePackage() {
    return selectedPackage === "base-pro" || selectedPackage === "base-oss";
  }

  function renderLinkCard(link) {
    const size = typeof link.size === "number" ? formatBytes(link.size) : "unknown";
    const updated = link.lastModified ? new Date(link.lastModified).toLocaleString() : "unknown";
    return `
      <article class="link-card">
        <div class="link-title-row">
          <div>
            <strong>${escapeHtml(link.name || link.objectKey)}</strong>
            <p>${escapeHtml(link.version || "")} ${escapeHtml(size)} · ${escapeHtml(updated)}</p>
          </div>
          <button
            class="copy-button"
            type="button"
            data-copy="${escapeAttribute(link.downloadUrl)}"
          >复制下载链接</button>
        </div>
        <div class="path-box"><code>${escapeHtml(link.objectKey)}</code></div>
        <div class="url-row">
          <a href="${escapeAttribute(link.downloadUrl)}" target="_blank" rel="noreferrer">${escapeHtml(link.downloadUrl)}</a>
          <button
            class="copy-button"
            type="button"
            data-copy="${escapeAttribute(link.objectKey)}"
          >复制 Key</button>
        </div>
      </article>
    `;
  }

  function formatBytes(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index++;
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await request("/api/login", {
        method: "POST",
        body: JSON.stringify({ password: els.passwordInput.value }),
      });
      sessionStorage.setItem(SESSION_KEY, "1");
      els.passwordInput.value = "";
      els.loginError.textContent = "";
      showConsole();
    } catch (error) {
      els.loginError.textContent = error.message;
    }
  });

  els.lockButton.addEventListener("click", async () => {
    await request("/api/logout", { method: "POST" }).catch(() => {});
    sessionStorage.removeItem(SESSION_KEY);
    showLogin();
  });

  els.marketButton.addEventListener("click", () => {
    marketTargetProjectId = "";
    marketTargetEventId = "";
    packageReturnPage = "projects";
    showPackagePage();
  });
  els.exportProjectTimelineButton.addEventListener("click", () => {
    const project = projectById(currentProjectId);
    if (!project) return;
    openExportPreviewDialog(project);
  });
  els.backToProjectsButton.addEventListener("click", () => {
    marketTargetProjectId = "";
    marketTargetEventId = "";
    if (currentPage === "project-detail") {
      showProjectsPage();
      return;
    }
    if (currentPage === "package" && packageReturnPage === "project-detail" && currentProjectId) {
      showProjectDetailPage(currentProjectId);
      return;
    }
    showProjectsPage();
  });
  els.topbarBackIcon.addEventListener("click", () => {
    marketTargetProjectId = "";
    marketTargetEventId = "";
    if (currentPage === "package" && packageReturnPage === "project-detail" && currentProjectId) {
      showProjectDetailPage(currentProjectId);
      return;
    }
    showProjectsPage();
  });
  els.openProjectModalButton.addEventListener("click", openProjectModal);
  els.closeProjectModalButton.addEventListener("click", closeProjectModal);
  els.cancelProjectModalButton.addEventListener("click", closeProjectModal);
  els.closeProjectEventModalButton.addEventListener("click", closeProjectEventModal);
  els.cancelProjectEventModalButton.addEventListener("click", closeProjectEventModal);
  els.cartButton.addEventListener("click", openCartDialog);
  els.closeCartButton.addEventListener("click", closeCartDialog);
  els.closeOperationDocButton.addEventListener("click", closeOperationDocDialog);
  els.cancelOperationDocButton.addEventListener("click", closeOperationDocDialog);
  els.closeExportPreviewButton.addEventListener("click", closeExportPreviewDialog);
  els.cancelExportPreviewButton.addEventListener("click", closeExportPreviewDialog);
  els.closeOperationDeleteButton.addEventListener("click", closeOperationDeleteDialog);
  els.cancelOperationDeleteButton.addEventListener("click", closeOperationDeleteDialog);
  els.confirmOperationDeleteButton.addEventListener("click", deletePendingTarget);

  bindBackdropDismiss(els.cartDialog, closeCartDialog);
  bindBackdropDismiss(els.projectModal, closeProjectModal);
  bindBackdropDismiss(els.projectEventModal, closeProjectEventModal);
  bindBackdropDismiss(els.operationDocDialog, closeOperationDocDialog);
  bindBackdropDismiss(els.exportPreviewDialog, closeExportPreviewDialog);
  bindBackdropDismiss(els.operationDeleteDialog, closeOperationDeleteDialog);

  if (els.operationDocToolbar) {
    els.operationDocToolbar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-doc-format]");
      if (!button) return;
      formatOperationDocSelection(button.dataset.docFormat);
    });
  }

  if (els.exportPreviewToolbar) {
    els.exportPreviewToolbar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-doc-format]");
      if (!button) return;
      formatExportPreviewSelection(button.dataset.docFormat);
    });
  }

  els.operationDocContentInput.addEventListener("input", syncOperationDocPreview);
  els.exportPreviewContentInput.addEventListener("input", syncExportPreview);

  els.confirmExportPreviewButton.addEventListener("click", () => {
    const project = projectById(pendingExportProjectId);
    if (!project) return;
    exportProjectTimeline(project, els.exportPreviewContentInput.value);
    closeExportPreviewDialog();
  });

  els.operationDocForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!pendingOperationTarget) return;
    const resolved = findOperationTarget(pendingOperationTarget);
    if (!resolved) return;
    const title = els.operationDocNameInput.value.trim() || "未命名操作文档";
    const content = els.operationDocContentInput.value.trim();
    if (!content) {
      els.operationDocContentInput.focus();
      return;
    }
    const operation = pendingOperationTarget.operationId
      ? resolved.operations.find((item) => item.id === pendingOperationTarget.operationId)
      : null;
    if (operation) {
      operation.title = title;
      operation.content = content;
      operation.updatedAt = new Date().toISOString();
    } else {
      resolved.operations.push({
        id: generateId("operation"),
        type: "document",
        title,
        content,
        createdAt: new Date().toISOString(),
      });
    }
    saveProjects();
    closeOperationDocDialog();
    renderProjectDetail(resolved.project);
  });

  els.projectForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = els.projectNameInput.value.trim();
    const owner = els.projectOwnerInput.value.trim();
    if (!name || !owner) return;

    projects.unshift({
      id: generateId("project"),
      name,
      owner,
      records: [],
      createdAt: new Date().toISOString(),
    });
    saveProjects();
    els.projectNameInput.value = "";
    els.projectOwnerInput.value = "";
    closeProjectModal();
    renderProjects();
  });

  els.projectEventForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const project = projectById(currentProjectId);
    if (!project) return;
    const selectedType = els.projectEventTypeInput.value;
    if (!selectedType) {
      setProjectEventTypeError(pendingProjectEventEditId ? "请选择事件类型后再保存事件。" : "请选择事件类型后再创建事件。");
      els.projectEventTypeInput.focus();
      return;
    }
    setProjectEventTypeError("");
    const eventTitle = els.projectEventNameInput.value.trim();
    const editingEvent = pendingProjectEventEditId ? eventById(project, pendingProjectEventEditId) : null;
    const created = editingEvent || createProjectEvent(project, {
      type: selectedType,
      title: eventTitle,
    });
    if (editingEvent) {
      editingEvent.title = textValue(eventTitle, `${eventTypeLabel(selectedType)} · ${formatDateTime(editingEvent.createdAt)}`);
      editingEvent.updatedAt = new Date().toISOString();
    }
    saveProjects();
    selectedProjectEventId = created.id;
    marketTargetEventId = created.id;
    selectedDetailPackageName = "";
    closeProjectEventModal();
    renderProjectDetail(project);
  });

  els.projectEventTypeInput?.addEventListener("change", () => {
    if (els.projectEventTypeInput.value) {
      setProjectEventTypeError("");
    }
  });

  els.clearCartButton.addEventListener("click", () => {
    cartItems = [];
    saveCartItems();
    renderCart();
  });

  els.cartProjectSelect.addEventListener("change", () => {
    if (!marketTargetProjectId) {
      marketTargetEventId = "";
    }
    renderEventOptions();
    els.generateRecordButton.disabled = cartItems.length === 0 || projects.length === 0 || !els.cartEventSelect.value;
  });

  els.cartEventSelect.addEventListener("change", () => {
    if (!marketTargetEventId) {
      marketTargetEventId = els.cartEventSelect.value;
    }
    els.generateRecordButton.disabled = cartItems.length === 0 || projects.length === 0 || !els.cartEventSelect.value;
  });

  els.generateRecordButton.addEventListener("click", () => {
    const projectId = marketTargetProjectId || els.cartProjectSelect.value;
    const project = projects.find((item) => item.id === projectId);
    const eventId = marketTargetEventId || els.cartEventSelect.value;
    if (!project || cartItems.length === 0 || !eventId) return;

    project.records.unshift({
      id: generateId("record"),
      title: `${cartItems.length} 项安装包操作`,
      items: cartItems,
      eventId,
      createdAt: new Date().toISOString(),
    });
    ensurePackageOperationSeed(project, eventId, cartItems);
    cartItems = [];
    saveProjects();
    saveCartItems();
    renderCart();
    renderProjects();
    currentProjectId = project.id;
    marketTargetProjectId = project.id;
    marketTargetEventId = eventId;
    selectedProjectEventId = eventId;
    selectedDetailPackageName = "";
    showProjectDetailPage(project.id);
  });

  for (const button of document.querySelectorAll("[data-package='base-pro'], [data-package='base-oss']")) {
    button.addEventListener("click", async () => {
      selectedPackage = button.dataset.package;
      expandedGroups.add("base");
      ciVersions = [];
      releaseVersions = [];
      els.ciVersion.innerHTML = "";
      syncCustomSelect(els.ciVersion);
      renderTabs();
      await loadDetail();
      scrollDetailToTop();
    });
  }

  for (const button of document.querySelectorAll("[data-toggle-group]")) {
    button.addEventListener("click", () => {
      const group = button.dataset.toggleGroup;
      if (expandedGroups.has(group)) {
        expandedGroups.delete(group);
      } else {
        expandedGroups.add(group);
      }
      syncGroupVisibility();
    });
  }

  for (const input of [els.arch, els.channel]) {
    input.addEventListener("change", async () => {
      ciVersions = [];
      releaseVersions = [];
      els.ciVersion.innerHTML = "";
      syncCustomSelect(els.ciVersion);
      await loadDetail();
    });
  }
  els.ciVersion.addEventListener("change", loadDetail);
  els.searchInput.addEventListener("input", renderTabs);
  els.refreshButton.addEventListener("click", loadDetail);

  els.addPackageToCartButton.addEventListener("click", () => {
    addCurrentPackageToCart(els.addPackageToCartButton);
    const original = els.addPackageToCartButton.textContent;
    els.addPackageToCartButton.textContent = "已添加";
    window.setTimeout(() => {
      els.addPackageToCartButton.textContent = original;
    }, 1000);
  });

  els.copyAllButton.addEventListener("click", async () => {
    const urls = Array.from(els.linkCards.querySelectorAll(".url-row a")).map((node) => node.href);
    await navigator.clipboard.writeText(urls.join("\n"));
    els.copyAllButton.textContent = "已复制";
    window.setTimeout(() => {
      els.copyAllButton.textContent = "复制全部下载链接";
    }, 1000);
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".custom-select")) return;
    if (event.target.closest(".event-dropdown")) return;
    closeOtherCustomSelects(null);
    closeEventDropdowns();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeOtherCustomSelects(null);
    closeEventDropdowns();
    closeCartDialog();
    closeOperationDocDialog();
    closeOperationDeleteDialog();
  });

  enhanceSelects(document);
  syncCartCount();
  renderProjectOptions();

  if (sessionStorage.getItem(SESSION_KEY) === "1") {
    showConsole();
  } else {
    showLogin();
  }
})();
