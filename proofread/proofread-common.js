const DEFAULT_RUNTIME_CONFIG = {
  submissionMode: "local",
  apiBaseUrl: "",
  apiKey: "",
  googleClientId: "",
  googleHostedDomain: "",
  projectLabel: "Project77 Proofread",
  storageKeyPrefix: "project77-proofread",
  cacheEmailKey: "project77-proofread-email",
  cacheReviewerNameKey: "project77-proofread-reviewer-name",
  cacheReviewerEmailKey: "project77-proofread-reviewer-email",
  cacheSessionKey: "",
  showReviewLinks: true,
  githubRepoOwner: "",
  githubRepoName: "",
  githubIssueLabel: "proofread-report",
  githubProblemLabel: "report-problem",
  githubCorrectLabel: "mark-correct",
};

let googleIdentityScriptPromise;

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

function sessionStorageKey(runtimeConfig) {
  return runtimeConfig.cacheSessionKey || `${runtimeConfig.storageKeyPrefix}:session`;
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

function createApiBaseUrl(runtimeConfig) {
  return String(runtimeConfig.apiBaseUrl || "").replace(/\/$/, "");
}

function loadStoredSession(runtimeConfig) {
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionStorageKey(runtimeConfig)) || "null");
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (!parsed.sessionToken || !parsed.user) {
      return null;
    }
    return {
      sessionToken: String(parsed.sessionToken),
      expiresAt: String(parsed.expiresAt || ""),
      user: parsed.user,
    };
  } catch (error) {
    console.warn("Could not parse cached proofread session.", error);
    return null;
  }
}

function saveStoredSession(runtimeConfig, session) {
  if (!session?.sessionToken || !session?.user) {
    localStorage.removeItem(sessionStorageKey(runtimeConfig));
    return;
  }
  localStorage.setItem(sessionStorageKey(runtimeConfig), JSON.stringify(session));
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

function cacheValue(key, value) {
  const trimmed = String(value || "").trim();
  if (trimmed) {
    localStorage.setItem(key, trimmed);
  }
}

async function readJsonResponse(response, fallbackMessage) {
  if (!response.ok) {
    const message = (await response.text()).trim();
    const error = new Error(message || fallbackMessage || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function ensureGoogleIdentityScript() {
  if (window.google?.accounts?.id) {
    return window.google;
  }
  if (!googleIdentityScriptPromise) {
    googleIdentityScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.google);
      script.onerror = () => reject(new Error("Could not load Google sign-in."));
      document.head.appendChild(script);
    });
  }
  return googleIdentityScriptPromise;
}

export function createAuthController(runtimeConfig) {
  const listeners = new Set();
  const baseUrl = createApiBaseUrl(runtimeConfig);
  let session = loadStoredSession(runtimeConfig);
  let initPromise;

  function notify() {
    for (const listener of listeners) {
      try {
        listener(controller.session());
      } catch (error) {
        console.error(error);
      }
    }
  }

  function setSession(nextSession) {
    session = nextSession;
    saveStoredSession(runtimeConfig, session);
    notify();
  }

  async function sessionRequest(path, options = {}) {
    if (!baseUrl) {
      throw new Error("API mode is not configured.");
    }
    const headers = controller.authHeaders({
      accept: "application/json",
      ...(options.headers || {}),
    });
    const response = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      ...options,
      headers,
    });
    return readJsonResponse(response, `${path} -> HTTP ${response.status}`);
  }

  const controller = {
    baseUrl,
    isEnabled() {
      return runtimeConfig.submissionMode === "api" && Boolean(baseUrl);
    },
    canLogin() {
      return this.isEnabled() && Boolean(runtimeConfig.googleClientId);
    },
    isLoggedIn() {
      return Boolean(session?.sessionToken && session?.user);
    },
    isReviewer() {
      return ["reviewer", "admin"].includes(session?.user?.role || "");
    },
    user() {
      return session?.user || null;
    },
    session() {
      return session ? { ...session } : null;
    },
    authHeaders(headers = {}) {
      if (!session?.sessionToken) {
        return headers;
      }
      return {
        ...headers,
        authorization: `Bearer ${session.sessionToken}`,
      };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async init() {
      if (initPromise) {
        return initPromise;
      }
      initPromise = (async () => {
        if (!controller.isEnabled()) {
          setSession(null);
          return null;
        }
        if (!session?.sessionToken) {
          notify();
          return null;
        }
        try {
          const payload = await sessionRequest("/me");
          setSession({
            sessionToken: session.sessionToken,
            expiresAt: payload.session_expires_at || session.expiresAt || "",
            user: payload.user,
          });
          return payload.user;
        } catch (error) {
          if (error.status !== 401) {
            console.error(error);
          }
          setSession(null);
          return null;
        }
      })();
      return initPromise;
    },
    async loginWithGoogleCredential(credential) {
      if (!controller.canLogin()) {
        throw new Error("Google sign-in is not configured.");
      }
      const response = await fetch(`${baseUrl}/auth/google`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ credential }),
      });
      const payload = await readJsonResponse(response, "Could not complete Google sign-in.");
      setSession({
        sessionToken: payload.session_token,
        expiresAt: payload.session_expires_at || "",
        user: payload.user,
      });
      return payload.user;
    },
    async logout() {
      if (controller.isEnabled() && session?.sessionToken) {
        try {
          await fetch(`${baseUrl}/auth/logout`, {
            method: "POST",
            headers: controller.authHeaders({ accept: "application/json" }),
          });
        } catch (error) {
          console.warn("Could not notify proofread API about logout.", error);
        }
      }
      setSession(null);
      try {
        window.google?.accounts?.id?.disableAutoSelect?.();
      } catch (error) {
        console.warn("Could not clear Google auto-select state.", error);
      }
    },
    async renderGoogleButton(container, { compact = false, onError } = {}) {
      if (!container) {
        return;
      }
      container.replaceChildren();
      if (!controller.canLogin()) {
        return;
      }
      const google = await ensureGoogleIdentityScript();
      google.accounts.id.initialize({
        client_id: runtimeConfig.googleClientId,
        callback: async (response) => {
          try {
            await controller.loginWithGoogleCredential(response.credential);
          } catch (error) {
            console.error(error);
            if (typeof onError === "function") {
              onError(error);
            }
          }
        },
        cancel_on_tap_outside: true,
      });
      google.accounts.id.renderButton(container, {
        theme: "outline",
        size: compact ? "medium" : "large",
        text: "signin_with",
        shape: "pill",
        logo_alignment: "left",
        width: compact ? 180 : 228,
      });
    },
  };

  return controller;
}

export async function renderAuthControls(container, authController, {
  compact = false,
  homeHref = "./index.html",
  showHomeLink = false,
  onError,
} = {}) {
  if (!container) {
    return;
  }

  container.replaceChildren();
  container.className = compact ? "auth-controls auth-controls-compact" : "auth-controls";

  if (authController.isLoggedIn()) {
    const wrapper = document.createElement("div");
    wrapper.className = "auth-user-shell";

    const identity = document.createElement("div");
    identity.className = "auth-user-card";

    if (authController.user()?.avatar_url) {
      const avatar = document.createElement("img");
      avatar.className = "auth-avatar";
      avatar.src = authController.user().avatar_url;
      avatar.alt = "";
      avatar.loading = "lazy";
      identity.appendChild(avatar);
    }

    const text = document.createElement("div");
    text.className = "auth-user-text";
    const name = document.createElement("strong");
    name.textContent = authController.user().display_name;
    const meta = document.createElement("span");
    meta.textContent = authController.user().email;
    text.append(name, meta);
    identity.appendChild(text);
    wrapper.appendChild(identity);

    const actions = document.createElement("div");
    actions.className = "auth-user-actions";
    if (showHomeLink) {
      const homeLink = document.createElement("a");
      homeLink.className = "ghost-button";
      homeLink.href = homeHref;
      homeLink.textContent = "Dashboard";
      actions.appendChild(homeLink);
    }
    const logoutButton = document.createElement("button");
    logoutButton.type = "button";
    logoutButton.className = "ghost-button";
    logoutButton.textContent = "Sign Out";
    logoutButton.addEventListener("click", () => {
      authController.logout().catch((error) => {
        console.error(error);
        if (typeof onError === "function") {
          onError(error);
        }
      });
    });
    actions.appendChild(logoutButton);
    wrapper.appendChild(actions);
    container.appendChild(wrapper);
    return;
  }

  if (!authController.canLogin()) {
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "auth-signin-shell";

  const label = document.createElement("p");
  label.className = "auth-signin-label";
  label.textContent = compact
    ? "Sign in to attach your identity to reports."
    : "Sign in with Google to attach your identity to reports and save a volunteer dashboard.";
  wrapper.appendChild(label);

  const buttonSlot = document.createElement("div");
  buttonSlot.className = "auth-google-slot";
  wrapper.appendChild(buttonSlot);
  container.appendChild(wrapper);

  try {
    await authController.renderGoogleButton(buttonSlot, { compact, onError });
  } catch (error) {
    console.error(error);
    if (typeof onError === "function") {
      onError(error);
    }
  }
}

function localStore(runtimeConfig) {
  return {
    modeLabel: "Local demo mode",
    supportsReviewUi: true,
    supportsPrivateContact: true,
    supportsAuth: false,
    submitButtonLabel: "Submit",
    canReview() {
      return true;
    },
    async loadPublicStats() {
      return {
        registered_users: 0,
        registered_reviewers: 0,
      };
    },
    async loadUserSummary() {
      return null;
    },
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
    report.end_block_id || report.block_id,
    report.start_offset,
    report.end_offset,
    report.selected_text,
    report.report_body,
  ].join("::");
}

export function reportStartBlockId(report) {
  return report?.block_id || "";
}

export function reportEndBlockId(report) {
  return report?.end_block_id || report?.block_id || "";
}

export function expandReportBlockRanges(report, blockIndex) {
  const startBlockId = reportStartBlockId(report);
  const endBlockId = reportEndBlockId(report);
  if (!startBlockId || !endBlockId || !Array.isArray(blockIndex) || blockIndex.length === 0) {
    return [];
  }

  const positions = new Map(blockIndex.map((block, index) => [block.block_id, index]));
  let startIndex = positions.get(startBlockId);
  let endIndex = positions.get(endBlockId);
  if (startIndex == null || endIndex == null) {
    return [];
  }

  let startOffset = Number(report.start_offset);
  let endOffset = Number(report.end_offset);
  if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) {
    return [];
  }

  if (startIndex > endIndex) {
    [startIndex, endIndex] = [endIndex, startIndex];
    [startOffset, endOffset] = [endOffset, startOffset];
  }

  const ranges = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const block = blockIndex[index];
    const blockLength = Number(block.text_length || 0);
    let rangeStart = index === startIndex ? startOffset : 0;
    let rangeEnd = index === endIndex ? endOffset : blockLength;

    rangeStart = Math.max(0, Math.min(blockLength, rangeStart));
    rangeEnd = Math.max(0, Math.min(blockLength, rangeEnd));
    if (index === startIndex && index === endIndex && rangeEnd <= rangeStart) {
      return [];
    }
    if (rangeEnd <= rangeStart) {
      continue;
    }

    ranges.push({
      block_id: block.block_id,
      start_offset: rangeStart,
      end_offset: rangeEnd,
    });
  }

  return ranges;
}

export function reportTouchesBlock(report, blockId, blockIndex) {
  return expandReportBlockRanges(report, blockIndex).some((range) => range.block_id === blockId);
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
        end_block_id: metadata.end_block_id || metadata.block_id,
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
    end_block_id: payload.end_block_id || payload.block_id,
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
    "<!-- PROOFREAD_REPORT_V1",
    JSON.stringify(metadata, null, 2),
    "-->",
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
    supportsAuth: false,
    submitButtonLabel: "Continue to GitHub",
    canReview() {
      return false;
    },
    async loadPublicStats() {
      return {
        registered_users: 0,
        registered_reviewers: 0,
      };
    },
    async loadUserSummary() {
      return null;
    },
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

function groupReportsByIssue(reports, issueIds = []) {
  const grouped = {};
  for (const issueId of issueIds) {
    grouped[issueId] = [];
  }
  for (const report of reports || []) {
    if (!grouped[report.issue_id]) {
      grouped[report.issue_id] = [];
    }
    grouped[report.issue_id].push(report);
  }
  return grouped;
}

function apiStore(runtimeConfig, authController) {
  const baseUrl = createApiBaseUrl(runtimeConfig);

  async function request(path, { method = "GET", body, headers = {} } = {}) {
    const finalHeaders = {
      accept: "application/json",
      ...headers,
    };
    if (runtimeConfig.apiKey) {
      finalHeaders["x-api-key"] = runtimeConfig.apiKey;
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      cache: "no-store",
      headers: authController ? authController.authHeaders(finalHeaders) : finalHeaders,
      body: body == null ? undefined : JSON.stringify(body),
    });
    return readJsonResponse(response, `${path} -> HTTP ${response.status}`);
  }

  return {
    modeLabel: "API mode",
    supportsReviewUi: true,
    supportsPrivateContact: true,
    supportsAuth: true,
    submitButtonLabel: "Submit",
    canReview() {
      return Boolean(runtimeConfig.apiKey) || Boolean(authController?.isReviewer?.());
    },
    async loadPublicStats() {
      const payload = await request("/stats/public");
      return payload.stats || {
        registered_users: 0,
        registered_reviewers: 0,
      };
    },
    async loadUserSummary() {
      if (!authController?.isLoggedIn?.()) {
        return null;
      }
      const payload = await request("/me/summary");
      return payload.summary || null;
    },
    async listIssueReports(issueId) {
      const payload = await request(`/issues/${encodeURIComponent(issueId)}/reports`);
      return payload.reports || [];
    },
    async listIssueReviews(issueId) {
      const payload = await request(`/issues/${encodeURIComponent(issueId)}/reviews`);
      return payload.reviews || [];
    },
    async listAllIssueReports(issueIds) {
      const query = new URLSearchParams();
      for (const issueId of issueIds) {
        query.append("issue_id", issueId);
      }
      const payload = await request(`/reports?${query.toString()}`);
      return groupReportsByIssue(payload.reports || [], issueIds);
    },
    async submitIssueReport(issueId, payload) {
      const created = await request(`/issues/${encodeURIComponent(issueId)}/reports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: payload,
      });
      return created.report;
    },
    async submitReportReview(reportId, payload) {
      const created = await request(`/reports/${encodeURIComponent(reportId)}/reviews`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: payload,
      });
      return created.review;
    },
  };
}

export function createReportStore(runtimeConfig, authController = null) {
  if (runtimeConfig.submissionMode === "api" && runtimeConfig.apiBaseUrl) {
    return apiStore(runtimeConfig, authController);
  }
  if (runtimeConfig.submissionMode === "github_issue" && runtimeConfig.githubRepoOwner && runtimeConfig.githubRepoName) {
    return githubIssueStore(runtimeConfig);
  }
  return localStore(runtimeConfig);
}

function proofreaderIdentity(report) {
  const explicitIdentity = (report.reporter_user_id || report.reporter_name || report.reporter_email || "").trim().toLowerCase();
  if (explicitIdentity) {
    return explicitIdentity;
  }
  return report?.report_id ? `anonymous:${report.report_id}` : "";
}

export function summarizeReviewedCoverage(issue, reports) {
  const totalLength = Number(issue.transcript_text_length || 0);
  if (!totalLength || !Array.isArray(reports) || reports.length === 0) {
    return { oneRatio: 0, twoRatio: 0, oneCharacters: 0, twoCharacters: 0, totalCharacters: totalLength };
  }

  let oneCoverage = 0;
  let twoCoverage = 0;

  const segmentGroups = groupBy(
    reports.filter((report) => report.report_kind === "reviewed_correct"),
    (report) => `${reportStartBlockId(report)}::${reportEndBlockId(report)}`
  );

  for (const reportGroup of segmentGroups.values()) {
    const normalized = reportGroup
      .map((report) => {
        const startBlockId = reportStartBlockId(report);
        const endBlockId = reportEndBlockId(report);
        const identity = proofreaderIdentity(report);
        if (!identity) {
          return null;
        }
        if (startBlockId === endBlockId) {
          const start = Number(report.start_offset);
          const end = Number(report.end_offset);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            return null;
          }
          return { start, end, identity };
        }
        const length = (report.selected_text || "").length;
        if (!length) {
          return null;
        }
        return { start: 0, end: length, identity };
      })
      .filter(Boolean);

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
    oneCharacters: oneCoverage,
    twoCharacters: twoCoverage,
    totalCharacters: totalLength,
  };
}

export function formatInteger(value) {
  return Number(value || 0).toLocaleString();
}

export function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
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
