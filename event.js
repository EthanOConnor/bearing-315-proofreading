const eventPageNumberFormatter = new Intl.NumberFormat("en-US");
const eventPageDecimalFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const eventPageDateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const eventNavCache = {
  promise: null,
  events: null,
};

function formatEventPageNumber(value) {
  return eventPageNumberFormatter.format(value ?? 0);
}

function formatEventPageDate(value) {
  if (!value) return "n/a";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : eventPageDateFormatter.format(date);
}

function formatDistanceKm(value) {
  return value == null ? null : `${eventPageDecimalFormatter.format(value)} km`;
}

function formatClimbMeters(value) {
  return value == null ? null : `${formatEventPageNumber(value)} m climb`;
}

function formatEventStatusLabel(value) {
  switch (value) {
    case "canceled":
      return "Cancelled";
    case "rescheduled":
      return "Rescheduled";
    case "postponed":
      return "Postponed";
    case "delayed":
      return "Delayed";
    default:
      return null;
  }
}

function formatEventResultsValue(detail) {
  const statusLabel = formatEventStatusLabel(detail?.event_status);
  if (statusLabel && Number(detail?.result_count || 0) === 0) {
    return statusLabel;
  }
  return formatEventPageNumber(detail?.result_count);
}

function getEntityUrl(type, id) {
  return `./entity.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
}

function getEventUrl(eventId, { fromType = "", fromId = "" } = {}) {
  const params = new URLSearchParams({ id: eventId });
  if (fromType) params.set("fromType", fromType);
  if (fromId) params.set("fromId", fromId);
  return `./event.html?${params.toString()}`;
}

function getDataCandidates(relativePath) {
  const candidates = new Set([`./data/${relativePath}`]);
  const { origin, pathname, protocol } = window.location;

  if (protocol !== "file:") {
    const basePath = pathname.endsWith("/")
      ? pathname
      : pathname.includes(".")
        ? pathname.replace(/[^/]+$/, "")
        : `${pathname}/`;

    candidates.add(`${origin}${basePath}data/${relativePath}`);
  }

  return [...candidates];
}

function getSnapshotCandidates() {
  return getDataCandidates("db_public_snapshot.json");
}

function getEventDetailCandidates(eventId) {
  return getDataCandidates(`event-results/${eventId}.json`);
}

function normalizeText(value) {
  return (value || "").trim().toLowerCase();
}

function isSammWiolWinterEvent(eventRow) {
  const organizer = normalizeText(eventRow?.organizing_club_name);
  const name = normalizeText(eventRow?.event_name);
  const samm = organizer.includes("sammamish") || organizer.includes("samm ");
  return (
    (organizer === "samm" || samm)
    && (/\bwiol\b/.test(name) || /\bwinter\s+o['’]?\s*(series)?/.test(name) || /\bo['’]\s*series\b/.test(name))
  );
}

function isCocCompetitionLike(eventRow) {
  if ((eventRow?.coverage_section || "non_coc") === "coc_competition") return true;
  return isSammWiolWinterEvent(eventRow);
}

function getCompetitionEventsFromSnapshot(snapshot = {}) {
  const rows = [];
  const years = Array.isArray(snapshot?.coverage_by_year) ? snapshot.coverage_by_year : [];

  years.forEach((yearRow = {}) => {
    (yearRow.events || []).forEach((eventRow) => {
      if (eventRow?.event_id && isCocCompetitionLike(eventRow)) {
        rows.push(eventRow);
      }
    });
  });

  return rows;
}

function parseCompetitionEventDate(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function sortCompetitionEventsChronologically(events = []) {
  return events.slice().sort((a, b) => {
    const dateDelta = parseCompetitionEventDate(a.event_date) - parseCompetitionEventDate(b.event_date);
    if (dateDelta !== 0) return dateDelta;
    return (normalizeText(a.event_name) || "").localeCompare(normalizeText(b.event_name));
  });
}

function getSnapshotCompetitionEvents() {
  if (eventNavCache.events) {
    return Promise.resolve(eventNavCache.events);
  }

  if (eventNavCache.promise) {
    return eventNavCache.promise;
  }

  eventNavCache.promise = (async () => {
    const attempts = [];

    for (const candidate of getSnapshotCandidates()) {
      try {
        const response = await fetch(candidate, { cache: "no-store" });
        if (!response.ok) {
          attempts.push(`${candidate} -> HTTP ${response.status}`);
          continue;
        }

        const snapshot = await response.json();
        const events = sortCompetitionEventsChronologically(getCompetitionEventsFromSnapshot(snapshot));
        eventNavCache.events = events;
        return events;
      } catch (error) {
        attempts.push(`${candidate} -> ${error.message}`);
      }
    }

    throw new Error(attempts.join(" | "));
  })().catch((error) => {
    eventNavCache.promise = null;
    throw error;
  });

  return eventNavCache.promise;
}

function createCompetitionNavLink(eventRow, label, shortLabel, params) {
  if (!eventRow?.event_id) return null;
  const link = document.createElement("a");
  link.className = "ghost-button ghost-link-button event-footer-button";
  link.href = getEventUrl(eventRow.event_id, {
    fromType: params.get("fromType") || "",
    fromId: params.get("fromId") || "",
  });

  const fullLabel = `${label}: ${formatEventPageDate(eventRow.event_date)} · ${eventRow.event_name || "Untitled event"}`;
  const desktopLabel = document.createElement("span");
  desktopLabel.className = "event-nav-label-desktop";
  desktopLabel.textContent = fullLabel;

  const mobileLabel = document.createElement("span");
  mobileLabel.className = "event-nav-label-mobile";
  mobileLabel.textContent = shortLabel;

  link.replaceChildren(desktopLabel, mobileLabel);
  link.setAttribute("aria-label", fullLabel);

  return link;
}

function renderCompetitionNavigation(params, events = []) {
  const container = document.getElementById("event-footer-links");
  if (!container) {
    return;
  }

  const eventId = params.get("id");
  const currentIndex = eventId ? events.findIndex((eventRow) => eventRow.event_id === eventId) : -1;
  const hasOrderedEvents = currentIndex >= 0;
  const previous = hasOrderedEvents ? (events[currentIndex - 1] || null) : null;
  const next = hasOrderedEvents ? (events[currentIndex + 1] || null) : null;

  const links = [];
  if (next) {
    const nextLink = createCompetitionNavLink(next, "Next Meet", "Next", params);
    if (nextLink) links.push(nextLink);
  }

  const backToSnapshot = document.createElement("a");
  backToSnapshot.className = "ghost-button ghost-link-button event-footer-button event-footer-home-button";
  backToSnapshot.href = "./index.html";
  const homeDesktop = document.createElement("span");
  homeDesktop.className = "event-nav-label-desktop";
  homeDesktop.textContent = "Back To Snapshot";
  const homeMobile = document.createElement("span");
  homeMobile.className = "event-nav-label-mobile";
  homeMobile.textContent = "Home";
  backToSnapshot.replaceChildren(homeDesktop, homeMobile);
  backToSnapshot.setAttribute("aria-label", "Back To Snapshot");
  links.push(backToSnapshot);

  if (previous) {
    const previousLink = createCompetitionNavLink(previous, "Previous Meet", "Prev", params);
    if (previousLink) links.push(previousLink);
  }

  container.replaceChildren(...links);
  container.hidden = false;
}

async function fetchEventDetail(eventId) {
  const attempts = [];

  for (const candidate of getEventDetailCandidates(eventId)) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) {
        attempts.push(`${candidate} -> HTTP ${response.status}`);
        continue;
      }
      return await response.json();
    } catch (error) {
      attempts.push(`${candidate} -> ${error.message}`);
    }
  }

  throw new Error(attempts.join(" | "));
}

function createStatusChip(label, extraClass = "") {
  const chip = document.createElement("span");
  chip.className = `status-chip${extraClass ? ` ${extraClass}` : ""}`;
  chip.textContent = label;
  return chip;
}

function createDetailFact(label, value) {
  const card = document.createElement("article");
  card.className = "detail-fact";

  const labelNode = document.createElement("span");
  labelNode.className = "detail-fact-label";
  labelNode.textContent = label;

  const valueNode = document.createElement("span");
  valueNode.className = "detail-fact-value";
  if (value instanceof Node) {
    valueNode.append(value);
  } else {
    valueNode.textContent = value;
  }

  card.append(labelNode, valueNode);
  return card;
}

function createEntityLink(type, id, label, className = "entity-link") {
  if (!id) {
    const span = document.createElement("span");
    span.textContent = label || "—";
    return span;
  }

  const link = document.createElement("a");
  link.className = className;
  link.href = getEntityUrl(type, id);
  link.textContent = label || "—";
  return link;
}

function formatCodeLabel(value) {
  if (!value) return "—";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function setTableHead(target, labels) {
  const row = document.createElement("tr");
  labels.forEach((labelText) => {
    const th = document.createElement("th");
    th.textContent = labelText;
    row.append(th);
  });
  target.replaceChildren(row);
}

function appendTextLine(target, text, className = "") {
  const line = document.createElement("div");
  if (className) line.className = className;
  line.textContent = text;
  target.append(line);
}

function createCompetitorNode(resultRow) {
  if (resultRow.individual_id) {
    return createEntityLink("person", resultRow.individual_id, resultRow.competitor_name || "(unnamed competitor)");
  }

  const span = document.createElement("span");
  span.textContent = resultRow.competitor_name || "(unnamed competitor)";
  return span;
}

function appendDelimitedNodes(target, nodes, delimiter = ", ") {
  nodes.forEach((node, index) => {
    if (index > 0) target.append(document.createTextNode(delimiter));
    target.append(node);
  });
}

function createAffiliationNodes(resultRow) {
  const affiliations = Array.isArray(resultRow.affiliations) ? resultRow.affiliations : [];
  if (affiliations.length) {
    return affiliations.map((affiliation) => {
      if (affiliation?.organization_id) {
        return createEntityLink("organization", affiliation.organization_id, affiliation.label || "—");
      }
      const span = document.createElement("span");
      span.textContent = affiliation?.label || "—";
      return span;
    });
  }

  return (resultRow.affiliation_labels || []).map((label) => {
    const span = document.createElement("span");
    span.textContent = label;
    return span;
  });
}

function hasCategoryRankedResults(results = []) {
  return results.some((resultRow) => resultRow.category_rank != null);
}

function groupResultsByCategory(results = []) {
  const buckets = [];
  const bucketMap = new Map();
  results.forEach((resultRow) => {
    const label = resultRow.category_name || "Unspecified";
    if (!bucketMap.has(label)) {
      const bucket = { label, rows: [] };
      bucketMap.set(label, bucket);
      buckets.push(bucket);
    }
    bucketMap.get(label).rows.push(resultRow);
  });
  return buckets;
}

function buildResultsTable(resultRows, { showOverallRank = false, showCategoryRank = false, showDivision = true } = {}) {
  const table = document.createElement("table");
  table.className = "event-results-table";

  const labels = [];
  if (showOverallRank) {
    labels.push("Overall");
  } else {
    labels.push("Place");
  }
  if (showCategoryRank) labels.push("Category");
  labels.push("Competitor");
  if (showDivision) labels.push("Division");
  labels.push("Outcome", "Affiliation");

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  labels.forEach((labelText) => {
    const th = document.createElement("th");
    th.textContent = labelText;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  resultRows.forEach((resultRow) => {
    const tr = document.createElement("tr");

    const overallRank = resultRow.overall_rank ?? resultRow.course_rank;
    const place = document.createElement("td");
    place.className = "is-numeric";
    place.textContent = overallRank == null ? "—" : formatEventPageNumber(overallRank);
    tr.append(place);

    if (showCategoryRank) {
      const categoryRank = document.createElement("td");
      categoryRank.className = "is-numeric";
      categoryRank.textContent =
        resultRow.category_rank == null ? "—" : formatEventPageNumber(resultRow.category_rank);
      tr.append(categoryRank);
    }

    const competitor = document.createElement("td");
    const competitorName = document.createElement("div");
    competitorName.append(createCompetitorNode(resultRow));
    competitor.append(competitorName);
    if (resultRow.competitive === false) {
      competitor.append(createStatusChip("Non-competitive", "subtle"));
    }
    if (resultRow.additional_course) {
      competitor.append(createStatusChip("Additional course", "subtle"));
    }
    if (resultRow.result_notes) {
      const notes = document.createElement("span");
      notes.className = "event-result-notes";
      notes.textContent = resultRow.result_notes;
      competitor.append(notes);
    }
    tr.append(competitor);

    if (showDivision) {
      const division = document.createElement("td");
      division.textContent = resultRow.category_name || "—";
      tr.append(division);
    }

    const outcome = document.createElement("td");
    outcome.className = "is-numeric";
    const outcomeValue = document.createElement("div");
    outcomeValue.textContent = resultRow.outcome_text || "—";
    outcome.append(outcomeValue);
    if (resultRow.metric_summary && resultRow.metric_summary !== resultRow.outcome_text) {
      const metricSummary = document.createElement("div");
      metricSummary.className = "event-result-notes";
      metricSummary.textContent = resultRow.metric_summary;
      outcome.append(metricSummary);
    }
    tr.append(outcome);

    const affiliation = document.createElement("td");
    const affiliationNodes = createAffiliationNodes(resultRow);
    if (affiliationNodes.length) {
      appendDelimitedNodes(affiliation, affiliationNodes);
    } else {
      affiliation.textContent = "—";
    }
    tr.append(affiliation);

    tbody.append(tr);
  });

  table.append(thead, tbody);
  return table;
}

function createCourseCard(course) {
  const article = document.createElement("article");
  article.className = "event-course";

  const head = document.createElement("div");
  head.className = "event-course-head";

  const courseTitle = document.createElement("h3");
  courseTitle.textContent = course.course_name || "Unnamed course";

  const stats = document.createElement("div");
  stats.className = "event-course-stats";
  stats.append(createStatusChip(`${formatEventPageNumber(course.result_count)} results`));

  const distance = formatDistanceKm(course.distance_km);
  if (distance) stats.append(createStatusChip(distance, "subtle"));
  if (course.control_count != null) {
    stats.append(createStatusChip(`${formatEventPageNumber(course.control_count)} controls`, "subtle"));
  }
  const climb = formatClimbMeters(course.course_climb_m);
  if (climb) stats.append(createStatusChip(climb, "subtle"));

  head.append(courseTitle, stats);
  article.append(head);

  if (!course.results?.length) {
    const empty = document.createElement("p");
    empty.className = "event-course-empty";
    empty.textContent = "No result rows exported for this course.";
    article.append(empty);
    return article;
  }

  const categoryRanked = hasCategoryRankedResults(course.results);
  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  tableWrap.append(
    buildResultsTable(course.results, {
      showOverallRank: categoryRanked,
      showCategoryRank: categoryRanked,
      showDivision: true,
    })
  );
  article.append(tableWrap);

  if (categoryRanked) {
    const groupedWrap = document.createElement("div");

    const groupedTitle = document.createElement("h4");
    groupedTitle.textContent = "By Category";
    groupedWrap.append(groupedTitle);

    groupResultsByCategory(course.results).forEach((bucket) => {
      const bucketTitle = document.createElement("h5");
      bucketTitle.textContent = bucket.label;
      groupedWrap.append(bucketTitle);

      const bucketTableWrap = document.createElement("div");
      bucketTableWrap.className = "table-wrap";
      bucketTableWrap.append(
        buildResultsTable(bucket.rows, {
          showOverallRank: true,
          showCategoryRank: true,
          showDivision: false,
        })
      );
      groupedWrap.append(bucketTableWrap);
    });

    article.append(groupedWrap);
  }

  return article;
}

function renderMetadataPanel(detail) {
  const panel = document.getElementById("event-metadata-panel");
  const notesWrap = document.getElementById("event-detail-notes-wrap");
  const notesTarget = document.getElementById("event-detail-notes");
  const linksWrap = document.getElementById("event-detail-links-wrap");
  const linksTarget = document.getElementById("event-detail-links");
  const rolesWrap = document.getElementById("event-detail-roles-wrap");
  const rolesHead = document.getElementById("event-detail-roles-head");
  const rolesBody = document.getElementById("event-detail-roles-body");

  const noteBlocks = [detail.event_notes, detail.event_comments].filter(Boolean);
  if (noteBlocks.length) {
    notesTarget.replaceChildren();
    noteBlocks.forEach((block) => {
      const article = document.createElement("article");
      article.className = "detail-note";
      block.split(/\n{2,}/).forEach((paragraph) => {
        const cleaned = paragraph.trim();
        if (cleaned) appendTextLine(article, cleaned);
      });
      notesTarget.append(article);
    });
    notesWrap.hidden = false;
  } else {
    notesTarget.replaceChildren();
    notesWrap.hidden = true;
  }

  const externalLinks = detail.external_links || [];
  if (externalLinks.length) {
    const linkNodes = externalLinks.map((linkRow) => {
      const anchor = document.createElement("a");
      anchor.className = "pill pill-link";
      anchor.href = linkRow.link_url || "#";
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = formatCodeLabel(linkRow.link_type || "link");
      return anchor;
    });
    linksTarget.replaceChildren(...linkNodes);
    linksWrap.hidden = false;
  } else {
    linksTarget.replaceChildren();
    linksWrap.hidden = true;
  }

  const volunteerRoles = detail.volunteer_roles || [];
  if (volunteerRoles.length) {
    setTableHead(rolesHead, ["Role", "Volunteer", "Hours", "Points", "Sources"]);
    const rows = volunteerRoles.map((roleRow) => {
      const tr = document.createElement("tr");

      const role = document.createElement("td");
      role.textContent = roleRow.role_name || "Unspecified role";

      const volunteer = document.createElement("td");
      volunteer.append(
        createEntityLink("person", roleRow.individual_id, roleRow.individual_name || "(unknown volunteer)")
      );

      const hours = document.createElement("td");
      hours.textContent = roleRow.volunteer_hours == null ? "—" : formatEventPageNumber(roleRow.volunteer_hours);

      const points = document.createElement("td");
      points.textContent = roleRow.volunteer_points == null ? "—" : formatEventPageNumber(roleRow.volunteer_points);

      const sources = document.createElement("td");
      sources.textContent = roleRow.citation_count
        ? `${formatEventPageNumber(roleRow.citation_count)} citation(s)`
        : "—";

      tr.append(role, volunteer, hours, points, sources);
      return tr;
    });
    rolesBody.replaceChildren(...rows);
    rolesWrap.hidden = false;
  } else {
    rolesBody.replaceChildren();
    rolesWrap.hidden = true;
  }

  panel.hidden = noteBlocks.length === 0 && externalLinks.length === 0 && volunteerRoles.length === 0;
}

function renderError(message) {
  document.title = "Event Unavailable · Project '77";
  document.getElementById("event-title").textContent = "Event Unavailable";
  document.getElementById("event-subtitle").textContent = message;
  document.getElementById("event-summary-panel").hidden = true;
  document.getElementById("event-metadata-panel").hidden = true;
  document.getElementById("event-results-panel").hidden = true;
}

function buildEventSubtitle(detail) {
  const parts = [
    formatEventPageDate(detail.event_date),
    detail.event_kind || "unknown kind",
    detail.venue_name || "Unknown venue",
  ];

  const statusLabel = formatEventStatusLabel(detail.event_status);
  if (statusLabel) {
    parts.push(`Status: ${statusLabel}`);
  }

  if (Number(detail.result_count || 0) > 0) {
    parts.push(`Results from: ${detail.result_source_brief || "source not yet linked"}`);
  } else {
    parts.push(statusLabel ? "No result rows expected in the current snapshot" : "No result rows captured yet");
  }

  return parts.join(" · ");
}

function buildEventResultsCopy(detail) {
  if (Number(detail.result_count || 0) > 0) {
    return "Course-by-course results exported for this event.";
  }

  const statusLabel = formatEventStatusLabel(detail.event_status);
  if (statusLabel === "Cancelled") {
    return "This event was cancelled. No result rows are expected in the current snapshot.";
  }
  if (statusLabel) {
    return `This event is marked ${statusLabel.toLowerCase()} in the source archive, and no result rows are exported in the current snapshot.`;
  }

  return "This event is in inventory, but no result rows are captured in the current snapshot.";
}

async function main() {
  if (window.location.protocol === "file:") {
    renderError("This static viewer needs HTTP(S). Open it from GitHub Pages or a local web server.");
    return;
  }

  window.Project77Search?.setup();

  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("id");

  if (!eventId) {
    renderError("Missing event id.");
    return;
  }

  try {
    const [detail, competitionEvents] = await Promise.all([
      fetchEventDetail(eventId),
      getSnapshotCompetitionEvents().catch(() => []),
    ]);

    renderCompetitionNavigation(params, competitionEvents);

    document.title = `${detail.event_name || "Event"} · Project '77`;
    document.getElementById("event-title").textContent = detail.event_name || "Untitled event";
    document.getElementById("event-subtitle").textContent = buildEventSubtitle(detail);
    document.getElementById("event-results-copy").textContent = buildEventResultsCopy(detail);

    const facts = [
    createDetailFact("Date", formatEventPageDate(detail.event_date)),
    createDetailFact("Venue", createEntityLink("venue", detail.venue_id, detail.venue_name || "Unknown venue")),
    createDetailFact(
      "Club",
      createEntityLink("organization", detail.organizing_club_id, detail.organizing_club_name || "Unknown club")
    ),
      ...(detail.event_status ? [createDetailFact("Status", formatEventStatusLabel(detail.event_status))] : []),
      createDetailFact("Results", formatEventResultsValue(detail)),
      createDetailFact("Courses", formatEventPageNumber(detail.course_count)),
      createDetailFact("Citations", formatEventPageNumber(detail.citation_count)),
    ];
    document.getElementById("event-summary-facts").replaceChildren(...facts);
    renderMetadataPanel(detail);

    const courseCards = (detail.courses || []).map(createCourseCard);
    const courseList = document.getElementById("event-course-list");
    const empty = document.getElementById("event-results-empty");
    if (courseCards.length) {
      courseList.replaceChildren(...courseCards);
      empty.hidden = true;
    } else {
      courseList.replaceChildren();
      empty.hidden = false;
    }
  } catch (error) {
    console.error(error);
    renderError(error.message);
  }
}

main();
