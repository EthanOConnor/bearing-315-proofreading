import { createReportStore, loadIssuesManifest, loadRuntimeConfig, reviewerUrl, viewerUrl } from "./proofread-common.js";

function buildIssueTable(issues, { showReviewLinks }) {
  const table = document.createElement("table");
  table.className = "issue-table";

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
      const actionGroup = document.createElement("div");
      actionGroup.className = "issue-action-group";

      const reviewLink = document.createElement("a");
      reviewLink.className = "ghost-button issue-review-button";
      reviewLink.href = reviewerUrl(issue.issue_id);
      reviewLink.textContent = "Review";

      actionGroup.append(reviewLink);
      actionCell.appendChild(actionGroup);
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
  }

  table.append(thead, tbody);
  return table;
}

async function main() {
  const runtimeMode = document.getElementById("runtime-mode");
  const issueCount = document.getElementById("issue-count");
  const issueTableWrap = document.getElementById("issue-table-wrap");

  try {
    const [runtimeConfig, manifest] = await Promise.all([
      loadRuntimeConfig(),
      loadIssuesManifest(),
    ]);

    const reportStore = createReportStore(runtimeConfig);
    runtimeMode.textContent = reportStore.modeLabel;
    issueCount.textContent = `${manifest.issue_count} issues currently in scope`;
    issueTableWrap.replaceChildren(buildIssueTable(manifest.issues, {
      showReviewLinks: runtimeConfig.showReviewLinks !== false && reportStore.supportsReviewUi !== false,
    }));
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
