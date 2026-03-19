import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import {
  cacheEmail,
  createReportStore,
  fetchJson,
  getCachedEmail,
  groupBy,
  loadIssuesManifest,
  loadRuntimeConfig,
  viewerUrl,
} from "./proofread-common.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const state = {
  runtimeConfig: null,
  reportStore: null,
  manifest: null,
  issue: null,
  transcript: null,
  pdf: null,
  pageNumber: 1,
  zoomScale: 1,
  fitWidthScale: 1,
  fitPageScale: 1,
  renderedScale: 0,
  reports: [],
  selectedAnchor: null,
  modalMode: "issue",
  blockLookup: new Map(),
  popupReportMap: new Map(),
  activePane: "transcript",
};

function queryIssueId() {
  const issueId = new URLSearchParams(window.location.search).get("issue");
  if (!issueId) {
    throw new Error("Missing issue query parameter.");
  }
  return issueId;
}

function byId(id) {
  return document.getElementById(id);
}

function setToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(setToast.timeoutId);
  setToast.timeoutId = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 2800);
}

function renderRuntimeMode(label) {
  byId("viewer-runtime-mode").textContent = label;
}

function renderIssueNav(issueId) {
  const issues = state.manifest.issues;
  const index = issues.findIndex((issue) => issue.issue_id === issueId);
  const prevIssue = index > 0 ? issues[index - 1] : null;
  const nextIssue = index >= 0 && index < issues.length - 1 ? issues[index + 1] : null;

  const prevLink = byId("prev-issue");
  const nextLink = byId("next-issue");

  if (prevIssue) {
    prevLink.href = viewerUrl(prevIssue.issue_id);
    prevLink.textContent = `Previous: ${prevIssue.issue_id}`;
    prevLink.classList.remove("is-disabled");
  } else {
    prevLink.href = "#";
    prevLink.textContent = "Previous";
    prevLink.classList.add("is-disabled");
  }

  if (nextIssue) {
    nextLink.href = viewerUrl(nextIssue.issue_id);
    nextLink.textContent = `Next: ${nextIssue.issue_id}`;
    nextLink.classList.remove("is-disabled");
  } else {
    nextLink.href = "#";
    nextLink.textContent = "Next";
    nextLink.classList.add("is-disabled");
  }
}

function setActivePane(pane) {
  state.activePane = pane === "scan" ? "scan" : "transcript";
  const workbench = byId("viewer-workbench");
  workbench.classList.toggle("is-pane-scan", state.activePane === "scan");
  workbench.classList.toggle("is-pane-transcript", state.activePane === "transcript");

  for (const button of document.querySelectorAll("[data-pane-target]")) {
    const isActive = button.dataset.paneTarget === state.activePane;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}

function bindDragPan() {
  const stage = byId("scan-stage");
  const wrap = stage.parentElement;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  stage.addEventListener("pointerdown", (event) => {
    isDragging = true;
    stage.classList.add("is-dragging");
    startX = event.clientX;
    startY = event.clientY;
    startLeft = wrap.scrollLeft;
    startTop = wrap.scrollTop;
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener("pointermove", (event) => {
    if (!isDragging) return;
    wrap.scrollLeft = startLeft - (event.clientX - startX);
    wrap.scrollTop = startTop - (event.clientY - startY);
  });

  function endDrag(event) {
    if (!isDragging) return;
    isDragging = false;
    stage.classList.remove("is-dragging");
    stage.releasePointerCapture(event.pointerId);
  }

  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
}

async function renderPdfPage() {
  const canvas = byId("scan-canvas");
  const page = await state.pdf.getPage(state.pageNumber);
  const viewportAtOne = page.getViewport({ scale: 1 });
  const wrap = byId("scan-stage").parentElement;

  if (!state.fitWidthScale || !state.fitPageScale || state.renderedScale === 0) {
    const width = Math.max(wrap.clientWidth - 48, 320);
    const height = Math.max(wrap.clientHeight - 48, 240);
    state.fitWidthScale = width / viewportAtOne.width;
    state.fitPageScale = Math.min(state.fitWidthScale, height / viewportAtOne.height);
    if (!state.zoomScale) {
      state.zoomScale = state.fitWidthScale;
    }
  }

  const viewport = page.getViewport({ scale: state.zoomScale });
  const context = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  state.renderedScale = state.zoomScale;
  byId("page-status").textContent = `Page ${state.pageNumber} of ${state.pdf.numPages}`;
}

async function loadPdf(scanUrl) {
  state.pdf = await pdfjsLib.getDocument(scanUrl).promise;
  state.pageNumber = 1;
  state.fitWidthScale = 0;
  state.fitPageScale = 0;
  state.zoomScale = 0;
  await renderPdfPage();
}

async function refreshPdfViewport() {
  if (!state.pdf) return;
  const previousFitWidthScale = state.fitWidthScale;
  const previousFitPageScale = state.fitPageScale;
  const wasFitWidth = Math.abs(state.zoomScale - previousFitWidthScale) < 0.01;
  const wasFitPage = Math.abs(state.zoomScale - previousFitPageScale) < 0.01;

  state.fitWidthScale = 0;
  state.fitPageScale = 0;
  await renderPdfPage();

  if (wasFitPage) {
    state.zoomScale = state.fitPageScale;
    await renderPdfPage();
  } else if (wasFitWidth) {
    state.zoomScale = state.fitWidthScale;
    await renderPdfPage();
  }
}

function reportKindLabel(kind) {
  return kind === "reviewed_correct" ? "Marked Correct" : "Problem Reported";
}

function actionKindLabel(kind) {
  return kind === "reviewed_correct" ? "Mark Correct" : "Report Problem";
}

function reportKindClass(kinds) {
  if (kinds.size > 1) {
    return "reported-mixed";
  }
  return kinds.has("reviewed_correct") ? "reported-correct" : "reported-issue";
}

function nodeTextLength(node) {
  if (!node) return 0;
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent.length;
  }
  if (node.nodeName === "BR") {
    return 1;
  }
  let total = 0;
  for (const child of node.childNodes) {
    total += nodeTextLength(child);
  }
  return total;
}

function measureBlockOffset(blockElement, container, offset) {
  let total = 0;
  let found = false;

  function walk(node) {
    if (found || !node) return;
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) {
        total += offset;
      } else {
        for (let index = 0; index < offset; index += 1) {
          total += nodeTextLength(node.childNodes[index]);
        }
      }
      found = true;
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      total += node.textContent.length;
      return;
    }

    if (node.nodeName === "BR") {
      total += 1;
      return;
    }

    for (const child of node.childNodes) {
      walk(child);
      if (found) return;
    }
  }

  walk(blockElement);
  return total;
}

function mergeDecorations(reports) {
  if (!reports.length) return [];
  const boundaries = new Set();
  for (const report of reports) {
    boundaries.add(report.start_offset);
    boundaries.add(report.end_offset);
  }

  const ordered = [...boundaries].sort((a, b) => a - b);
  const segments = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (start === end) continue;
    const covering = reports.filter((report) => report.start_offset < end && report.end_offset > start);
    if (!covering.length) continue;
    segments.push({
      start,
      end,
      reports: covering,
      kinds: new Set(covering.map((report) => report.report_kind)),
    });
  }

  const merged = [];
  for (const segment of segments) {
    const kindKey = [...segment.kinds].sort().join("|");
    const reportKey = segment.reports.map((report) => report.report_id).sort().join("|");
    const previous = merged[merged.length - 1];
    if (previous && previous.end === segment.start && previous.kindKey === kindKey && previous.reportKey === reportKey) {
      previous.end = segment.end;
    } else {
      merged.push({
        ...segment,
        kindKey,
        reportKey,
      });
    }
  }

  return merged;
}

function decorateTextRange(blockElement, decoration) {
  const nodes = [];
  let cursor = 0;

  function collect(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent.length;
      nodes.push({ node, start: cursor, end: cursor + length, isBreak: false });
      cursor += length;
      return;
    }

    if (node.nodeName === "BR") {
      nodes.push({ node, start: cursor, end: cursor + 1, isBreak: true });
      cursor += 1;
      return;
    }

    for (const child of node.childNodes) {
      collect(child);
    }
  }

  collect(blockElement);

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const entry = nodes[index];
    if (entry.isBreak) {
      continue;
    }
    if (entry.end <= decoration.start || entry.start >= decoration.end) {
      continue;
    }

    const localStart = Math.max(0, decoration.start - entry.start);
    const localEnd = Math.min(entry.node.textContent.length, decoration.end - entry.start);
    let target = entry.node;
    if (localEnd < target.textContent.length) {
      target.splitText(localEnd);
    }
    if (localStart > 0) {
      target = target.splitText(localStart);
    }

    const marker = document.createElement("mark");
    marker.className = `reported-span ${reportKindClass(decoration.kinds)}`;
    marker.dataset.reportIds = decoration.reports.map((report) => report.report_id).join(",");
    marker.dataset.blockId = blockElement.dataset.blockId;
    marker.textContent = target.textContent;
    target.parentNode.replaceChild(marker, target);
  }
}

function rebuildTranscript() {
  const surface = byId("transcript-surface");
  surface.innerHTML = state.transcript.body_html;
  state.popupReportMap = new Map(state.reports.map((report) => [report.report_id, report]));
  state.blockLookup = new Map(
    [...surface.querySelectorAll("[data-block-id]")].map((element) => [element.dataset.blockId, element])
  );

  const groupedReports = groupBy(state.reports, (report) => report.block_id);
  for (const [blockId, reports] of groupedReports.entries()) {
    const blockElement = state.blockLookup.get(blockId);
    if (!blockElement) continue;
    const decorations = mergeDecorations(reports);
    for (const decoration of decorations) {
      decorateTextRange(blockElement, decoration);
    }
  }
}

function hideSelectionToolbar() {
  const toolbar = byId("selection-toolbar");
  toolbar.classList.add("hidden");
}

function selectionAnchor() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startBlock = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer.closest?.("[data-block-id]")
    : range.startContainer.parentElement?.closest("[data-block-id]");
  const endBlock = range.endContainer.nodeType === Node.ELEMENT_NODE
    ? range.endContainer.closest?.("[data-block-id]")
    : range.endContainer.parentElement?.closest("[data-block-id]");

  if (!startBlock || !endBlock || startBlock.dataset.blockId !== endBlock.dataset.blockId) {
    return null;
  }

  const startOffset = measureBlockOffset(startBlock, range.startContainer, range.startOffset);
  const endOffset = measureBlockOffset(startBlock, range.endContainer, range.endOffset);

  const selectedText = range.toString().trim();
  if (!selectedText || startOffset === endOffset) {
    return null;
  }

  return {
    blockId: startBlock.dataset.blockId,
    selectedText,
    startOffset,
    endOffset,
    rect: range.getBoundingClientRect(),
  };
}

function showSelectionToolbar(anchor) {
  const toolbar = byId("selection-toolbar");
  toolbar.classList.remove("hidden");
  const top = window.scrollY + anchor.rect.top - toolbar.offsetHeight - 12;
  const left = window.scrollX + anchor.rect.left + anchor.rect.width / 2 - toolbar.offsetWidth / 2;
  toolbar.style.top = `${Math.max(12, top)}px`;
  toolbar.style.left = `${Math.max(12, left)}px`;
}

function currentReportPayload() {
  return {
    report_kind: state.modalMode,
    block_id: state.selectedAnchor.blockId,
    start_offset: state.selectedAnchor.startOffset,
    end_offset: state.selectedAnchor.endOffset,
    selected_text: state.selectedAnchor.selectedText,
    scan_page: state.pageNumber,
  };
}

function openModal(mode) {
  if (!state.selectedAnchor) {
    return;
  }
  state.modalMode = mode;

  const backdrop = byId("report-modal-backdrop");
  const modeLabel = byId("modal-mode-label");
  const selectedTextPreview = byId("selected-text-preview");
  const reportBody = byId("report-body");
  const reportEmail = byId("report-email");
  const reportEmailWrap = byId("report-email-wrap");
  const reportBodyLabel = byId("report-body-label");
  const emailHelp = byId("email-help");
  const submitButton = byId("submit-report");

  selectedTextPreview.value = state.selectedAnchor.selectedText;
  reportBody.value = mode === "reviewed_correct" ? "Reviewed against the scan; this transcript span appears correct." : "";
  reportEmail.value = getCachedEmail(state.runtimeConfig);
  reportEmail.required = state.reportStore.supportsPrivateContact !== false && mode === "reviewed_correct";
  modeLabel.textContent = actionKindLabel(mode);
  reportBodyLabel.textContent = mode === "reviewed_correct"
    ? "Notes for this marked-correct confirmation"
    : "What is wrong / what should it say?";
  reportEmailWrap.classList.toggle("hidden", state.reportStore.supportsPrivateContact === false);
  emailHelp.textContent = state.reportStore.supportsPrivateContact === false
    ? "GitHub issue mode uses your GitHub account as the visible reporter identity."
    : mode === "reviewed_correct"
      ? "Required for Mark Correct."
      : "Optional for problem reports.";
  submitButton.textContent = state.reportStore.submitButtonLabel || "Submit";

  backdrop.classList.remove("hidden");
  if (state.reportStore.supportsPrivateContact === false) {
    reportBody.focus();
  } else if (mode === "reviewed_correct") {
    reportEmail.focus();
  } else {
    reportBody.focus();
  }
}

function closeModal() {
  byId("report-modal-backdrop").classList.add("hidden");
}

async function submitReport(event) {
  event.preventDefault();

  const reportBody = byId("report-body").value.trim();
  const reportEmail = byId("report-email").value.trim();

  if (!state.selectedAnchor) {
    return;
  }

  if (state.reportStore.supportsPrivateContact !== false && state.modalMode === "reviewed_correct" && !reportEmail) {
    setToast("Email is required for Mark Correct.");
    return;
  }

  if (state.modalMode === "issue" && !reportBody) {
    setToast("Add a note describing the issue or correction.");
    return;
  }

  const payload = {
    ...currentReportPayload(),
    report_body: reportBody,
    reporter_email: state.reportStore.supportsPrivateContact === false ? "" : reportEmail,
    page_url: window.location.href,
  };

  try {
    const created = await state.reportStore.submitIssueReport(state.issue.issue_id, payload);
    state.reports.push(created);
    cacheEmail(state.runtimeConfig, reportEmail);
    rebuildTranscript();
    closeModal();
    window.getSelection()?.removeAllRanges();
    state.selectedAnchor = null;
    hideSelectionToolbar();
    if (created.status === "pending_github_submission") {
      setToast("Opened a prefilled GitHub issue in a new tab. Submit it there to finish.");
    } else {
      setToast(state.modalMode === "reviewed_correct" ? "Marked Correct saved." : "Problem report saved.");
    }
  } catch (error) {
    setToast(error.message);
    console.error(error);
  }
}

function buildReportPopover(reportIds, blockId, targetRect) {
  const popover = byId("report-popover");
  const reports = reportIds.map((reportId) => state.popupReportMap.get(reportId)).filter(Boolean);
  const blockReports = reports.filter((report) => report.block_id === blockId);
  popover.replaceChildren();

  const head = document.createElement("div");
  head.className = "popover-head";
  const title = document.createElement("strong");
  title.textContent = `${blockReports.length} proofing mark${blockReports.length === 1 ? "" : "s"}`;
  head.appendChild(title);
  popover.appendChild(head);

  for (const report of blockReports.slice(0, 3)) {
    const article = document.createElement("article");
    article.className = "popover-report";

    const kicker = document.createElement("p");
    kicker.className = "popover-kicker";
    kicker.textContent = reportKindLabel(report.report_kind);

    const body = document.createElement("p");
    body.textContent = report.report_body || report.selected_text;

    const meta = document.createElement("p");
    meta.className = "popover-meta";
    meta.textContent = new Date(report.created_at).toLocaleString();

    article.append(kicker, body, meta);
    popover.appendChild(article);
  }

  popover.classList.remove("hidden");
  popover.style.top = `${window.scrollY + targetRect.bottom + 10}px`;
  popover.style.left = `${Math.max(12, window.scrollX + targetRect.left)}px`;
}

function bindTranscriptInteractions() {
  const surface = byId("transcript-surface");

  document.addEventListener("selectionchange", () => {
    const anchor = selectionAnchor();
    if (!anchor) {
      hideSelectionToolbar();
      return;
    }
    state.selectedAnchor = anchor;
    showSelectionToolbar(anchor);
  });

  surface.addEventListener("mouseup", () => {
    const anchor = selectionAnchor();
    if (anchor) {
      state.selectedAnchor = anchor;
      showSelectionToolbar(anchor);
    }
  });

  surface.addEventListener("click", (event) => {
    const marker = event.target.closest(".reported-span");
    const popover = byId("report-popover");
    if (!marker) {
      popover.classList.add("hidden");
      return;
    }
    const reportIds = (marker.dataset.reportIds || "").split(",").filter(Boolean);
    buildReportPopover(reportIds, marker.dataset.blockId, marker.getBoundingClientRect());
  });

  byId("report-issue-action").addEventListener("click", () => openModal("issue"));
  byId("reviewed-correct-action").addEventListener("click", () => openModal("reviewed_correct"));
}

function bindModal() {
  byId("close-modal").addEventListener("click", closeModal);
  byId("cancel-modal").addEventListener("click", closeModal);
  byId("report-modal-backdrop").addEventListener("click", (event) => {
    if (event.target === byId("report-modal-backdrop")) {
      closeModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
      byId("report-popover").classList.add("hidden");
      hideSelectionToolbar();
    }
  });
  byId("report-form").addEventListener("submit", submitReport);
}

function bindPaneTabs() {
  for (const button of document.querySelectorAll("[data-pane-target]")) {
    button.addEventListener("click", () => {
      setActivePane(button.dataset.paneTarget);
      byId("report-popover").classList.add("hidden");
      hideSelectionToolbar();
      if (button.dataset.paneTarget === "scan") {
        window.requestAnimationFrame(() => {
          refreshPdfViewport().catch((error) => console.error(error));
        });
      }
    });
  }
}

function bindScanControls() {
  byId("prev-page").addEventListener("click", async () => {
    if (state.pageNumber > 1) {
      state.pageNumber -= 1;
      await renderPdfPage();
    }
  });
  byId("next-page").addEventListener("click", async () => {
    if (state.pageNumber < state.pdf.numPages) {
      state.pageNumber += 1;
      await renderPdfPage();
    }
  });
  byId("zoom-in").addEventListener("click", async () => {
    state.zoomScale *= 1.2;
    await renderPdfPage();
  });
  byId("zoom-out").addEventListener("click", async () => {
    state.zoomScale = Math.max(state.fitPageScale * 0.6, state.zoomScale / 1.2);
    await renderPdfPage();
  });
  byId("fit-page").addEventListener("click", async () => {
    state.zoomScale = state.fitPageScale;
    await renderPdfPage();
  });
  byId("fit-width").addEventListener("click", async () => {
    state.zoomScale = state.fitWidthScale;
    await renderPdfPage();
  });

  window.addEventListener("resize", async () => {
    if (!state.pdf) return;
    await refreshPdfViewport();
  });
}

async function main() {
  const issueId = queryIssueId();
  const [runtimeConfig, manifest] = await Promise.all([
    loadRuntimeConfig(),
    loadIssuesManifest(),
  ]);

  state.runtimeConfig = runtimeConfig;
  state.reportStore = createReportStore(runtimeConfig);
  state.manifest = manifest;

  renderRuntimeMode(state.reportStore.modeLabel);
  renderIssueNav(issueId);

  const issueMeta = manifest.issues.find((issue) => issue.issue_id === issueId);
  if (!issueMeta) {
    throw new Error(`Issue ${issueId} is not in the published proofing manifest.`);
  }
  state.issue = issueMeta;

  const [meta, transcript, reports] = await Promise.all([
    fetchJson(`./issues/${issueId}/meta.json`),
    fetchJson(`./issues/${issueId}/transcript.json`),
    state.reportStore.listIssueReports(issueId),
  ]);

  state.transcript = transcript;
  state.reports = reports;
  state.popupReportMap = new Map(reports.map((report) => [report.report_id, report]));

  byId("issue-title").textContent = meta.issue_title || meta.display_title;
  rebuildTranscript();
  await loadPdf(`./issues/${issueId}/scan.pdf`);

  setActivePane(state.activePane);
  bindDragPan();
  bindScanControls();
  bindTranscriptInteractions();
  bindModal();
  bindPaneTabs();
}

main().catch((error) => {
  byId("issue-title").textContent = "Proofing viewer unavailable";
  setToast(error.message);
  console.error(error);
});
