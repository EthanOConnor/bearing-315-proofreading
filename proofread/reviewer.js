import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import {
  cacheReviewerEmail,
  cacheReviewerName,
  createReportStore,
  fetchJson,
  getCachedReviewerEmail,
  getCachedReviewerName,
  groupBy,
  loadIssuesManifest,
  loadRuntimeConfig,
  reviewerUrl,
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
  reviews: [],
  problemReports: [],
  activeProblemIndex: 0,
  blockLookup: new Map(),
  activeReportId: null,
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
  const proofreadLink = byId("proofread-view");

  proofreadLink.href = viewerUrl(issueId);

  if (prevIssue) {
    prevLink.href = reviewerUrl(prevIssue.issue_id);
    prevLink.textContent = `Previous: ${prevIssue.issue_id}`;
    prevLink.classList.remove("is-disabled");
  } else {
    prevLink.href = "#";
    prevLink.textContent = "Previous";
    prevLink.classList.add("is-disabled");
  }

  if (nextIssue) {
    nextLink.href = reviewerUrl(nextIssue.issue_id);
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

function minimumZoomScale() {
  return Math.max(0.1, state.fitPageScale * 0.6);
}

function maximumZoomScale() {
  return Math.max(state.fitWidthScale * 8, state.fitPageScale * 8, 6);
}

function clampZoomScale(scale) {
  return Math.min(maximumZoomScale(), Math.max(minimumZoomScale(), scale));
}

function shouldZoomFromWheel(event) {
  if (event.ctrlKey || event.metaKey) {
    return true;
  }
  return event.deltaMode === WheelEvent.DOM_DELTA_LINE || event.deltaMode === WheelEvent.DOM_DELTA_PAGE;
}

function wheelDeltaPixels(event, referenceHeight) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 14;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * Math.max(referenceHeight * 0.85, 240);
  }
  return event.deltaY;
}

async function zoomAroundClientPoint(nextScale, clientX, clientY) {
  const wrap = byId("scan-stage").parentElement;
  const rect = wrap.getBoundingClientRect();
  const referenceScale = state.renderedScale || state.zoomScale || 1;
  const anchorX = wrap.scrollLeft + (clientX - rect.left);
  const anchorY = wrap.scrollTop + (clientY - rect.top);
  const contentX = anchorX / referenceScale;
  const contentY = anchorY / referenceScale;

  state.zoomScale = clampZoomScale(nextScale);
  await renderPdfPage();

  wrap.scrollLeft = Math.max(0, contentX * state.zoomScale - (clientX - rect.left));
  wrap.scrollTop = Math.max(0, contentY * state.zoomScale - (clientY - rect.top));
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

function reviewStatusLabel(status) {
  if (status === "correction_applied") return "Correction Applied";
  if (status === "dismissed") return "Dismissed";
  return "Confirmed Problem";
}

function latestReviewForReport(reportId) {
  const reviews = state.reviews.filter((review) => review.report_id === reportId);
  return reviews.length ? reviews[reviews.length - 1] : null;
}

function highlightActiveReport() {
  for (const marker of document.querySelectorAll(".reported-span")) {
    const reportIds = (marker.dataset.reportIds || "").split(",").filter(Boolean);
    const isActive = state.activeReportId && reportIds.includes(state.activeReportId);
    marker.classList.toggle("active-review-target", isActive);
  }
}

async function setActiveProblem(index, { scrollIntoView = true } = {}) {
  if (!state.problemReports.length) {
    state.activeProblemIndex = 0;
    state.activeReportId = null;
    byId("problem-status").textContent = "No reported problems for this issue.";
    byId("active-problem-kind").textContent = "Problem";
    byId("active-problem-text").textContent = "No reported problems for this issue.";
    byId("active-problem-meta").textContent = "";
    byId("prev-problem").disabled = true;
    byId("next-problem").disabled = true;
    byId("review-form").classList.add("is-disabled");
    return;
  }

  state.activeProblemIndex = (index + state.problemReports.length) % state.problemReports.length;
  const report = state.problemReports[state.activeProblemIndex];
  state.activeReportId = report.report_id;
  const latestReview = latestReviewForReport(report.report_id);

  byId("problem-status").textContent = `Problem ${state.activeProblemIndex + 1} of ${state.problemReports.length}`;
  byId("active-problem-kind").textContent = latestReview ? reviewStatusLabel(latestReview.review_status) : "Reported Problem";
  byId("active-problem-text").textContent = report.report_body || report.selected_text;
  byId("active-problem-meta").textContent = [
    report.scan_page ? `Scan page ${report.scan_page}` : "",
    new Date(report.created_at).toLocaleString(),
    latestReview ? `Latest review: ${reviewStatusLabel(latestReview.review_status)} by ${latestReview.reviewer_name}` : "No review recorded yet",
  ].filter(Boolean).join(" · ");
  byId("prev-problem").disabled = false;
  byId("next-problem").disabled = false;
  byId("review-form").classList.remove("is-disabled");

  const reviewStatus = byId("review-status");
  const reviewNote = byId("review-note");
  const correctedText = byId("corrected-text");
  reviewStatus.value = latestReview?.review_status || "confirmed_problem";
  reviewNote.value = latestReview?.review_note || "";
  correctedText.value = latestReview?.corrected_text || "";
  byId("reviewer-name").value = getCachedReviewerName(state.runtimeConfig);
  byId("reviewer-email").value = getCachedReviewerEmail(state.runtimeConfig);

  if (report.scan_page && state.pdf && state.pageNumber !== report.scan_page) {
    state.pageNumber = Math.max(1, Math.min(state.pdf.numPages, report.scan_page));
    await renderPdfPage();
  }

  highlightActiveReport();
  if (scrollIntoView) {
    const firstMarker = [...document.querySelectorAll(".reported-span.active-review-target")][0];
    firstMarker?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function bindTranscriptInteractions() {
  const surface = byId("transcript-surface");
  surface.addEventListener("click", async (event) => {
    const marker = event.target.closest(".reported-span");
    if (!marker) return;
    const reportIds = (marker.dataset.reportIds || "").split(",").filter(Boolean);
    const issueReportId = reportIds.find((reportId) => {
      const report = state.problemReports.find((candidate) => candidate.report_id === reportId);
      return Boolean(report);
    });
    if (!issueReportId) return;
    const index = state.problemReports.findIndex((report) => report.report_id === issueReportId);
    if (index >= 0) {
      await setActiveProblem(index, { scrollIntoView: false });
    }
  });
}

function bindReviewForm() {
  byId("review-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const report = state.problemReports[state.activeProblemIndex];
    if (!report) return;

    const reviewerName = byId("reviewer-name").value.trim();
    const reviewerEmail = byId("reviewer-email").value.trim();
    const reviewStatus = byId("review-status").value;
    const reviewNote = byId("review-note").value.trim();
    const correctedText = byId("corrected-text").value.trim();

    if (!reviewerName || !reviewerEmail) {
      setToast("Reviewer name and email are required.");
      return;
    }

    if (!reviewNote) {
      setToast("Add a review note before recording the decision.");
      return;
    }

    try {
      const created = await state.reportStore.submitReportReview(report.report_id, {
        issue_id: state.issue.issue_id,
        review_status: reviewStatus,
        review_note: reviewNote,
        corrected_text: correctedText,
        reviewer_name: reviewerName,
        reviewer_email: reviewerEmail,
      });
      state.reviews.push(created);
      cacheReviewerName(state.runtimeConfig, reviewerName);
      cacheReviewerEmail(state.runtimeConfig, reviewerEmail);
      await setActiveProblem(state.activeProblemIndex, { scrollIntoView: false });
      setToast("Review recorded.");
    } catch (error) {
      setToast(error.message);
      console.error(error);
    }
  });
}

function bindProblemNavigation() {
  byId("prev-problem").addEventListener("click", () => setActiveProblem(state.activeProblemIndex - 1));
  byId("next-problem").addEventListener("click", () => setActiveProblem(state.activeProblemIndex + 1));
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
    state.zoomScale = clampZoomScale(state.zoomScale / 1.2);
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

  const scanWrap = byId("scan-stage").parentElement;
  scanWrap.addEventListener("wheel", async (event) => {
    if (!shouldZoomFromWheel(event)) {
      return;
    }
    event.preventDefault();
    const delta = wheelDeltaPixels(event, scanWrap.clientHeight);
    const zoomFactor = Math.exp(-delta * 0.0025);
    await zoomAroundClientPoint(state.zoomScale * zoomFactor, event.clientX, event.clientY);
  }, { passive: false });
}

function bindPaneTabs() {
  for (const button of document.querySelectorAll("[data-pane-target]")) {
    button.addEventListener("click", () => {
      setActivePane(button.dataset.paneTarget);
      if (button.dataset.paneTarget === "scan") {
        window.requestAnimationFrame(() => {
          refreshPdfViewport().catch((error) => console.error(error));
        });
      }
    });
  }
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

  if (state.reportStore.supportsReviewUi === false) {
    throw new Error("Reviewer workflow is not available in the public GitHub issue deployment.");
  }

  renderRuntimeMode(`${state.reportStore.modeLabel} · reviewer`);
  renderIssueNav(issueId);

  const issueMeta = manifest.issues.find((issue) => issue.issue_id === issueId);
  if (!issueMeta) {
    throw new Error(`Issue ${issueId} is not in the published proofing manifest.`);
  }
  state.issue = issueMeta;

  const [meta, transcript, reports, reviews] = await Promise.all([
    fetchJson(`./issues/${issueId}/meta.json`),
    fetchJson(`./issues/${issueId}/transcript.json`),
    state.reportStore.listIssueReports(issueId),
    state.reportStore.listIssueReviews(issueId),
  ]);

  state.transcript = transcript;
  state.reports = reports;
  state.reviews = reviews;
  state.problemReports = reports.filter((report) => report.report_kind === "issue");

  byId("issue-title").textContent = meta.issue_title || meta.display_title;
  rebuildTranscript();
  await loadPdf(`./issues/${issueId}/scan.pdf`);
  setActivePane(state.activePane);

  bindDragPan();
  bindScanControls();
  bindPaneTabs();
  bindTranscriptInteractions();
  bindProblemNavigation();
  bindReviewForm();
  await setActiveProblem(0, { scrollIntoView: false });
}

main().catch((error) => {
  byId("issue-title").textContent = "Proofing review unavailable";
  setToast(error.message);
  console.error(error);
});
