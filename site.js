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
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const eventDetailCache = new Map();
const searchIndexCache = {
  entries: null,
  fuse: null,
};
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

function formatTimestamp(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : timestampFormatter.format(date);
}

function formatDistanceKm(value) {
  return value == null ? null : `${decimalFormatter.format(value)} km`;
}

function formatClimbMeters(value) {
  return value == null ? null : `${formatNumber(value)} m climb`;
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

function formatEventResultsValue(row) {
  const statusLabel = formatEventStatusLabel(row?.event_status);
  if (statusLabel && Number(row?.result_count || 0) === 0) {
    return statusLabel;
  }
  return formatNumber(row?.result_count);
}

function createStatCard(label, value, detail, href = null) {
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

  if (!href) {
    return card;
  }

  const link = document.createElement("a");
  link.className = "stat-card-link";
  link.href = href;
  link.setAttribute("aria-label", `${label} (${value})`);
  link.append(card);
  return link;
}

function getSnapshotListUrl(kind) {
  return `./snapshot-list.html?kind=${encodeURIComponent(kind)}`;
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

function createStatusChip(label, extraClass = "") {
  const chip = document.createElement("span");
  chip.className = `status-chip${extraClass ? ` ${extraClass}` : ""}`;
  chip.textContent = label;
  return chip;
}

function getCocCompetitionEvents(events = []) {
  return events.filter((eventRow) => (eventRow.coverage_section || "non_coc") === "coc_competition");
}

function getCocCompetitionResultCount(events = []) {
  return getCocCompetitionEvents(events).reduce(
    (sum, eventRow) => sum + Number(eventRow.result_count || 0),
    0
  );
}

function getEntityUrl(type, id) {
  return `./entity.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
}

function getEventUrl(eventId) {
  return `./event.html?id=${encodeURIComponent(eventId)}`;
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

function buildEventResultsTable(resultRows, { showOverallRank = false, showCategoryRank = false, showDivision = true } = {}) {
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
    place.textContent = overallRank == null ? "—" : formatNumber(overallRank);
    tr.append(place);

    if (showCategoryRank) {
      const categoryRank = document.createElement("td");
      categoryRank.className = "is-numeric";
      categoryRank.textContent = resultRow.category_rank == null ? "—" : formatNumber(resultRow.category_rank);
      tr.append(categoryRank);
    }

    const competitor = document.createElement("td");
    const competitorName = document.createElement("div");
    competitorName.append(
      resultRow.individual_id
        ? createEntityLink("person", resultRow.individual_id, resultRow.competitor_name || "(unnamed competitor)")
        : document.createTextNode(resultRow.competitor_name || "(unnamed competitor)")
    );
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

function isEventInlineNavigable(row) {
  return Boolean(row?.event_id);
}

function createEventNameNode(row, onToggle) {
  const label = row.event_name || "Untitled event";
  if (!row?.event_id) {
    const span = document.createElement("span");
    span.textContent = label;
    return span;
  }

  if (!isEventInlineNavigable(row)) {
    const link = document.createElement("a");
    link.className = "event-link";
    link.href = getEventUrl(row.event_id);
    link.textContent = label;
    return link;
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
      "COC Competitions",
      formatNumber(summary.competitions),
      `${summary.competition_event_date_min} to ${summary.competition_event_date_max}`,
      getSnapshotListUrl("competitions")
    ),
    createStatCard("COC Results", formatNumber(summary.results), `${summary.result_event_date_min} to ${summary.result_event_date_max}`),
    createStatCard("Newsletter Issues", formatNumber(summary.newsletter_issues), `${summary.newsletter_date_min} to ${summary.newsletter_date_max}`),
    createStatCard(
      "People",
      formatNumber(summary.individuals),
      `${formatNumber(summary.teams)} teams`,
      getSnapshotListUrl("people")
    ),
    createStatCard(
      "Competition Venues",
      formatNumber(summary.competition_venues),
      `${formatNumber(summary.competition_only_venues)} competition-only, ${formatNumber(summary.mixed_use_venues)} mixed-use`,
      getSnapshotListUrl("competition-venues")
    )
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
    ...rows.map((row) => getCocCompetitionEvents(row.events || []).length),
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
    const cocCompetitionEvents = getCocCompetitionEvents(events);
    const competitionEventCount = cocCompetitionEvents.length;
    const competitionEventsWithResultsCount = cocCompetitionEvents.filter(
      (eventRow) => Number(eventRow.result_count || 0) > 0
    ).length;
    const cocCompetitionResultCount = getCocCompetitionResultCount(events);

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
    meta.textContent = `COC Competitions: ${formatNumber(competitionEventCount)} ; With Results: ${formatNumber(competitionEventsWithResultsCount)} ; Result Count: ${formatNumber(cocCompetitionResultCount)}`;

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
          venue.append(
            createEntityLink("venue", eventRow.venue_id, eventRow.venue_name || "Unknown venue")
          );

          const date = document.createElement("td");
          date.textContent = formatDate(eventRow.event_date);

          const results = document.createElement("td");
          results.textContent = formatEventResultsValue(eventRow);

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

    // Series subsections
    const yearSeries = row.series || [];
    if (yearSeries.length > 0) {
      const seriesWrap = document.createElement("section");
      seriesWrap.className = "coverage-subsection";

      const seriesHead = document.createElement("button");
      seriesHead.type = "button";
      seriesHead.className = "coverage-subsection-head";
      seriesHead.setAttribute("aria-expanded", "false");

      const seriesBody = document.createElement("div");
      seriesBody.className = "coverage-subsection-body";
      seriesBody.id = `coverage-events-${row.year}-series`;
      seriesBody.hidden = true;
      seriesHead.setAttribute("aria-controls", seriesBody.id);

      const seriesTitle = document.createElement("h3");
      seriesTitle.textContent = "Event Series";

      const seriesMeta = document.createElement("span");
      seriesMeta.className = "coverage-subsection-meta";
      const seriesCount = document.createElement("span");
      seriesCount.className = "coverage-subsection-count";
      seriesCount.textContent = `${yearSeries.length} series`;
      const seriesCaret = document.createElement("span");
      seriesCaret.className = "coverage-subsection-caret";
      seriesCaret.setAttribute("aria-hidden", "true");
      seriesCaret.textContent = "▾";

      seriesMeta.append(seriesCount, seriesCaret);
      seriesHead.append(seriesTitle, seriesMeta);
      seriesWrap.append(seriesHead, seriesBody);

      yearSeries
        .sort((a, b) => (a.series_name || "").localeCompare(b.series_name || ""))
        .forEach((seriesInfo) => {
          const seriesSection = document.createElement("div");
          seriesSection.className = "series-group";

          const groupTitle = document.createElement("h4");
          groupTitle.className = "series-group-title";
          groupTitle.textContent = seriesInfo.series_name;

          const groupMeta = document.createElement("span");
          groupMeta.className = "muted";
          groupMeta.textContent = ` — ${formatNumber(seriesInfo.event_count)} events, ${formatNumber(seriesInfo.result_count)} results`;
          groupTitle.append(groupMeta);

          seriesSection.append(groupTitle);

          // Get events for this series from the year's events
          const seriesEvents = events
            .filter((e) => e.series_name === seriesInfo.series_name)
            .sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));

          if (seriesEvents.length > 0) {
            const tableWrap = document.createElement("div");
            tableWrap.className = "table-wrap";

            const table = document.createElement("table");
            table.className = "coverage-events-table";

            const thead = document.createElement("thead");
            const headRow = document.createElement("tr");
            ["#", "Event Name", "Venue", "Date", "Results"].forEach((labelText) => {
              const th = document.createElement("th");
              th.textContent = labelText;
              headRow.append(th);
            });
            thead.append(headRow);

            const tbody = document.createElement("tbody");
            seriesEvents.forEach((eventRow) => {
              const tr = document.createElement("tr");
              tr.className = "event-summary-row";

              const num = document.createElement("td");
              num.textContent = eventRow.series_number != null ? `#${eventRow.series_number}` : "";

              const eventName = document.createElement("td");
              eventName.append(
                createEventNameNode(eventRow, (button) => {
                  void toggleInlineEventDetail({
                    button,
                    eventId: eventRow.event_id,
                    hostRow: tr,
                    colspan: 5,
                  });
                })
              );

              const venue = document.createElement("td");
              venue.append(
                createEntityLink("venue", eventRow.venue_id, eventRow.venue_name || "Unknown venue")
              );

              const date = document.createElement("td");
              date.textContent = formatDate(eventRow.event_date);

              const results = document.createElement("td");
              results.textContent = formatEventResultsValue(eventRow);

              tr.append(num, eventName, venue, date, results);
              tbody.append(tr);
            });

            table.append(thead, tbody);
            tableWrap.append(table);
            seriesSection.append(tableWrap);
          }

          seriesBody.append(seriesSection);
        });

      seriesHead.addEventListener("click", () => {
        const expanded = seriesHead.getAttribute("aria-expanded") === "true";
        const nextExpanded = !expanded;
        if (!nextExpanded) {
          closeInlineDetailWithin(seriesBody);
        }
        seriesHead.setAttribute("aria-expanded", String(nextExpanded));
        seriesBody.hidden = !nextExpanded;
        seriesWrap.classList.toggle("is-expanded", nextExpanded);
      });

      sections.append(seriesWrap);
    }

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

function createEmptyTableRow(colspan, message) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = colspan;
  td.className = "muted";
  td.textContent = message;
  tr.append(td);
  return tr;
}

function renderRecentEventTable(targetId, rows) {
  const target = document.getElementById(targetId);
  if (!target) return;

  if (!rows?.length) {
    target.replaceChildren(createEmptyTableRow(4, "No events in this slice yet."));
    return;
  }

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
          colspan: 4,
        });
      })
    );

    const venue = document.createElement("td");
    venue.append(createEntityLink("venue", row.venue_id, row.venue_name || "Unknown venue"));

    const results = document.createElement("td");
    results.textContent = formatEventResultsValue(row);

    tr.append(date, eventName, venue, results);
    return tr;
  });
  target.replaceChildren(...items);
}

function renderRecentEvents(rows) {
  renderRecentEventTable("recent-events", rows);
}

function renderRecentResultEvents(rows) {
  renderRecentEventTable("recent-result-events", rows);
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

function getSearchIndexCandidates() {
  return getDataCandidates("search-index.json");
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

async function fetchSearchIndex() {
  if (searchIndexCache.entries) {
    return searchIndexCache.entries;
  }

  const attempts = [];

  for (const candidate of getSearchIndexCandidates()) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) {
        attempts.push(`${candidate} -> HTTP ${response.status}`);
        continue;
      }

      const entries = await response.json();
      searchIndexCache.entries = entries;
      searchIndexCache.fuse = window.Fuse
        ? new window.Fuse(entries, {
            threshold: 0.34,
            ignoreLocation: true,
            includeMatches: true,
            minMatchCharLength: 2,
            keys: [
              { name: "name", weight: 0.75 },
              { name: "aliases", weight: 0.25 },
            ],
          })
        : null;
      return entries;
    } catch (error) {
      attempts.push(`${candidate} -> ${error.message}`);
    }
  }

  throw new Error(attempts.join(" | "));
}

function buildSearchResults(query) {
  const trimmed = query.trim();
  if (trimmed.length < 2 || !searchIndexCache.entries?.length) {
    return [];
  }

  if (searchIndexCache.fuse) {
    return searchIndexCache.fuse.search(trimmed, { limit: 8 });
  }

  const normalized = trimmed.toLowerCase();
  return searchIndexCache.entries
    .filter((entry) => [entry.name, ...(entry.aliases || [])].some((value) => value.toLowerCase().includes(normalized)))
    .slice(0, 8)
    .map((item) => ({ item, matches: [] }));
}

function createHighlightedText(text, indices = []) {
  if (!indices?.length) {
    return document.createTextNode(text);
  }

  const fragment = document.createDocumentFragment();
  let cursor = 0;

  indices.forEach(([start, end]) => {
    if (cursor < start) {
      fragment.append(document.createTextNode(text.slice(cursor, start)));
    }

    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end + 1);
    fragment.append(mark);
    cursor = end + 1;
  });

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }

  return fragment;
}

function getMatchedAlias(result) {
  const aliasMatch = result.matches?.find((match) => match.key === "aliases");
  if (!aliasMatch || !Array.isArray(result.item.aliases)) {
    return null;
  }

  const aliasText = result.item.aliases[aliasMatch.refIndex];
  if (!aliasText) return null;

  return {
    text: aliasText,
    indices: aliasMatch.indices,
  };
}

function buildSearchSubtitle(entry, aliasMatch) {
  const parts = [];

  if (aliasMatch) {
    parts.push(`Alias: ${aliasMatch.text}`);
  }

  if (entry.type === "person") {
    if (entry.event_count) parts.push(`${formatNumber(entry.event_count)} events`);
    if (entry.role_count) parts.push(`${formatNumber(entry.role_count)} roles`);
    if (entry.mention_count) parts.push(`${formatNumber(entry.mention_count)} mentions`);
  } else if (entry.type === "organization") {
    if (entry.result_count) parts.push(`${formatNumber(entry.result_count)} results`);
    if (entry.event_count) parts.push(`${formatNumber(entry.event_count)} affiliated events`);
    if (entry.organized_event_count) parts.push(`${formatNumber(entry.organized_event_count)} organized events`);
  } else {
    if (entry.event_count) parts.push(`${formatNumber(entry.event_count)} events`);
    if (entry.mention_count) parts.push(`${formatNumber(entry.mention_count)} mentions`);
  }

  return parts.length ? parts.join(" · ") : "No exported detail";
}

function setSearchResultActive(container, nextIndex) {
  [...container.querySelectorAll(".search-result")].forEach((node, index) => {
    node.classList.toggle("is-active", index === nextIndex);
  });
}

function setupHeroSearch(entries) {
  const input = document.getElementById("hero-search-input");
  const results = document.getElementById("hero-search-results");

  if (!input || !results || !entries?.length) {
    return;
  }

  const shell = input.closest(".hero-search");
  const state = {
    results: [],
    activeIndex: -1,
  };

  const hideResults = () => {
    state.results = [];
    state.activeIndex = -1;
    results.hidden = true;
    results.replaceChildren();
  };

  const navigateToResult = (result) => {
    window.location.href = getEntityUrl(result.item.type, result.item.id);
  };

  const renderSearchResults = () => {
    if (!state.results.length) {
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.textContent = "No matching person, venue, or club.";
      results.replaceChildren(empty);
      results.hidden = false;
      return;
    }

    const items = state.results.map((result, index) => {
      const aliasMatch = getMatchedAlias(result);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `search-result${index === state.activeIndex ? " is-active" : ""}`;
      button.addEventListener("mouseenter", () => {
        state.activeIndex = index;
        setSearchResultActive(results, index);
      });
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      button.addEventListener("click", () => {
        navigateToResult(result);
      });

      const head = document.createElement("div");
      head.className = "search-result-head";

      const title = document.createElement("span");
      title.className = "search-result-title";
      const nameMatch = result.matches?.find((match) => match.key === "name");
      title.append(createHighlightedText(result.item.name, nameMatch?.indices));

      const badgeLabel =
        result.item.type === "person"
          ? "Person"
          : result.item.type === "organization"
            ? "Club"
            : "Venue";
      const badge = createStatusChip(badgeLabel, "subtle");
      head.append(title, badge);

      const meta = document.createElement("div");
      meta.className = "search-result-meta";
      meta.textContent = buildSearchSubtitle(result.item, aliasMatch);

      if (aliasMatch) {
        const aliasLine = document.createElement("div");
        aliasLine.className = "search-result-alias";
        aliasLine.append("Matched alias: ", createHighlightedText(aliasMatch.text, aliasMatch.indices));
        button.append(head, meta, aliasLine);
      } else {
        button.append(head, meta);
      }

      return button;
    });

    results.replaceChildren(...items);
    results.hidden = false;
  };

  const runSearch = () => {
    state.results = buildSearchResults(input.value);
    state.activeIndex = state.results.length ? 0 : -1;
    renderSearchResults();
  };

  input.addEventListener("input", () => {
    if (input.value.trim().length < 2) {
      hideResults();
      return;
    }
    runSearch();
  });

  input.addEventListener("focus", () => {
    if (input.value.trim().length >= 2) {
      runSearch();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (!state.results.length) {
      if (event.key === "Escape") {
        hideResults();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.activeIndex = (state.activeIndex + 1) % state.results.length;
      setSearchResultActive(results, state.activeIndex);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.activeIndex = (state.activeIndex - 1 + state.results.length) % state.results.length;
      setSearchResultActive(results, state.activeIndex);
      return;
    }

    if (event.key === "Enter" && state.activeIndex >= 0) {
      event.preventDefault();
      navigateToResult(state.results[state.activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      hideResults();
    }
  });

  document.addEventListener("click", (event) => {
    if (!shell?.contains(event.target)) {
      hideResults();
    }
  });
}

function createInlineDetailShell(
  titleText,
  summaryText,
  { metaNodes = [], bodyNodes = [], bodyText = "", onClose, headControls = [] } = {}
) {
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

  const actions = [];

  if (headControls?.length) {
    actions.push(...headControls);
  }

  if (onClose) {
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "ghost-button";
    closeButton.textContent = "Collapse";
    closeButton.addEventListener("click", onClose);
    actions.push(closeButton);
  }

  if (actions.length) {
    const controls = document.createElement("div");
    controls.className = "event-inline-actions";
    controls.append(...actions);
    head.append(controls);
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

  const categoryRanked = hasCategoryRankedResults(course.results);

  if (categoryRanked) {
    const buckets = groupResultsByCategory(course.results);
    buckets.forEach((b) => { if (b.label === "Unspecified") b.label = "Public"; });
    buckets.sort((a, b) => {
      if (a.label === "Public") return -1;
      if (b.label === "Public") return 1;
      return a.label.localeCompare(b.label);
    });

    buckets.forEach((bucket) => {
      const bucketSection = document.createElement("div");
      bucketSection.className = "event-course-category";
      const bucketTitle = document.createElement("h4");
      bucketTitle.textContent = bucket.label;
      bucketSection.append(bucketTitle);
      const bucketTableWrap = document.createElement("div");
      bucketTableWrap.className = "table-wrap";
      bucketTableWrap.append(
        buildEventResultsTable(bucket.rows, {
          showOverallRank: false,
          showCategoryRank: bucket.label !== "Public",
          showDivision: false,
        })
      );
      bucketSection.append(bucketTableWrap);
      article.append(bucketSection);
    });
  } else {
    const tableWrap = document.createElement("div");
    tableWrap.className = "table-wrap";
    tableWrap.append(
      buildEventResultsTable(course.results, {
        showOverallRank: false,
        showCategoryRank: false,
        showDivision: true,
      })
    );
    article.append(tableWrap);
  }

  return article;
}

function buildEventDetailShell(detail, onClose) {
  const statusLabel = formatEventStatusLabel(detail.event_status);
  const facts = [
    createDetailFact("Date", formatDate(detail.event_date)),
    createDetailFact(
      "Venue",
      createEntityLink("venue", detail.venue_id, detail.venue_name || "Unknown venue")
    ),
    createDetailFact(
      "Club",
      createEntityLink("organization", detail.organizing_club_id, detail.organizing_club_name || "Unknown club")
    ),
    ...(statusLabel ? [createDetailFact("Status", statusLabel)] : []),
    createDetailFact("Results", formatEventResultsValue(detail)),
    createDetailFact("Courses", formatNumber(detail.course_count)),
    createDetailFact("Citations", formatNumber(detail.citation_count)),
  ];

  const courseCards = (detail.courses || []).map(createCourseCard);
  const openLink = document.createElement("a");
  openLink.className = "ghost-button ghost-link-button";
  openLink.href = getEventUrl(detail.event_id);
  openLink.textContent = "Open Event Page";

  return createInlineDetailShell(
    detail.event_name || "Untitled event",
    [
      formatDate(detail.event_date),
      detail.event_kind || "unknown kind",
      ...(statusLabel ? [`Status: ${statusLabel}`] : []),
      detail.venue_name || "Unknown venue",
      Number(detail.result_count || 0) > 0
        ? `Results from: ${detail.result_source_brief || "source not yet linked"}`
        : statusLabel
          ? "No result rows expected in the current snapshot"
          : "No result rows captured yet",
    ].join(" · "),
    {
      metaNodes: facts,
      bodyNodes: courseCards,
      bodyText:
        Number(detail.result_count || 0) > 0
          ? null
          : statusLabel === "Cancelled"
            ? "This event was cancelled. No result rows are expected in the current snapshot."
            : statusLabel
              ? `This event is marked ${statusLabel.toLowerCase()} in the source archive, and no result rows are exported in the current snapshot.`
              : "This event is in inventory, but no result rows are captured in the current snapshot.",
      onClose,
      headControls: [openLink],
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
    generatedAt.textContent = `Snapshot exported ${formatTimestamp(data.generated_at)}`;

    renderStats(data.summary);
    renderCoverage(data.coverage_by_year);
    renderStackList("source-documents", data.source_documents, "document_type", "count");
    renderStackList("result-statuses", data.result_statuses, "status", "count");
    renderRecentEvents(data.recent_events);
    renderRecentResultEvents(data.recent_result_events || []);
    renderPipelineSummary(data.newsletter_pipeline_summary);
    renderPipeline(data.newsletter_pipeline);
    window.Project77Search?.setup();
  } catch (error) {
    generatedAt.textContent = error.message.includes("HTTP(S)")
      ? "Snapshot unavailable on file://"
      : "Snapshot unavailable";
    generatedAt.classList.add("muted");
    console.error(error);
  }
}

main();
