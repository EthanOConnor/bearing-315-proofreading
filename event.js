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

function getEventDetailCandidates(eventId) {
  return getDataCandidates(`event-results/${eventId}.json`);
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

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";

  const table = document.createElement("table");
  table.className = "event-results-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Place", "Competitor", "Category", "Outcome", "Affiliation"].forEach((labelText) => {
    const th = document.createElement("th");
    th.textContent = labelText;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  course.results.forEach((resultRow) => {
    const tr = document.createElement("tr");

    const place = document.createElement("td");
    place.className = "is-numeric";
    place.textContent = resultRow.course_rank == null ? "—" : formatEventPageNumber(resultRow.course_rank);

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

    const category = document.createElement("td");
    category.textContent = resultRow.category_name || "—";

    const outcome = document.createElement("td");
    outcome.className = "is-numeric";
    outcome.textContent = resultRow.outcome_text || "—";

    const affiliation = document.createElement("td");
    affiliation.textContent = resultRow.affiliation_labels?.length
      ? resultRow.affiliation_labels.join(", ")
      : "—";

    tr.append(place, competitor, category, outcome, affiliation);
    tbody.append(tr);
  });

  table.append(thead, tbody);
  tableWrap.append(table);
  article.append(tableWrap);
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

function renderBackLinks(params) {
  const target = document.getElementById("event-back-links");
  const fromType = params.get("fromType");
  const fromId = params.get("fromId");

  if (!fromType || !fromId || (fromType !== "person" && fromType !== "venue")) {
    return;
  }

  const link = document.createElement("a");
  link.className = "pill pill-link";
  link.href = getEntityUrl(fromType, fromId);
  link.textContent = fromType === "person" ? "Back To Person" : "Back To Venue";
  target.append(link);
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

  if (Number(detail.result_count || 0) > 0) {
    parts.push(`Results from: ${detail.result_source_brief || "source not yet linked"}`);
  } else {
    parts.push("No result rows captured yet");
  }

  return parts.join(" · ");
}

function buildEventResultsCopy(detail) {
  if (Number(detail.result_count || 0) > 0) {
    return "Course-by-course results exported for this event.";
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

  renderBackLinks(params);

  try {
    const detail = await fetchEventDetail(eventId);
    document.title = `${detail.event_name || "Event"} · Project '77`;
    document.getElementById("event-title").textContent = detail.event_name || "Untitled event";
    document.getElementById("event-subtitle").textContent = buildEventSubtitle(detail);
    document.getElementById("event-results-copy").textContent = buildEventResultsCopy(detail);

    const facts = [
      createDetailFact("Date", formatEventPageDate(detail.event_date)),
      createDetailFact("Venue", createEntityLink("venue", detail.venue_id, detail.venue_name || "Unknown venue")),
      createDetailFact("Club", detail.organizing_club_name || "Unknown club"),
      createDetailFact("Results", formatEventPageNumber(detail.result_count)),
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
