const DEFAULT_RUNTIME_CONFIG = {
  submissionMode: "local",
  apiBaseUrl: "",
  apiKey: "",
  projectLabel: "Project77 Proofread",
  storageKeyPrefix: "project77-proofread",
  cacheEmailKey: "project77-proofread-email",
  cacheReviewerNameKey: "project77-proofread-reviewer-name",
  cacheReviewerEmailKey: "project77-proofread-reviewer-email",
  showReviewLinks: true,
  githubRepoOwner: "",
  githubRepoName: "",
  githubIssueLabel: "proofread-report",
  githubProblemLabel: "report-problem",
  githubCorrectLabel: "mark-correct",
};

export async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}`);
  }
  return response.json();
}

export async function loadRuntimeConfig() {
  try {
    const config = await fetchJson("./data/runtime-config.json");
    return { ...DEFAULT_RUNTIME_CONFIG, ...config };
  } catch (error) {
    console.warn("Falling back to default runtime config.", error);
    return { ...DEFAULT_RUNTIME_CONFIG };
  }
}

export async function loadIssuesManifest() {
  return fetchJson("./data/issues.json");
}

export function viewerUrl(issueId) {
  return `./viewer.html?issue=${encodeURIComponent(issueId)}`;
}

export function reviewerUrl(issueId) {
  return `./reviewer.html?issue=${encodeURIComponent(issueId)}`;
}

function storageKey(runtimeConfig, issueId) {
  return `${runtimeConfig.storageKeyPrefix}:reports:${issueId}`;
}

function reviewStorageKey(runtimeConfig, issueId) {
  return `${runtimeConfig.storageKeyPrefix}:reviews:${issueId}`;
}

function nextLocalId(runtimeConfig) {
  const key = `${runtimeConfig.storageKeyPrefix}:local-id`;
  const current = Number.parseInt(localStorage.getItem(key) || "0", 10) + 1;
  localStorage.setItem(key, String(current));
  return `local-${current}`;
}

function loadLocalReports(runtimeConfig, issueId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(runtimeConfig, issueId)) || "[]");
  } catch (error) {
    console.warn("Could not parse cached proofread reports.", error);
    return [];
  }
}

function saveLocalReports(runtimeConfig, issueId, reports) {
  localStorage.setItem(storageKey(runtimeConfig, issueId), JSON.stringify(reports));
}

function loadLocalReviews(runtimeConfig, issueId) {
  try {
    return JSON.parse(localStorage.getItem(reviewStorageKey(runtimeConfig, issueId)) || "[]");
  } catch (error) {
    console.warn("Could not parse cached proofread reviews.", error);
    return [];
  }
}

function saveLocalReviews(runtimeConfig, issueId, reviews) {
  localStorage.setItem(reviewStorageKey(runtimeConfig, issueId), JSON.stringify(reviews));
}

function localStore(runtimeConfig) {
  return {
    modeLabel: "Local demo mode",
    supportsReviewUi: true,
    supportsPrivateContact: true,
    submitButtonLabel: "Submit",
    async listIssueReports(issueId) {
      return loadLocalReports(runtimeConfig, issueId);
    },
    async listIssueReviews(issueId) {
      return loadLocalReviews(runtimeConfig, issueId);
    },
    async listAllIssueReports(issueIds) {
      const grouped = {};
      for (const issueId of issueIds) {
        grouped[issueId] = loadLocalReports(runtimeConfig, issueId);
      }
      return grouped;
    },
    async submitIssueReport(issueId, payload) {
      const report = {
        report_id: nextLocalId(runtimeConfig),
        issue_id: issueId,
        status: "new",
        created_at: new Date().toISOString(),
        ...payload,
      };
      const reports = loadLocalReports(runtimeConfig, issueId);
      reports.push(report);
      saveLocalReports(runtimeConfig, issueId, reports);
      return report;
    },
    async submitReportReview(reportId, payload) {
      const review = {
        review_id: nextLocalId(runtimeConfig),
        report_id: reportId,
        issue_id: payload.issue_id,
        created_at: new Date().toISOString(),
        ...payload,
      };
      const reviews = loadLocalReviews(runtimeConfig, payload.issue_id);
      reviews.push(review);
      saveLocalReviews(runtimeConfig, payload.issue_id, reviews);
      return review;
    },
  };
}

function reportSignature(report) {
  return [
    report.issue_id,
    report.report_kind,
    report.block_id,
    report.start_offset,
    report.end_offset,
    report.selected_text,
    report.report_body,
  ].join("::");
}

function parseGithubReportMetadata(issue) {
  const match = issue.body?.match(/<!--\s*PROOFREAD_REPORT_V1\s*\n([\s\S]*?)\n-->/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    console.warn("Could not parse GitHub proofread metadata.", error);
    return null;
  }
}

async function fetchGithubIssueReports(runtimeConfig) {
  const owner = runtimeConfig.githubRepoOwner;
  const repo = runtimeConfig.githubRepoName;
  if (!owner || !repo) {
    return [];
  }

  const reports = [];
  for (let page = 1; page < 100; page += 1) {
    const apiUrl = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`);
    apiUrl.searchParams.set("state", "all");
    apiUrl.searchParams.set("labels", runtimeConfig.githubIssueLabel);
    apiUrl.searchParams.set("per_page", "100");
    apiUrl.searchParams.set("page", String(page));

    const response = await fetch(apiUrl.toString(), {
      headers: {
        accept: "application/vnd.github+json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Could not load GitHub proofread issues: HTTP ${response.status}`);
    }

    const batch = await response.json();
    const issues = Array.isArray(batch) ? batch : [];
    for (const issue of issues) {
      if (issue.pull_request) {
        continue;
      }
      const metadata = parseGithubReportMetadata(issue);
      if (!metadata?.issue_id || !metadata?.block_id) {
        continue;
      }
      reports.push({
        report_id: `gh-${issue.number}`,
        issue_id: metadata.issue_id,
        report_kind: metadata.report_kind,
        block_id: metadata.block_id,
        start_offset: metadata.start_offset,
        end_offset: metadata.end_offset,
        selected_text: metadata.selected_text,
        scan_page: metadata.scan_page,
        report_body: metadata.report_body || "",
        page_url: metadata.page_url || issue.html_url,
        status: issue.state,
        created_at: issue.created_at,
        reporter_name: issue.user?.login || "",
        github_issue_number: issue.number,
        github_issue_url: issue.html_url,
      });
    }

    if (issues.length < 100) {
      break;
    }
  }

  return reports;
}

function buildGithubIssueUrl(runtimeConfig, issueId, payload) {
  const owner = runtimeConfig.githubRepoOwner;
  const repo = runtimeConfig.githubRepoName;
  const isMarkedCorrect = payload.report_kind === "reviewed_correct";
  const labelSet = [
    runtimeConfig.githubIssueLabel,
    isMarkedCorrect ? runtimeConfig.githubCorrectLabel : runtimeConfig.githubProblemLabel,
  ].filter(Boolean);

  const titlePrefix = isMarkedCorrect ? "Marked Correct" : "Problem Report";
  const selectedSnippet = (payload.selected_text || "").replace(/\s+/g, " ").trim();
  const titleSnippet = selectedSnippet.length > 64 ? `${selectedSnippet.slice(0, 61).trimEnd()}...` : selectedSnippet;
  const title = `[${issueId}] ${titlePrefix}: ${titleSnippet || payload.block_id}`;

  const metadata = {
    issue_id: issueId,
    report_kind: payload.report_kind,
    block_id: payload.block_id,
    start_offset: payload.start_offset,
    end_offset: payload.end_offset,
    selected_text: payload.selected_text,
    scan_page: payload.scan_page,
    report_body: payload.report_body,
    page_url: payload.page_url,
  };

  const visibleBody = [
    `Proofread submission from the ${runtimeConfig.projectLabel}.`,
    "",
    `- Issue ID: ${issueId}`,
    `- Report type: ${isMarkedCorrect ? "Marked Correct" : "Problem Report"}`,
    "",
    "Selected transcript text:",
    `> ${payload.selected_text || "(blank)"}`,
    "",
    isMarkedCorrect ? "Notes:" : "Problem / correction note:",
    payload.report_body || "(none provided)",
    "",
    "The hidden metadata block below is used by the site to reload this mark.",
    "",
    `<!-- PROOFREAD_REPORT_V1`,
    JSON.stringify(metadata, null, 2),
    `-->`,
  ].join("\n");

  const issueUrl = new URL(`https://github.com/${owner}/${repo}/issues/new`);
  issueUrl.searchParams.set("title", title);
  issueUrl.searchParams.set("body", visibleBody);
  if (labelSet.length) {
    issueUrl.searchParams.set("labels", labelSet.join(","));
  }
  return issueUrl.toString();
}

function githubIssueStore(runtimeConfig) {
  let githubReportsPromise;

  function loadGithubReports() {
    if (!githubReportsPromise) {
      githubReportsPromise = fetchGithubIssueReports(runtimeConfig);
    }
    return githubReportsPromise;
  }

  return {
    modeLabel: "GitHub issue mode",
    supportsReviewUi: false,
    supportsPrivateContact: false,
    submitButtonLabel: "Continue to GitHub",
    async listIssueReports(issueId) {
      const [githubReports, localReports] = await Promise.all([
        loadGithubReports(),
        Promise.resolve(loadLocalReports(runtimeConfig, issueId)),
      ]);
      const filteredGithub = githubReports.filter((report) => report.issue_id === issueId);
      const githubSignatures = new Set(filteredGithub.map(reportSignature));
      const pendingLocal = localReports.filter((report) => !githubSignatures.has(reportSignature(report)));
      return [...filteredGithub, ...pendingLocal];
    },
    async listAllIssueReports(issueIds) {
      const [githubReports] = await Promise.all([loadGithubReports()]);
      const grouped = {};
      for (const issueId of issueIds) {
        const filteredGithub = githubReports.filter((report) => report.issue_id === issueId);
        const localReports = loadLocalReports(runtimeConfig, issueId);
        const githubSignatures = new Set(filteredGithub.map(reportSignature));
        const pendingLocal = localReports.filter((report) => !githubSignatures.has(reportSignature(report)));
        grouped[issueId] = [...filteredGithub, ...pendingLocal];
      }
      return grouped;
    },
    async listIssueReviews() {
      return [];
    },
    async submitIssueReport(issueId, payload) {
      const created = {
        report_id: nextLocalId(runtimeConfig),
        issue_id: issueId,
        status: "pending_github_submission",
        created_at: new Date().toISOString(),
        github_issue_url: buildGithubIssueUrl(runtimeConfig, issueId, payload),
        ...payload,
      };
      const reports = loadLocalReports(runtimeConfig, issueId);
      reports.push(created);
      saveLocalReports(runtimeConfig, issueId, reports);
      window.open(created.github_issue_url, "_blank", "noopener,noreferrer");
      return created;
    },
    async submitReportReview() {
      throw new Error("Reviewer actions are not available in GitHub issue mode.");
    },
  };
}

function apiStore(runtimeConfig) {
  const baseUrl = runtimeConfig.apiBaseUrl.replace(/\/$/, "");
  const headers = runtimeConfig.apiKey
    ? { "x-api-key": runtimeConfig.apiKey }
    : {};

  return {
    modeLabel: "API mode",
    supportsReviewUi: true,
    supportsPrivateContact: true,
    submitButtonLabel: "Submit",
    async listIssueReports(issueId) {
      const response = await fetch(`${baseUrl}/issues/${encodeURIComponent(issueId)}/reports`, {
        headers,
      });
      if (!response.ok) {
        throw new Error(`Could not load reports: HTTP ${response.status}`);
      }
      const payload = await response.json();
      return payload.reports || [];
    },
    async listIssueReviews(issueId) {
      const response = await fetch(`${baseUrl}/issues/${encodeURIComponent(issueId)}/reviews`, {
        headers,
      });
      if (!response.ok) {
        throw new Error(`Could not load reviews: HTTP ${response.status}`);
      }
      const payload = await response.json();
      return payload.reviews || [];
    },
    async listAllIssueReports(issueIds) {
      const entries = await Promise.all(issueIds.map(async (issueId) => [issueId, await this.listIssueReports(issueId)]));
      return Object.fromEntries(entries);
    },
    async submitIssueReport(issueId, payload) {
      const response = await fetch(`${baseUrl}/issues/${encodeURIComponent(issueId)}/reports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Could not submit report: HTTP ${response.status}`);
      }
      const created = await response.json();
      return created.report;
    },
    async submitReportReview(reportId, payload) {
      const response = await fetch(`${baseUrl}/reports/${encodeURIComponent(reportId)}/reviews`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Could not submit review: HTTP ${response.status}`);
      }
      const created = await response.json();
      return created.review;
    },
  };
}

export function createReportStore(runtimeConfig) {
  if (runtimeConfig.submissionMode === "api" && runtimeConfig.apiBaseUrl) {
    return apiStore(runtimeConfig);
  }
  if (runtimeConfig.submissionMode === "github_issue" && runtimeConfig.githubRepoOwner && runtimeConfig.githubRepoName) {
    return githubIssueStore(runtimeConfig);
  }
  return localStore(runtimeConfig);
}

function proofreaderIdentity(report) {
  return (report.reporter_name || report.reporter_email || "").trim().toLowerCase();
}

export function summarizeReviewedCoverage(issue, reports) {
  const totalLength = Number(issue.transcript_text_length || 0);
  if (!totalLength || !Array.isArray(reports) || reports.length === 0) {
    return { oneRatio: 0, twoRatio: 0 };
  }

  const grouped = groupBy(
    reports.filter((report) => report.report_kind === "reviewed_correct"),
    (report) => report.block_id
  );

  let oneCoverage = 0;
  let twoCoverage = 0;

  for (const blockReports of grouped.values()) {
    const normalized = blockReports
      .map((report) => ({
        start: Number(report.start_offset),
        end: Number(report.end_offset),
        identity: proofreaderIdentity(report),
      }))
      .filter((report) => Number.isFinite(report.start) && Number.isFinite(report.end) && report.end > report.start && report.identity);

    if (!normalized.length) {
      continue;
    }

    const boundaries = [...new Set(normalized.flatMap((report) => [report.start, report.end]))].sort((a, b) => a - b);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      if (end <= start) {
        continue;
      }
      const activeProofreaders = new Set(
        normalized
          .filter((report) => report.start < end && report.end > start)
          .map((report) => report.identity)
      );
      if (activeProofreaders.size >= 1) {
        oneCoverage += end - start;
      }
      if (activeProofreaders.size >= 2) {
        twoCoverage += end - start;
      }
    }
  }

  return {
    oneRatio: Math.max(0, Math.min(1, oneCoverage / totalLength)),
    twoRatio: Math.max(0, Math.min(1, twoCoverage / totalLength)),
  };
}

export function getCachedEmail(runtimeConfig) {
  return localStorage.getItem(runtimeConfig.cacheEmailKey) || "";
}

export function cacheEmail(runtimeConfig, value) {
  cacheValue(runtimeConfig.cacheEmailKey, value);
}

export function getCachedReviewerName(runtimeConfig) {
  return localStorage.getItem(runtimeConfig.cacheReviewerNameKey) || "";
}

export function cacheReviewerName(runtimeConfig, value) {
  cacheValue(runtimeConfig.cacheReviewerNameKey, value);
}

export function getCachedReviewerEmail(runtimeConfig) {
  return localStorage.getItem(runtimeConfig.cacheReviewerEmailKey) || "";
}

export function cacheReviewerEmail(runtimeConfig, value) {
  cacheValue(runtimeConfig.cacheReviewerEmailKey, value);
}

function cacheValue(key, value) {
  const trimmed = value.trim();
  if (trimmed) {
    localStorage.setItem(key, trimmed);
  }
}

export function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }
  return groups;
}
