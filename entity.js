const entityNumberFormatter = new Intl.NumberFormat("en-US");
const entityDateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function formatEntityNumber(value) {
  return entityNumberFormatter.format(value ?? 0);
}

function formatEntityDate(value) {
  if (!value) return "n/a";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : entityDateFormatter.format(date);
}

function formatEntityEventStatusLabel(value) {
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

function formatEntityEventResultsValue(row) {
  const statusLabel = formatEntityEventStatusLabel(row?.event_status);
  if (statusLabel && Number(row?.result_count || row?.result_row_count || 0) === 0) {
    return statusLabel;
  }
  return formatEntityNumber(row?.result_count ?? row?.result_row_count);
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

function getDetailCandidates(type, id) {
  const folder = type === "person"
    ? "person-details"
    : type === "organization"
      ? "organization-details"
      : "venue-details";
  return getDataCandidates(`${folder}/${id}.json`);
}

async function fetchEntityDetail(type, id) {
  const attempts = [];

  for (const candidate of getDetailCandidates(type, id)) {
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

function createStatCard(label, value, detail) {
  const card = document.createElement("article");
  card.className = "stat-card";

  const labelNode = document.createElement("span");
  labelNode.className = "label";
  labelNode.textContent = label;

  const valueNode = document.createElement("span");
  valueNode.className = "value";
  valueNode.textContent = value;

  card.append(labelNode, valueNode);

  if (detail) {
    const detailNode = document.createElement("span");
    detailNode.className = "detail";
    detailNode.textContent = detail;
    card.append(detailNode);
  }

  return card;
}

function createStatusChip(label, extraClass = "") {
  const chip = document.createElement("span");
  chip.className = `status-chip${extraClass ? ` ${extraClass}` : ""}`;
  chip.textContent = label;
  return chip;
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

function createEventLink(eventId, label, { fromType = "", fromId = "" } = {}) {
  if (!eventId) {
    const span = document.createElement("span");
    span.textContent = label || "Untitled event";
    return span;
  }

  const link = document.createElement("a");
  link.className = "event-link";
  link.href = getEventUrl(eventId, { fromType, fromId });
  link.textContent = label || "Untitled event";
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

function renderAliases(aliases) {
  const target = document.getElementById("entity-aliases");
  if (!aliases?.length) {
    target.hidden = true;
    target.replaceChildren();
    return;
  }

  const chips = aliases.map((alias) => createStatusChip(alias, "subtle"));
  target.replaceChildren(...chips);
  target.hidden = false;
}

function renderSummaryCards(cards) {
  const target = document.getElementById("entity-summary-stats");
  target.replaceChildren(...cards);
}

function renderPerson(detail) {
  document.title = `${detail.individual_name} · Project '77`;

  const title = document.getElementById("entity-title");
  const subtitle = document.getElementById("entity-subtitle");
  const meta = document.getElementById("entity-meta");
  const description = document.getElementById("entity-description");

  title.textContent = detail.individual_name;
  subtitle.textContent = "Static person detail from the current snapshot export.";
  meta.replaceChildren(
    createStatusChip(`${formatEntityNumber(detail.summary.event_count)} events`),
    createStatusChip(`${formatEntityNumber(detail.summary.role_count)} volunteer roles`),
    createStatusChip(`${formatEntityNumber(detail.summary.mention_count)} mentions`)
  );
  description.hidden = true;
  description.textContent = "";

  renderSummaryCards([
    createStatCard("Events", formatEntityNumber(detail.summary.event_count), "Result-linked events"),
    createStatCard("Volunteer Roles", formatEntityNumber(detail.summary.role_count), "Event role rows"),
    createStatCard("Mentions", formatEntityNumber(detail.summary.mention_count), "Direct citation-backed mentions"),
  ]);
  renderAliases(detail.aliases);

  document.getElementById("entity-events-heading").textContent = "Events";
  document.getElementById("entity-events-copy").textContent = "All exported event results tied to this individual.";
  setTableHead(document.getElementById("entity-events-head"), ["Date", "Event", "Venue", "Results"]);

  const eventRows = (detail.events || []).map((eventRow) => {
    const tr = document.createElement("tr");

    const date = document.createElement("td");
    date.textContent = formatEntityDate(eventRow.event_date);

    const eventName = document.createElement("td");
    appendTextLine(eventName, "", "cell-title");
    eventName.firstChild.replaceWith(
      createEventLink(eventRow.event_id, eventRow.event_name || "Untitled event", {
        fromType: "person",
        fromId: detail.individual_id,
      })
    );
    appendTextLine(eventName, eventRow.event_kind || "unknown kind", "muted");

    const venue = document.createElement("td");
    venue.append(createEntityLink("venue", eventRow.venue_id, eventRow.venue_name || "Unknown venue"));

    const results = document.createElement("td");
    const resultsWrap = document.createElement("div");
    resultsWrap.className = "entity-result-summaries";
    (eventRow.result_rows || []).forEach((resultRow) => {
      const summary = document.createElement("div");
      summary.className = "entity-result-summary";

      const pieces = [resultRow.course_name || "Unnamed course"];
      if (resultRow.category_name) pieces.push(resultRow.category_name);
      if (resultRow.overall_rank != null) {
        pieces.push(`Overall #${formatEntityNumber(resultRow.overall_rank)}`);
      } else if (resultRow.course_rank != null) {
        pieces.push(`#${formatEntityNumber(resultRow.course_rank)}`);
      }
      if (resultRow.category_rank != null) {
        pieces.push(`Category #${formatEntityNumber(resultRow.category_rank)}`);
      }
      if (resultRow.outcome_text) pieces.push(resultRow.outcome_text);
      appendTextLine(summary, pieces.join(" · "), "cell-title");
      if (resultRow.metric_summary && resultRow.metric_summary !== resultRow.outcome_text) {
        appendTextLine(summary, resultRow.metric_summary, "muted");
      }

      const affiliationNodes = createAffiliationNodes(resultRow);
      if (affiliationNodes.length) {
        const flagLine = document.createElement("div");
        flagLine.className = "muted";
        appendDelimitedNodes(flagLine, affiliationNodes);
        summary.append(flagLine);
      }

      const flags = [];
      if (resultRow.competitive === false) flags.push("Non-competitive");
      if (resultRow.additional_course) flags.push("Additional course");
      if (flags.length) appendTextLine(summary, flags.join(" · "), "muted");
      if (resultRow.result_notes) appendTextLine(summary, resultRow.result_notes, "muted");

      resultsWrap.append(summary);
    });

    results.append(resultsWrap);
    tr.append(date, eventName, venue, results);
    return tr;
  });

  const eventsBody = document.getElementById("entity-events-body");
  const eventsWrap = document.getElementById("entity-events-wrap");
  const eventsEmpty = document.getElementById("entity-events-empty");
  if (eventRows.length) {
    eventsBody.replaceChildren(...eventRows);
    eventsWrap.hidden = false;
    eventsEmpty.hidden = true;
  } else {
    eventsBody.replaceChildren();
    eventsWrap.hidden = true;
    eventsEmpty.hidden = false;
  }

  const rolesPanel = document.getElementById("entity-roles-panel");
  rolesPanel.hidden = false;
  setTableHead(document.getElementById("entity-roles-head"), ["Date", "Event", "Venue", "Role", "Hours", "Points", "Sources"]);
  const roleRows = (detail.volunteer_roles || []).map((roleRow) => {
    const tr = document.createElement("tr");

    const date = document.createElement("td");
    date.textContent = formatEntityDate(roleRow.event_date);

    const eventName = document.createElement("td");
    appendTextLine(eventName, "", "cell-title");
    eventName.firstChild.replaceWith(
      createEventLink(roleRow.event_id, roleRow.event_name || "Untitled event", {
        fromType: "person",
        fromId: detail.individual_id,
      })
    );
    appendTextLine(eventName, roleRow.event_kind || "unknown kind", "muted");

    const venue = document.createElement("td");
    venue.append(createEntityLink("venue", roleRow.venue_id, roleRow.venue_name || "Unknown venue"));

    const role = document.createElement("td");
    role.textContent = roleRow.role_name || "Unspecified role";

    const hours = document.createElement("td");
    hours.textContent = roleRow.volunteer_hours == null ? "—" : formatEntityNumber(roleRow.volunteer_hours);

    const points = document.createElement("td");
    points.textContent = roleRow.volunteer_points == null ? "—" : formatEntityNumber(roleRow.volunteer_points);

    const sources = document.createElement("td");
    if (roleRow.citation_briefs?.length) {
      appendTextLine(sources, roleRow.citation_briefs.join(" · "), "muted");
    } else {
      sources.textContent = roleRow.citation_count
        ? `${formatEntityNumber(roleRow.citation_count)} citation(s)`
        : "—";
    }

    tr.append(date, eventName, venue, role, hours, points, sources);
    return tr;
  });

  const rolesBody = document.getElementById("entity-roles-body");
  const rolesWrap = document.getElementById("entity-roles-wrap");
  const rolesEmpty = document.getElementById("entity-roles-empty");
  if (roleRows.length) {
    rolesBody.replaceChildren(...roleRows);
    rolesWrap.hidden = false;
    rolesEmpty.hidden = true;
  } else {
    rolesBody.replaceChildren();
    rolesWrap.hidden = true;
    rolesEmpty.hidden = false;
  }

  const mentionsPanel = document.getElementById("entity-mentions-panel");
  mentionsPanel.hidden = false;
  setTableHead(document.getElementById("entity-mentions-head"), ["Published", "Source", "Type", "Notes / Excerpt"]);
  const mentionRows = (detail.mentions || []).map((mentionRow) => {
    const tr = document.createElement("tr");

    const published = document.createElement("td");
    published.textContent = formatEntityDate(mentionRow.date_published);

    const source = document.createElement("td");
    appendTextLine(source, mentionRow.source_brief || "Unknown source", "cell-title");
    appendTextLine(source, formatCodeLabel(mentionRow.document_type || "unknown document"), "muted");

    const type = document.createElement("td");
    type.textContent = formatCodeLabel(mentionRow.mention_type);

    const notes = document.createElement("td");
    if (mentionRow.mention_notes) {
      appendTextLine(notes, mentionRow.mention_notes);
    }
    if (mentionRow.excerpt) {
      appendTextLine(notes, `“${mentionRow.excerpt}”`, "muted");
    }
    if (!mentionRow.mention_notes && !mentionRow.excerpt) {
      notes.textContent = "—";
    }

    tr.append(published, source, type, notes);
    return tr;
  });

  const mentionsBody = document.getElementById("entity-mentions-body");
  const mentionsWrap = document.getElementById("entity-mentions-wrap");
  const mentionsEmpty = document.getElementById("entity-mentions-empty");
  if (mentionRows.length) {
    mentionsBody.replaceChildren(...mentionRows);
    mentionsWrap.hidden = false;
    mentionsEmpty.hidden = true;
  } else {
    mentionsBody.replaceChildren();
    mentionsWrap.hidden = true;
    mentionsEmpty.hidden = false;
  }
}

function renderVenue(detail) {
  document.title = `${detail.venue_name} · Project '77`;

  const title = document.getElementById("entity-title");
  const subtitle = document.getElementById("entity-subtitle");
  const meta = document.getElementById("entity-meta");
  const description = document.getElementById("entity-description");

  title.textContent = detail.venue_name;
  subtitle.textContent = "All exported events currently attached to this venue.";

  const metaNodes = [
    createStatusChip(`${formatEntityNumber(detail.summary.event_count)} events`),
    createStatusChip(`${formatEntityNumber(detail.summary.mention_count)} mentions`, "subtle"),
  ];
  if (detail.parent_venue_id && detail.parent_venue_name) {
    metaNodes.push(
      createEntityLink("venue", detail.parent_venue_id, `Part of ${detail.parent_venue_name}`, "pill pill-link")
    );
  }
  meta.replaceChildren(...metaNodes);

  if (detail.venue_description) {
    description.textContent = detail.venue_description;
    description.hidden = false;
  } else {
    description.hidden = true;
    description.textContent = "";
  }

  renderSummaryCards([
    createStatCard("Events", formatEntityNumber(detail.summary.event_count), "Events attached to this venue"),
    createStatCard("Aliases", formatEntityNumber(detail.aliases?.length || 0), "Searchable alternate names"),
    createStatCard("Mentions", formatEntityNumber(detail.summary.mention_count), "Direct venue mentions"),
  ]);
  renderAliases(detail.aliases);

  document.getElementById("entity-events-heading").textContent = "Venue Events";
  document.getElementById("entity-events-copy").textContent = "Event inventory currently attached to this venue.";
  setTableHead(document.getElementById("entity-events-head"), ["Date", "Event", "Kind", "Club", "Results"]);

  const eventRows = (detail.events || []).map((eventRow) => {
    const tr = document.createElement("tr");

    const date = document.createElement("td");
    date.textContent = formatEntityDate(eventRow.event_date);

    const eventName = document.createElement("td");
    eventName.append(
      createEventLink(eventRow.event_id, eventRow.event_name || "Untitled event", {
        fromType: "venue",
        fromId: detail.venue_id,
      })
    );

    const kind = document.createElement("td");
    kind.append(createStatusChip(eventRow.event_kind || "unknown"));

    const club = document.createElement("td");
    club.append(
      createEntityLink("organization", eventRow.organizing_club_id, eventRow.organizing_club_name || "Unknown club")
    );

    const results = document.createElement("td");
    results.textContent = formatEntityEventResultsValue(eventRow);

    tr.append(date, eventName, kind, club, results);
    return tr;
  });

  const eventsBody = document.getElementById("entity-events-body");
  const eventsWrap = document.getElementById("entity-events-wrap");
  const eventsEmpty = document.getElementById("entity-events-empty");
  if (eventRows.length) {
    eventsBody.replaceChildren(...eventRows);
    eventsWrap.hidden = false;
    eventsEmpty.hidden = true;
  } else {
    eventsBody.replaceChildren();
    eventsWrap.hidden = true;
    eventsEmpty.hidden = false;
  }

  document.getElementById("entity-roles-panel").hidden = true;
  document.getElementById("entity-mentions-panel").hidden = true;
}

function renderOrganization(detail) {
  document.title = `${detail.organization_name} · Project '77`;

  const title = document.getElementById("entity-title");
  const subtitle = document.getElementById("entity-subtitle");
  const meta = document.getElementById("entity-meta");
  const description = document.getElementById("entity-description");

  title.textContent = detail.organization_name;
  subtitle.textContent = "Static organization detail from the current snapshot export.";

  const activeYears = detail.summary.first_result_year && detail.summary.last_result_year
    ? `${detail.summary.first_result_year}–${detail.summary.last_result_year}`
    : null;
  const metaNodes = [
    createStatusChip(`${formatEntityNumber(detail.summary.result_count)} affiliated results`),
    createStatusChip(`${formatEntityNumber(detail.summary.organized_event_count)} organized events`, "subtle"),
  ];
  if (activeYears) {
    metaNodes.push(createStatusChip(activeYears, "subtle"));
  }
  meta.replaceChildren(...metaNodes);

  if (detail.organization_type || activeYears) {
    description.textContent = [detail.organization_type, activeYears ? `Result years active: ${activeYears}` : null]
      .filter(Boolean)
      .join(" · ");
    description.hidden = false;
  } else {
    description.hidden = true;
    description.textContent = "";
  }

  renderSummaryCards([
    createStatCard("Affiliated Results", formatEntityNumber(detail.summary.result_count), "Resolved affiliation-labeled result rows"),
    createStatCard("Affiliated Events", formatEntityNumber(detail.summary.result_event_count), "Distinct events with resolved affiliation rows"),
    createStatCard("Organized Events", formatEntityNumber(detail.summary.organized_event_count), "Events whose organizing club is this organization"),
    createStatCard("Competitors", formatEntityNumber(detail.summary.competitor_count), "Individuals with resolved affiliated results"),
    createStatCard("Teams", formatEntityNumber(detail.summary.team_count), "Teams with resolved affiliated results"),
    createStatCard("Documented Members", formatEntityNumber(detail.summary.documented_member_count), "Rows in affiliation tables"),
  ]);
  renderAliases(detail.aliases);

  document.getElementById("entity-events-heading").textContent = "Affiliated Result Events";
  document.getElementById("entity-events-copy").textContent =
    "Events where exported result affiliations resolve to this organization.";
  setTableHead(document.getElementById("entity-events-head"), ["Date", "Event", "Venue", "Affiliated Results"]);

  const resultEventRows = (detail.result_events || []).map((eventRow) => {
    const tr = document.createElement("tr");

    const date = document.createElement("td");
    date.textContent = formatEntityDate(eventRow.event_date);

    const eventName = document.createElement("td");
    appendTextLine(eventName, "", "cell-title");
    eventName.firstChild.replaceWith(
      createEventLink(eventRow.event_id, eventRow.event_name || "Untitled event", {
        fromType: "organization",
        fromId: detail.organization_id,
      })
    );
    appendTextLine(eventName, eventRow.event_kind || "unknown kind", "muted");

    const venue = document.createElement("td");
    venue.append(createEntityLink("venue", eventRow.venue_id, eventRow.venue_name || "Unknown venue"));

    const results = document.createElement("td");
    results.textContent = formatEntityNumber(eventRow.result_count);

    tr.append(date, eventName, venue, results);
    return tr;
  });

  const eventsBody = document.getElementById("entity-events-body");
  const eventsWrap = document.getElementById("entity-events-wrap");
  const eventsEmpty = document.getElementById("entity-events-empty");
  if (resultEventRows.length) {
    eventsBody.replaceChildren(...resultEventRows);
    eventsWrap.hidden = false;
    eventsEmpty.hidden = true;
  } else {
    eventsBody.replaceChildren();
    eventsWrap.hidden = true;
    eventsEmpty.hidden = false;
  }

  const rolesPanel = document.getElementById("entity-roles-panel");
  rolesPanel.hidden = false;
  rolesPanel.querySelector(".panel-head h2").textContent = "Organized Events";
  rolesPanel.querySelector(".panel-head p").textContent =
    "Events currently attributed to this organization as the organizing club.";
  setTableHead(document.getElementById("entity-roles-head"), ["Date", "Event", "Venue", "Results"]);

  const organizedEventRows = (detail.organized_events || []).map((eventRow) => {
    const tr = document.createElement("tr");

    const date = document.createElement("td");
    date.textContent = formatEntityDate(eventRow.event_date);

    const eventName = document.createElement("td");
    appendTextLine(eventName, "", "cell-title");
    eventName.firstChild.replaceWith(
      createEventLink(eventRow.event_id, eventRow.event_name || "Untitled event", {
        fromType: "organization",
        fromId: detail.organization_id,
      })
    );
    appendTextLine(eventName, eventRow.event_kind || "unknown kind", "muted");

    const venue = document.createElement("td");
    venue.append(createEntityLink("venue", eventRow.venue_id, eventRow.venue_name || "Unknown venue"));

    const results = document.createElement("td");
    results.textContent = formatEntityEventResultsValue(eventRow);

    tr.append(date, eventName, venue, results);
    return tr;
  });

  const rolesBody = document.getElementById("entity-roles-body");
  const rolesWrap = document.getElementById("entity-roles-wrap");
  const rolesEmpty = document.getElementById("entity-roles-empty");
  if (organizedEventRows.length) {
    rolesBody.replaceChildren(...organizedEventRows);
    rolesWrap.hidden = false;
    rolesEmpty.hidden = true;
  } else {
    rolesBody.replaceChildren();
    rolesWrap.hidden = true;
    rolesEmpty.hidden = false;
  }

  const mentionsPanel = document.getElementById("entity-mentions-panel");
  mentionsPanel.hidden = false;
  mentionsPanel.querySelector(".panel-head h2").textContent = "Affiliation Roster";
  mentionsPanel.querySelector(".panel-head p").textContent =
    "Competitors and teams seen with this organization in resolved result affiliations.";
  setTableHead(document.getElementById("entity-mentions-head"), ["Competitor", "Type", "Years", "Results", "Events"]);

  const rosterRows = (detail.roster || []).map((row) => {
    const tr = document.createElement("tr");

    const competitor = document.createElement("td");
    if (row.individual_id) {
      competitor.append(createEntityLink("person", row.individual_id, row.competitor_name || "(unnamed competitor)"));
    } else {
      competitor.textContent = row.competitor_name || "(unnamed team)";
    }

    const type = document.createElement("td");
    type.textContent = formatCodeLabel(row.competitor_type);

    const years = document.createElement("td");
    years.textContent = row.first_year && row.last_year ? `${row.first_year}–${row.last_year}` : "—";

    const results = document.createElement("td");
    results.textContent = formatEntityNumber(row.result_count);

    const events = document.createElement("td");
    events.textContent = formatEntityNumber(row.event_count);

    tr.append(competitor, type, years, results, events);
    return tr;
  });

  const mentionsBody = document.getElementById("entity-mentions-body");
  const mentionsWrap = document.getElementById("entity-mentions-wrap");
  const mentionsEmpty = document.getElementById("entity-mentions-empty");
  if (rosterRows.length) {
    mentionsBody.replaceChildren(...rosterRows);
    mentionsWrap.hidden = false;
    mentionsEmpty.hidden = true;
  } else {
    mentionsBody.replaceChildren();
    mentionsWrap.hidden = true;
    mentionsEmpty.hidden = false;
  }
}

function renderError(message) {
  document.title = "Entity Unavailable · Project '77";
  document.getElementById("entity-title").textContent = "Detail Unavailable";
  document.getElementById("entity-subtitle").textContent = message;
  document.getElementById("entity-meta").replaceChildren();
  document.getElementById("entity-summary-panel").hidden = true;
  document.getElementById("entity-events-panel").hidden = true;
  document.getElementById("entity-roles-panel").hidden = true;
  document.getElementById("entity-mentions-panel").hidden = true;
}

async function main() {
  if (window.location.protocol === "file:") {
    renderError("This static viewer needs HTTP(S). Open it from GitHub Pages or a local web server.");
    return;
  }

  window.Project77Search?.setup();

  const params = new URLSearchParams(window.location.search);
  const type = params.get("type");
  const id = params.get("id");

  if (!id || (type !== "person" && type !== "venue" && type !== "organization")) {
    renderError("Missing or invalid detail parameters.");
    return;
  }

  try {
    const detail = await fetchEntityDetail(type, id);
    if (type === "person") {
      renderPerson(detail);
    } else if (type === "organization") {
      renderOrganization(detail);
    } else {
      renderVenue(detail);
    }
  } catch (error) {
    console.error(error);
    renderError(error.message);
  }
}

main();
