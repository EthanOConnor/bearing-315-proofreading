import {
  createAuthController,
  createReportStore,
  formatInteger,
  formatPercent,
  loadIssuesManifest,
  loadRuntimeConfig,
  renderAuthControls,
  reviewerUrl,
  summarizeReviewedCoverage,
  viewerUrl,
} from "./proofread-common.js";

const state = {
  runtimeConfig: null,
  authController: null,
  reportStore: null,
  manifest: null,
  reportsByIssue: {},
};

function byId(id) {
  return document.getElementById(id);
}

function buildIssueTable(issues, { showReviewLinks }) {
  const table = document.createElement("table");
  table.className = "issue-table";
  const rowMap = new Map();

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th scope="col">Year</th>
      <th scope="col">Issue</th>
      <th scope="col">Pages</th>
      <th scope="col">Words</th>
      ${showReviewLinks ? '<th scope="col">Review</th>' : ""}
    </tr>
  `;

  const tbody = document.createElement("tbody");
  for (const issue of issues) {
    const row = document.createElement("tr");
    row.className = "issue-row";
    row.tabIndex = 0;
    row.setAttribute("role", "link");
    row.setAttribute("aria-label", `Open ${issue.issue_title || issue.display_title}`);
    row.dataset.viewerUrl = viewerUrl(issue.issue_id);

    const yearCell = document.createElement("td");
    yearCell.className = "issue-year";
    yearCell.textContent = issue.year;

    const titleCell = document.createElement("td");
    titleCell.className = "issue-title-cell";
    const title = document.createElement("strong");
    title.className = "issue-title";
    title.textContent = issue.issue_title || issue.display_title;
    const excerpt = document.createElement("p");
    excerpt.className = "issue-subcopy";
    excerpt.textContent = issue.excerpt || "Transcript ready for review.";
    titleCell.append(title, excerpt);

    const pagesCell = document.createElement("td");
    pagesCell.className = "issue-numeric";
    pagesCell.textContent = String(issue.page_count);

    const wordsCell = document.createElement("td");
    wordsCell.className = "issue-numeric";
    wordsCell.textContent = issue.transcript_word_count.toLocaleString();

    row.append(yearCell, titleCell, pagesCell, wordsCell);
    if (showReviewLinks) {
      const actionCell = document.createElement("td");
      actionCell.className = "issue-action-cell";
      const reviewLink = document.createElement("a");
      reviewLink.className = "ghost-button issue-review-button";
      reviewLink.href = reviewerUrl(issue.issue_id);
      reviewLink.textContent = "Review";
      actionCell.appendChild(reviewLink);
      row.appendChild(actionCell);
    }

    row.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a, button")) {
        return;
      }
      window.location.href = row.dataset.viewerUrl;
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      window.location.href = row.dataset.viewerUrl;
    });

    tbody.appendChild(row);
    rowMap.set(issue.issue_id, row);
  }

  table.append(thead, tbody);
  return { table, rowMap };
}

function applyIssueCoverage(issues, rowMap, reportsByIssue) {
  let totalCharacters = 0;
  let markedCharacters = 0;

  for (const issue of issues) {
    const row = rowMap.get(issue.issue_id);
    const coverage = summarizeReviewedCoverage(issue, reportsByIssue?.[issue.issue_id] || []);
    totalCharacters += coverage.totalCharacters || 0;
    markedCharacters += coverage.oneCharacters || 0;
    if (!row) {
      continue;
    }
    row.style.setProperty("--proofread-progress-one", `${(coverage.oneRatio * 100).toFixed(2)}%`);
    row.style.setProperty("--proofread-progress-two", `${(coverage.twoRatio * 100).toFixed(2)}%`);
    row.title = `Marked clean: 1 proofreader ${Math.round(coverage.oneRatio * 100)}%, 2 proofreaders ${Math.round(coverage.twoRatio * 100)}%`;
  }

  return {
    totalCharacters,
    markedCharacters,
    progressRatio: totalCharacters ? markedCharacters / totalCharacters : 0,
  };
}

function renderPublicStats(publicStats, coverageStats) {
  byId("stat-registered-users").textContent = formatInteger(publicStats?.registered_users || 0);
  byId("stat-reviewed-characters").textContent = formatInteger(coverageStats.markedCharacters);
  byId("stat-project-progress").textContent = formatPercent(coverageStats.progressRatio);
}

function renderDashboard(summary) {
  const panel = byId("user-dashboard");
  if (!summary || !state.authController.isLoggedIn()) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  byId("dashboard-greeting").textContent = `Welcome back, ${state.authController.user().display_name}`;
  byId("dashboard-note").textContent = "Your personal proofing totals update from the live proofread API.";
  byId("dashboard-reviewed-characters").textContent = formatInteger(summary.reviewed_correct_characters);
  byId("dashboard-corrections-submitted").textContent = formatInteger(summary.corrections_submitted);
  byId("dashboard-corrections-approved").textContent = formatInteger(summary.corrections_approved);
  byId("dashboard-requests-for-more-info").textContent = formatInteger(summary.requests_for_more_info);
  byId("dashboard-awaiting-review").textContent = formatInteger(summary.awaiting_review);

  const requestList = byId("dashboard-request-list");
  requestList.replaceChildren();
  if (!Array.isArray(summary.recent_requests) || summary.recent_requests.length === 0) {
    byId("dashboard-request-summary").textContent = "No reviewer follow-up requests right now.";
    const empty = document.createElement("p");
    empty.className = "dashboard-request-empty";
    empty.textContent = "When a reviewer asks for more information on one of your reports, it will appear here.";
    requestList.appendChild(empty);
    return;
  }

  byId("dashboard-request-summary").textContent = `${summary.recent_requests.length} report${summary.recent_requests.length === 1 ? "" : "s"} need follow-up from you.`;

  for (const request of summary.recent_requests) {
    const item = document.createElement("a");
    item.className = "dashboard-request-item";
    item.href = viewerUrl(request.issue_id);

    const issueLine = document.createElement("strong");
    issueLine.textContent = request.issue_id;

    const selected = document.createElement("p");
    selected.textContent = request.selected_text || request.report_body || "Open the issue to review the request.";

    const note = document.createElement("p");
    note.className = "dashboard-request-note";
    note.textContent = request.review_note || "Reviewer requested more information.";

    item.append(issueLine, selected, note);
    requestList.appendChild(item);
  }
}

async function renderHomePage() {
  const runtimeMode = byId("runtime-mode");
  const issueCount = byId("issue-count");
  const issueTableWrap = byId("issue-table-wrap");
  const authControls = byId("auth-controls");

  runtimeMode.textContent = state.reportStore.modeLabel;
  issueCount.textContent = `${state.manifest.issue_count} issues currently in scope`;

  await renderAuthControls(authControls, state.authController, {
    onError(error) {
      runtimeMode.textContent = error.message;
    },
  });

  const showReviewLinks = state.reportStore.supportsReviewUi !== false
    && (state.runtimeConfig.showReviewLinks !== false || state.reportStore.canReview());

  const { table, rowMap } = buildIssueTable(state.manifest.issues, {
    showReviewLinks,
  });
  issueTableWrap.replaceChildren(table);

  const coverageStats = applyIssueCoverage(state.manifest.issues, rowMap, state.reportsByIssue);
  const [publicStats, userSummary] = await Promise.all([
    state.reportStore.loadPublicStats?.().catch((error) => {
      console.error(error);
      return {
        registered_users: 0,
        registered_reviewers: 0,
      };
    }),
    state.reportStore.loadUserSummary?.().catch((error) => {
      console.error(error);
      return null;
    }),
  ]);

  renderPublicStats(publicStats, coverageStats);
  renderDashboard(userSummary);
}

async function main() {
  const runtimeMode = byId("runtime-mode");
  const issueCount = byId("issue-count");
  const issueTableWrap = byId("issue-table-wrap");

  try {
    state.runtimeConfig = await loadRuntimeConfig();
    state.authController = createAuthController(state.runtimeConfig);
    await state.authController.init();
    state.reportStore = createReportStore(state.runtimeConfig, state.authController);
    state.manifest = await loadIssuesManifest();
    state.reportsByIssue = await state.reportStore.listAllIssueReports(state.manifest.issues.map((issue) => issue.issue_id));

    state.authController.onChange(async () => {
      try {
        await renderHomePage();
      } catch (error) {
        console.error(error);
      }
    });

    await renderHomePage();
  } catch (error) {
    runtimeMode.textContent = "Manifest unavailable";
    issueCount.textContent = "Could not load proofing issues.";
    const problem = document.createElement("p");
    problem.className = "issue-empty";
    problem.textContent = error.message;
    issueTableWrap.replaceChildren(problem);
    console.error(error);
  }
}

main();
