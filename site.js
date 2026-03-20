const numberFormatter = new Intl.NumberFormat("en-US");
const decimalFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const eventDetailCache = new Map();
let inlineDetailRequestToken = 0;
let inlineDetailIdCounter = 0;
let activeInlineDetail = null;

function formatNumber(value) {
  return numberFormatter.format(value ?? 0);
}

function formatDate(value) {
  if (!value) return "n/a";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function formatDistanceKm(value) {
  return value == null ? null : `${decimalFormatter.format(value)} km`;
}

function formatClimbMeters(value) {
  return value == null ? null : `${formatNumber(value)} m climb`;
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

function createDetailFact(label, value) {
  const card = document.createElement("article");
  card.className = "detail-fact";

  const labelNode = document.createElement("span");
  labelNode.className = "detail-fact-label";
  labelNode.textContent = label;

  const valueNode = document.createElement("span");
  valueNode.className = "detail-fact-value";
  valueNode.textContent = value;

  card.append(labelNode, valueNode);
  return card;
}

function createStatusChip(label, extraClass = "") {
  const chip = document.createElement("span");
  chip.className = `status-chip${extraClass ? ` ${extraClass}` : ""}`;
  chip.textContent = label;
  return chip;
}

function isEventNavigable(row) {
  return Boolean(row?.event_id) && Number(row?.result_count || 0) > 0;
}

function createEventNameNode(row, onToggle) {
  const label = row.event_name || "Untitled event";
  if (!isEventNavigable(row)) {
    const span = document.createElement("span");
    span.textContent = label;
    return span;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "event-link";
  button.textContent = label;
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle(button);
  });
  return button;
}

function renderStats(summary) {
  const statsGrid = document.getElementById("stats-grid");
  const cards = [
    createStatCard(
      "Competitions",
      formatNumber(summary.competitions),
      `${summary.competition_event_date_min} to ${summary.competition_event_date_max}`
    ),
    createStatCard("Events", formatNumber(summary.events), `${summary.event_date_min} to ${summary.event_date_max}`),
    createStatCard("Results", formatNumber(summary.results), `${summary.result_event_date_min} to ${summary.result_event_date_max}`),
    createStatCard("Documents", formatNumber(summary.documents), `${formatNumber(summary.web_snapshots)} web snapshots`),
    createStatCard("Newsletter Issues", formatNumber(summary.newsletter_issues), `${summary.newsletter_date_min} to ${summary.newsletter_date_max}`),
    createStatCard("People", formatNumber(summary.individuals), `${formatNumber(summary.teams)} teams`),
    createStatCard(
      "Unique Venues",
      formatNumber(summary.venues),
      `${formatNumber(summary.venue_rows_active)} active rows from ${formatNumber(summary.venue_rows_raw)} raw`
    ),
    createStatCard(
      "Competition Venues",
      formatNumber(summary.competition_venues),
      `${formatNumber(summary.competition_only_venues)} competition-only, ${formatNumber(summary.mixed_use_venues)} mixed-use`
    ),
    createStatCard("Artifacts", formatNumber(summary.artifacts), `${formatNumber(summary.citations)} citations`),
    createStatCard("Page Artifacts", formatNumber(summary.page_artifacts), "Still effectively unused"),
  ];

  statsGrid.replaceChildren(...cards);
}

function renderStackList(targetId, rows, labelKey, valueKey) {
  const target = document.getElementById(targetId);
  const maxValue = Math.max(...rows.map((row) => row[valueKey] || 0), 1);

  const items = rows.map((row) => {
    const wrapper = document.createElement("div");
    wrapper.className = "stack-row";

    const header = document.createElement("div");
    header.className = "stack-row-header";

    const label = document.createElement("span");
    label.className = "stack-row-label";
    label.textContent = row[labelKey];

    const value = document.createElement("span");
    value.className = "stack-row-value";
    value.textContent = formatNumber(row[valueKey]);

    header.append(label, value);

    const bar = document.createElement("div");
    bar.className = "stack-bar";

    const fill = document.createElement("span");
    fill.style.width = `${(row[valueKey] / maxValue) * 100}%`;
    bar.append(fill);

    wrapper.append(header, bar);
    return wrapper;
  });

  target.replaceChildren(...items);
}

function renderCoverage(rows) {
  const target = document.getElementById("coverage-chart");
  const maxEvents = Math.max(
    ...rows.map((row) => row.competition_event_count ?? row.event_count ?? 0),
    1
  );
  const coverageSections = [
    { key: "coc_competition", label: "COC Competitions" },
    {
      key: "coc_noncompetition",
      label: "COC Meetings/Trainings/Socials/etc",
    },
    { key: "non_coc", label: "Non-COC Events" },
  ];

  const items = rows.map((row) => {
    const wrapper = document.createElement("section");
    wrapper.className = "coverage-year";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "coverage-row";
    toggle.setAttribute("aria-expanded", "false");

    const detail = document.createElement("div");
    detail.className = "coverage-detail";
    detail.id = `coverage-events-${row.year}`;
    detail.hidden = true;
    toggle.setAttribute("aria-controls", detail.id);

    const year = document.createElement("div");
    year.className = "year";
    year.textContent = row.year;

    const bars = document.createElement("div");
    bars.className = "coverage-bars";

    const events = row.events || [];
    const competitionEventCount = row.competition_event_count ?? row.event_count ?? 0;
    const competitionEventsWithResultsCount =
      row.competition_result_event_count ??
      events.filter((eventRow) => Number(eventRow.result_count || 0) > 0).length;

    const eventTrack = document.createElement("div");
    eventTrack.className = "bar-track";
    const eventFill = document.createElement("div");
    eventFill.className = "bar-fill events";
    eventFill.style.width = `${(competitionEventCount / maxEvents) * 100}%`;
    const resultsFill = document.createElement("div");
    resultsFill.className = "bar-fill results";
    resultsFill.style.width = `${(competitionEventsWithResultsCount / maxEvents) * 100}%`;
    eventTrack.append(eventFill, resultsFill);

    const meta = document.createElement("div");
    meta.className = "bar-meta";
    meta.textContent = `Events: ${formatNumber(competitionEventCount)} ; Events with Results: ${formatNumber(competitionEventsWithResultsCount)} ; Result Count: ${formatNumber(row.result_count)}`;

    const caret = document.createElement("span");
    caret.className = "coverage-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "▾";

    bars.append(eventTrack, meta);
    toggle.append(year, bars, caret);

    const sections = document.createElement("div");
    sections.className = "coverage-sections";

    coverageSections.forEach((section) => {
      const sectionWrap = document.createElement("section");
      sectionWrap.className = "coverage-subsection";

      const sectionEvents = events.filter(
        (eventRow) => (eventRow.coverage_section || "non_coc") === section.key
      );

      const sectionHead = document.createElement("button");
      sectionHead.type = "button";
      sectionHead.className = "coverage-subsection-head";
      sectionHead.setAttribute("aria-expanded", "false");

      const sectionBody = document.createElement("div");
      sectionBody.className = "coverage-subsection-body";
      sectionBody.id = `coverage-events-${row.year}-${section.key}`;
      sectionBody.hidden = true;
      sectionHead.setAttribute("aria-controls", sectionBody.id);

      const sectionTitle = document.createElement("h3");
      sectionTitle.textContent = section.label;

      const sectionMeta = document.createElement("span");
      sectionMeta.className = "coverage-subsection-meta";

      const sectionCount = document.createElement("span");
      sectionCount.className = "coverage-subsection-count";
      sectionCount.textContent = `${formatNumber(sectionEvents.length)} events`;

      const sectionCaret = document.createElement("span");
      sectionCaret.className = "coverage-subsection-caret";
      sectionCaret.setAttribute("aria-hidden", "true");
      sectionCaret.textContent = "▾";

      sectionMeta.append(sectionCount, sectionCaret);
      sectionHead.append(sectionTitle, sectionMeta);
      sectionWrap.append(sectionHead, sectionBody);

      if (sectionEvents.length) {
        const tableWrap = document.createElement("div");
        tableWrap.className = "table-wrap";

        const table = document.createElement("table");
        table.className = "coverage-events-table";

        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");

        ["Event Name", "Venue", "Date", "Results"].forEach((labelText) => {
          const th = document.createElement("th");
          th.textContent = labelText;
          headRow.append(th);
        });

        thead.append(headRow);

        const tbody = document.createElement("tbody");
        sectionEvents.forEach((eventRow) => {
          const tr = document.createElement("tr");
          tr.className = "event-summary-row";

          const eventName = document.createElement("td");
          eventName.append(
            createEventNameNode(eventRow, (button) => {
              void toggleInlineEventDetail({
                button,
                eventId: eventRow.event_id,
                hostRow: tr,
                colspan: 4,
              });
            })
          );

          const venue = document.createElement("td");
          venue.textContent = eventRow.venue_name || "Unknown venue";

          const date = document.createElement("td");
          date.textContent = formatDate(eventRow.event_date);

          const results = document.createElement("td");
          results.textContent = formatNumber(eventRow.result_count);

          tr.append(eventName, venue, date, results);
          tbody.append(tr);
        });

        table.append(thead, tbody);
        tableWrap.append(table);
        sectionBody.append(tableWrap);
      } else {
        const empty = document.createElement("p");
        empty.className = "coverage-empty muted";
        empty.textContent = "No events in this section.";
        sectionBody.append(empty);
      }

      sectionHead.addEventListener("click", () => {
        const expanded = sectionHead.getAttribute("aria-expanded") === "true";
        const nextExpanded = !expanded;
        if (!nextExpanded) {
          closeInlineDetailWithin(sectionBody);
        }
        sectionHead.setAttribute("aria-expanded", String(nextExpanded));
        sectionBody.hidden = !nextExpanded;
        sectionWrap.classList.toggle("is-expanded", nextExpanded);
      });

      sections.append(sectionWrap);
    });

    detail.append(sections);

    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      const nextExpanded = !expanded;
      if (!nextExpanded) {
        closeInlineDetailWithin(detail);
      }
      toggle.setAttribute("aria-expanded", String(nextExpanded));
      detail.hidden = !nextExpanded;
      wrapper.classList.toggle("is-expanded", nextExpanded);

      if (nextExpanded) {
        closeInlineDetailWithin(detail);
        detail.querySelectorAll(".coverage-subsection").forEach((sectionWrap) => {
          sectionWrap.classList.remove("is-expanded");
        });
        detail.querySelectorAll(".coverage-subsection-head").forEach((sectionHead) => {
          sectionHead.setAttribute("aria-expanded", "false");
        });
        detail.querySelectorAll(".coverage-subsection-body").forEach((sectionBody) => {
          sectionBody.hidden = true;
        });
      }
    });

    wrapper.append(toggle, detail);
    return wrapper;
  });

  target.replaceChildren(...items);
}

function renderRecentEvents(rows) {
  const target = document.getElementById("recent-events");
  const items = rows.map((row) => {
    const tr = document.createElement("tr");
    tr.className = "event-summary-row";

    const date = document.createElement("td");
    date.textContent = formatDate(row.event_date);

    const eventName = document.createElement("td");
    eventName.append(
      createEventNameNode(row, (button) => {
        void toggleInlineEventDetail({
          button,
          eventId: row.event_id,
          hostRow: tr,
          colspan: 6,
        });
      })
    );

    const kind = document.createElement("td");
    kind.append(createStatusChip(row.event_kind));

    const venue = document.createElement("td");
    venue.textContent = row.venue_name;

    const results = document.createElement("td");
    results.textContent = formatNumber(row.result_count);

    const citations = document.createElement("td");
    citations.textContent = formatNumber(row.citation_count);

    tr.append(date, eventName, kind, venue, results, citations);
    return tr;
  });
  target.replaceChildren(...items);
}

function renderPipelineSummary(summary) {
  const target = document.getElementById("pipeline-summary");
  const cards = [
    createStatCard("Issues", formatNumber(summary.issues), `${formatNumber(summary.has_transcription)} with transcription`),
    createStatCard("300dpi Scans", formatNumber(summary.has_scan_300dpi), `${formatNumber(summary.has_scan_archival)} archival`),
    createStatCard("OCR", formatNumber(summary.has_ocr), `${formatNumber(summary.has_scan_preview)} previews`),
    createStatCard("Registry Done", formatNumber(summary.issue_registry_done), `${formatNumber(summary.db_issue_provenance_done)} provenance done`),
    createStatCard("Metadata Done", formatNumber(summary.db_events_metadata_done), `${formatNumber(summary.db_notable_mentions_done)} notable mentions`),
    createStatCard("Full Results Done", formatNumber(summary.db_full_results_done), `${formatNumber(summary.db_full_capture_done)} full capture`),
  ];
  target.replaceChildren(...cards);
}

function assetSummary(row) {
  const parts = [];
  if (row.has_scan_300dpi) parts.push("300dpi");
  if (row.has_scan_archival) parts.push("archival");
  if (row.has_scan_preview) parts.push("preview");
  if (row.has_transcription) parts.push("transcription");
  if (row.has_ocr) parts.push("ocr");
  return parts.length ? parts.join(", ") : "none";
}

function deepDbSummary(row) {
  const deep = [
    row.db_existence_pass_status,
    row.db_events_metadata_status,
    row.db_notable_mentions_status,
    row.db_full_results_status,
    row.db_full_capture_status,
  ].filter(Boolean);

  return deep.length ? deep.join(" / ") : "not started";
}

function renderPipeline(rows) {
  const target = document.getElementById("newsletter-pipeline");
  const items = rows.map((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(row.date_published)}</td>
      <td>${row.title}</td>
      <td class="muted">${row.source_folder || "n/a"}</td>
      <td>${assetSummary(row)}</td>
      <td>${row.issue_registry_status || "not started"}</td>
      <td>${row.db_issue_provenance_status || "not started"}</td>
      <td>${deepDbSummary(row)}</td>
    `;
    return tr;
  });

  target.replaceChildren(...items);
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

async function fetchEventDetail(eventId) {
  if (eventDetailCache.has(eventId)) {
    return eventDetailCache.get(eventId);
  }

  const attempts = [];

  for (const candidate of getEventDetailCandidates(eventId)) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) {
        attempts.push(`${candidate} -> HTTP ${response.status}`);
        continue;
      }
      const detail = await response.json();
      eventDetailCache.set(eventId, detail);
      return detail;
    } catch (error) {
      attempts.push(`${candidate} -> ${error.message}`);
    }
  }

  throw new Error(attempts.join(" | "));
}

function createInlineDetailShell(titleText, summaryText, { metaNodes = [], bodyNodes = [], bodyText = "", onClose } = {}) {
  const shell = document.createElement("section");
  shell.className = "event-inline-shell";

  const head = document.createElement("div");
  head.className = "event-inline-head";

  const heading = document.createElement("div");
  heading.className = "event-inline-heading";

  const title = document.createElement("h3");
  title.className = "event-inline-title";
  title.textContent = titleText;

  const summary = document.createElement("p");
  summary.className = "event-inline-summary";
  summary.textContent = summaryText;

  heading.append(title, summary);
  head.append(heading);

  if (onClose) {
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "ghost-button";
    closeButton.textContent = "Collapse";
    closeButton.addEventListener("click", onClose);
    head.append(closeButton);
  }

  shell.append(head);

  if (metaNodes.length) {
    const meta = document.createElement("div");
    meta.className = "event-detail-meta";
    meta.append(...metaNodes);
    shell.append(meta);
  }

  const body = document.createElement("div");
  body.className = "event-detail-body";
  if (bodyNodes.length) {
    body.append(...bodyNodes);
  } else {
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = bodyText;
    body.append(message);
  }
  shell.append(body);

  return shell;
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
  stats.append(createStatusChip(`${formatNumber(course.result_count)} results`));

  const distance = formatDistanceKm(course.distance_km);
  if (distance) {
    stats.append(createStatusChip(distance, "subtle"));
  }

  if (course.control_count != null) {
    stats.append(createStatusChip(`${formatNumber(course.control_count)} controls`, "subtle"));
  }

  const climb = formatClimbMeters(course.course_climb_m);
  if (climb) {
    stats.append(createStatusChip(climb, "subtle"));
  }

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
    place.textContent = resultRow.course_rank == null ? "—" : formatNumber(resultRow.course_rank);

    const competitor = document.createElement("td");
    const competitorName = document.createElement("div");
    competitorName.textContent = resultRow.competitor_name || "(unnamed competitor)";
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

function buildEventDetailShell(detail, onClose) {
  const facts = [
    createDetailFact("Date", formatDate(detail.event_date)),
    createDetailFact("Venue", detail.venue_name || "Unknown venue"),
    createDetailFact("Club", detail.organizing_club_name || "Unknown club"),
    createDetailFact("Results", formatNumber(detail.result_count)),
    createDetailFact("Courses", formatNumber(detail.course_count)),
    createDetailFact("Citations", formatNumber(detail.citation_count)),
  ];

  const courseCards = (detail.courses || []).map(createCourseCard);

  return createInlineDetailShell(
    detail.event_name || "Untitled event",
    [
      formatDate(detail.event_date),
      detail.event_kind || "unknown kind",
      detail.venue_name || "Unknown venue",
      `Results from: ${detail.result_source_brief || "source not yet linked"}`,
    ].join(" · "),
    {
      metaNodes: facts,
      bodyNodes: courseCards,
      onClose,
    }
  );
}

function buildEventDetailMessageShell(titleText, summaryText, bodyText, onClose) {
  return createInlineDetailShell(titleText, summaryText, { bodyText, onClose });
}

function closeActiveInlineDetail({ restoreFocus = false } = {}) {
  const active = activeInlineDetail;
  if (!active) return;

  inlineDetailRequestToken += 1;

  if (active.hostRow?.isConnected) {
    active.hostRow.classList.remove("is-detail-open");
  }
  if (active.button?.isConnected) {
    active.button.setAttribute("aria-expanded", "false");
    active.button.removeAttribute("aria-controls");
  }
  if (active.detailRow?.isConnected) {
    active.detailRow.remove();
  }

  activeInlineDetail = null;

  if (restoreFocus && active.button?.isConnected) {
    active.button.focus();
  }
}

function closeInlineDetailWithin(container) {
  if (!activeInlineDetail || !container) return;
  if (container.contains(activeInlineDetail.hostRow) || container.contains(activeInlineDetail.detailRow)) {
    closeActiveInlineDetail();
  }
}

async function toggleInlineEventDetail({ button, eventId, hostRow, colspan }) {
  if (activeInlineDetail?.button === button) {
    closeActiveInlineDetail({ restoreFocus: false });
    return;
  }

  closeActiveInlineDetail();

  const detailRow = document.createElement("tr");
  detailRow.className = "event-detail-row";
  detailRow.id = `event-inline-detail-${++inlineDetailIdCounter}`;

  const detailCell = document.createElement("td");
  detailCell.className = "event-detail-cell";
  detailCell.colSpan = colspan;
  detailRow.append(detailCell);

  hostRow.classList.add("is-detail-open");
  button.setAttribute("aria-expanded", "true");
  button.setAttribute("aria-controls", detailRow.id);
  hostRow.after(detailRow);

  activeInlineDetail = { button, hostRow, detailRow, eventId };
  const onClose = () => closeActiveInlineDetail({ restoreFocus: true });
  const token = ++inlineDetailRequestToken;

  detailCell.replaceChildren(
    buildEventDetailMessageShell(
      "Loading Event Results",
      "Fetching static event detail export.",
      "The event detail JSON is loading.",
      onClose
    )
  );

  try {
    const detail = await fetchEventDetail(eventId);
    if (token !== inlineDetailRequestToken || activeInlineDetail?.detailRow !== detailRow) return;
    detailCell.replaceChildren(buildEventDetailShell(detail, onClose));
  } catch (error) {
    if (token !== inlineDetailRequestToken || activeInlineDetail?.detailRow !== detailRow) return;
    detailCell.replaceChildren(
      buildEventDetailMessageShell(
        "Event Details Unavailable",
        "The static event detail export could not be loaded.",
        error.message,
        onClose
      )
    );
  }
}

async function fetchSnapshot() {
  if (window.location.protocol === "file:") {
    throw new Error("This static viewer needs HTTP(S). Open it from GitHub Pages or a local web server.");
  }

  const attempts = [];

  for (const candidate of getSnapshotCandidates()) {
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

async function main() {
  const generatedAt = document.getElementById("generated-at");

  try {
    const data = await fetchSnapshot();
    generatedAt.textContent = `Snapshot exported ${data.generated_at}`;

    renderStats(data.summary);
    renderCoverage(data.coverage_by_year);
    renderStackList("source-documents", data.source_documents, "document_type", "count");
    renderStackList("result-statuses", data.result_statuses, "status", "count");
    renderRecentEvents(data.recent_events);
    renderPipelineSummary(data.newsletter_pipeline_summary);
    renderPipeline(data.newsletter_pipeline);
  } catch (error) {
    generatedAt.textContent = error.message.includes("HTTP(S)")
      ? "Snapshot unavailable on file://"
      : "Snapshot unavailable";
    generatedAt.classList.add("muted");
    console.error(error);
  }
}

main();
