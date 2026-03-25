const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const nameCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function formatNumber(value) {
  return numberFormatter.format(value ?? 0);
}

function formatDate(value) {
  if (!value) return "n/a";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function parseSortDate(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
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

function getSearchIndexCandidates() {
  return getDataCandidates("search-index.json");
}

function getEntityUrl(type, id) {
  return `./entity.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
}

function getEventUrl(eventId) {
  return `./event.html?id=${encodeURIComponent(eventId)}`;
}

function toNumber(value) {
  return Number(value ?? 0);
}

function compareNumberValues(a, b) {
  return toNumber(a) - toNumber(b);
}

function compareTextValues(a, b) {
  return nameCollator.compare(a || "", b || "");
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

async function fetchJson(candidates) {
  const attempts = [];

  for (const candidate of candidates) {
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

async function fetchSnapshot() {
  if (window.location.protocol === "file:") {
    throw new Error("This static viewer needs HTTP(S). Open it from GitHub Pages or a local web server.");
  }

  return fetchJson(getSnapshotCandidates());
}

async function fetchSearchIndex() {
  if (window.location.protocol === "file:") {
    throw new Error("This static viewer needs HTTP(S). Open it from GitHub Pages or a local web server.");
  }

  return fetchJson(getSearchIndexCandidates());
}

function makeTableHead(columns) {
  const head = document.getElementById("list-head");
  const row = document.createElement("tr");

  columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    row.append(th);
  });

  head.replaceChildren(row);
}

function makeSortableTableHead(columns, sortState, onSort) {
  const head = document.getElementById("list-head");
  const row = document.createElement("tr");

  columns.forEach((column) => {
    const th = document.createElement("th");
    const button = document.createElement("button");
    const isActive = sortState.key === column.key;
    const arrow = isActive ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";

    button.type = "button";
    button.className = "sort-button";
    if (column.numeric) {
      button.classList.add("is-numeric");
      th.classList.add("is-numeric");
    }
    button.textContent = `${column.label}${arrow}`;
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    button.addEventListener("click", () => onSort(column.key));

    th.append(button);
    row.append(th);
  });

  head.replaceChildren(row);
}

function createEmptyRow(message) {
  const body = document.getElementById("list-body");
  const empty = document.getElementById("list-empty");

  body.replaceChildren();
  empty.textContent = message;
  empty.hidden = false;
}

function clearEmpty() {
  const empty = document.getElementById("list-empty");
  empty.textContent = "";
  empty.hidden = true;
}

function getListKind() {
  const kind = new URLSearchParams(window.location.search).get("kind") || "";
  if (kind === "competition_venues") {
    return "competition-venues";
  }
  return kind;
}

function getCompetitionEvents(snapshot) {
  return (snapshot.coverage_by_year || []).flatMap((yearRow) =>
    (yearRow.events || []).filter((row) => (row.coverage_section || "non_coc") === "coc_competition")
  );
}

function sortRows(rows, columns, sortState) {
  const activeColumn = columns.find((column) => column.key === sortState.key) || columns[0];
  const directionMultiplier = sortState.direction === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => directionMultiplier * activeColumn.compare(a, b));
}

function renderCompetitions(snapshot) {
  const rows = getCompetitionEvents(snapshot)
    .slice()
    .sort((a, b) => parseSortDate(a.event_date) - parseSortDate(b.event_date) || nameCollator.compare(a.event_name || "", b.event_name || ""));

  makeTableHead(["Date", "Competition", "Venue", "Organizing Club", "Results"]);
  clearEmpty();

  const body = document.getElementById("list-body");
  if (!rows.length) {
    createEmptyRow("No competition events were exported in this snapshot.");
    return;
  }

  const items = rows.map((row) => {
    const tr = document.createElement("tr");

    const date = document.createElement("td");
    date.className = "is-numeric";
    date.textContent = formatDate(row.event_date);

    const competition = document.createElement("td");
    if (row.event_id) {
      const link = document.createElement("a");
      link.className = "entity-link";
      link.href = getEventUrl(row.event_id);
      link.textContent = row.event_name || "Untitled competition";
      competition.append(link);
    } else {
      competition.textContent = row.event_name || "Untitled competition";
    }

    const venue = document.createElement("td");
    venue.append(createEntityLink("venue", row.venue_id, row.venue_name || "Unknown venue"));

    const organizingClub = document.createElement("td");
    organizingClub.append(
      createEntityLink("organization", row.organizing_club_id, row.organizing_club_name || "Unknown club")
    );

    const results = document.createElement("td");
    results.className = "is-numeric";
    results.textContent = formatNumber(row.result_count);

    tr.append(date, competition, venue, organizingClub, results);
    return tr;
  });

  body.replaceChildren(...items);
}

function renderPeople(searchIndex) {
  const rows = searchIndex
    .filter((entry) => entry.type === "person")
    .slice();

  const columns = [
    {
      label: "Person",
      key: "name",
      compare: (a, b) =>
        compareTextValues(a.name, b.name) ||
        compareNumberValues(a.event_count, b.event_count) ||
        compareNumberValues(a.role_count, b.role_count),
    },
    {
      label: "Events",
      key: "event_count",
      numeric: true,
      compare: (a, b) =>
        compareNumberValues(a.event_count, b.event_count) ||
        compareNumberValues(a.role_count, b.role_count) ||
        compareTextValues(a.name, b.name),
    },
    {
      label: "Roles",
      key: "role_count",
      numeric: true,
      compare: (a, b) =>
        compareNumberValues(a.role_count, b.role_count) ||
        compareNumberValues(a.event_count, b.event_count) ||
        compareTextValues(a.name, b.name),
    },
    {
      label: "Mentions",
      key: "mention_count",
      numeric: true,
      compare: (a, b) =>
        compareNumberValues(a.mention_count, b.mention_count) ||
        compareNumberValues(a.role_count, b.role_count) ||
        compareTextValues(a.name, b.name),
    },
  ];

  clearEmpty();
  if (!rows.length) {
    createEmptyRow("No people were exported in the search index.");
    return;
  }

  const body = document.getElementById("list-body");
  const sortState = { key: "role_count", direction: "desc" };

  function draw() {
    makeSortableTableHead(columns, sortState, (key) => {
      if (sortState.key === key) {
        sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
      } else {
        sortState.key = key;
        sortState.direction = key === "name" ? "asc" : "desc";
      }
      draw();
    });

    const items = sortRows(rows, columns, sortState).map((row) => {
      const tr = document.createElement("tr");
      const person = document.createElement("td");
      person.append(createEntityLink("person", row.id, row.name || "Unnamed person"));

      const events = document.createElement("td");
      events.className = "is-numeric";
      events.textContent = formatNumber(row.event_count);

      const roles = document.createElement("td");
      roles.className = "is-numeric";
      roles.textContent = formatNumber(row.role_count);

      const mentions = document.createElement("td");
      mentions.className = "is-numeric";
      mentions.textContent = formatNumber(row.mention_count);

      tr.append(person, events, roles, mentions);
      return tr;
    });

    body.replaceChildren(...items);
  }

  draw();
}

function renderCompetitionVenues(snapshot, searchIndex = []) {
  const venueMeta = new Map(
    searchIndex
      .filter((entry) => entry.type === "venue")
      .map((entry) => [entry.id, entry])
  );

  const byVenue = new Map();
  getCompetitionEvents(snapshot).forEach((row) => {
    const venueId = row.venue_id || `unknown::${row.venue_name || ""}`;
    const existing = byVenue.get(venueId);
    if (existing) {
      existing.competition_event_count += 1;
      return;
    }

    byVenue.set(venueId, {
      venue_id: row.venue_id || null,
      venue_name: row.venue_name || "Unknown venue",
      competition_event_count: 1,
    });
  });

  const rows = [...byVenue.values()];
  const columns = [
    {
      label: "Venue",
      key: "venue_name",
      compare: (a, b) =>
        compareTextValues(a.venue_name, b.venue_name) ||
        compareNumberValues(a.competition_event_count, b.competition_event_count),
    },
    {
      label: "Competition Events",
      key: "competition_event_count",
      numeric: true,
      compare: (a, b) =>
        compareNumberValues(a.competition_event_count, b.competition_event_count) ||
        compareNumberValues(a.mention_count, b.mention_count) ||
        compareTextValues(a.venue_name, b.venue_name),
    },
    {
      label: "Mentions",
      key: "mention_count",
      numeric: true,
      compare: (a, b) =>
        compareNumberValues(a.mention_count, b.mention_count) ||
        compareNumberValues(a.competition_event_count, b.competition_event_count) ||
        compareTextValues(a.venue_name, b.venue_name),
    },
  ];

  clearEmpty();
  if (!rows.length) {
    createEmptyRow("No competition venues were exported in this snapshot.");
    return;
  }

  rows.forEach((row) => {
    const venueDetail = row.venue_id ? venueMeta.get(row.venue_id) : null;
    row.mention_count = venueDetail?.mention_count ?? 0;
  });

  const body = document.getElementById("list-body");
  const sortState = { key: "competition_event_count", direction: "desc" };

  function draw() {
    makeSortableTableHead(columns, sortState, (key) => {
      if (sortState.key === key) {
        sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
      } else {
        sortState.key = key;
        sortState.direction = key === "venue_name" ? "asc" : "desc";
      }
      draw();
    });

    const items = sortRows(rows, columns, sortState).map((row) => {
      const tr = document.createElement("tr");

      const venue = document.createElement("td");
      if (row.venue_id) {
        const link = createEntityLink("venue", row.venue_id, row.venue_name || "Unknown venue");
        venue.append(link);
      } else {
        venue.textContent = row.venue_name || "Unknown venue";
      }

      const competitionEventCount = document.createElement("td");
      competitionEventCount.className = "is-numeric";
      competitionEventCount.textContent = formatNumber(row.competition_event_count);

      const mentions = document.createElement("td");
      mentions.className = "is-numeric";
      mentions.textContent = formatNumber(row.mention_count);

      tr.append(venue, competitionEventCount, mentions);
      return tr;
    });

    body.replaceChildren(...items);
  }

  draw();
}

async function main() {
  const title = document.getElementById("list-title");
  const subtitle = document.getElementById("list-subtitle");
  const heading = document.getElementById("list-heading");
  const description = document.getElementById("list-description");
  const generatedAt = document.getElementById("generated-at");

  try {
    const kind = getListKind();

    if (kind === "competitions") {
      title.textContent = "Competition Events";
      subtitle.textContent = "A complete date-ordered competition event list.";
      heading.textContent = "Competition Events";
      description.textContent = "All competition-row events included in this snapshot, ordered by event date.";

      const snapshot = await fetchSnapshot();
      generatedAt.textContent = `Snapshot exported ${new Date(snapshot.generated_at).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })}`;
      renderCompetitions(snapshot);
      return;
    }

    if (kind === "people") {
      title.textContent = "People";
      subtitle.textContent = "Sortable list of all indexed people, defaulting to most roles.";
      heading.textContent = "People";
      description.textContent = "Person records in the search index, sortable by person, events, roles, or mentions.";

      const [searchIndex, snapshot] = await Promise.all([
        fetchSearchIndex(),
        fetchSnapshot().catch(() => null),
      ]);

      if (snapshot?.generated_at) {
        generatedAt.textContent = `Snapshot exported ${new Date(snapshot.generated_at).toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        })}`;
      } else {
        generatedAt.textContent = "Snapshot timestamp unavailable";
      }
      renderPeople(searchIndex);
      return;
    }

    if (kind === "competition-venues") {
      title.textContent = "Competition Venues";
      subtitle.textContent = "Sortable list of venues hosting competitions, defaulting to most events.";
      heading.textContent = "Competition Venues";
      description.textContent = "Unique venues with at least one competition row, sortable by venue, competition events, or mentions.";

      const [snapshot, searchIndex] = await Promise.all([
        fetchSnapshot(),
        fetchSearchIndex().catch(() => []),
      ]);
      generatedAt.textContent = `Snapshot exported ${new Date(snapshot.generated_at).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })}`;
      renderCompetitionVenues(snapshot, searchIndex);
      return;
    }

    title.textContent = "Unknown List";
    subtitle.textContent = "Choose an available snapshot list from the home page.";
    heading.textContent = "Unavailable List";
    description.textContent = "Add a valid `kind` parameter to this page.";
    createEmptyRow("Open the snapshot totals page and choose Competitions, People, or Competition Venues.");
    generatedAt.textContent = "No list selected";
  } catch (error) {
    console.error(error);
    title.textContent = "Snapshot List Error";
    subtitle.textContent = "The requested table could not be loaded.";
    heading.textContent = "Unable to load list";
    description.textContent = "Try opening this page from an HTTP(S) server with up-to-date snapshot exports.";
    createEmptyRow(error.message);
  }
}

main();
