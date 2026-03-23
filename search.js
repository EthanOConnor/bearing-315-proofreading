(() => {
  const numberFormatter = new Intl.NumberFormat("en-US");
  const searchIndexCache = {
    entries: null,
    fuse: null,
    promise: null,
  };

  function formatNumber(value) {
    return numberFormatter.format(value ?? 0);
  }

  function getEntityUrl(type, id) {
    return `./entity.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
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

  function getSearchIndexCandidates() {
    return getDataCandidates("search-index.json");
  }

  async function fetchSearchIndex() {
    if (searchIndexCache.entries) {
      return searchIndexCache.entries;
    }

    if (searchIndexCache.promise) {
      return searchIndexCache.promise;
    }

    searchIndexCache.promise = (async () => {
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
    })()
      .catch((error) => {
        searchIndexCache.promise = null;
        throw error;
      });

    return searchIndexCache.promise;
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

  function createStatusChip(label, extraClass = "") {
    const chip = document.createElement("span");
    chip.className = `status-chip${extraClass ? ` ${extraClass}` : ""}`;
    chip.textContent = label;
    return chip;
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

  function bindSearchUi({ input, results }) {
    if (input.dataset.project77SearchBound === "true") {
      return;
    }

    input.dataset.project77SearchBound = "true";
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

  async function setup({
    inputId = "hero-search-input",
    resultsId = "hero-search-results",
  } = {}) {
    const input = document.getElementById(inputId);
    const results = document.getElementById(resultsId);

    if (!input || !results) {
      return false;
    }

    try {
      const entries = await fetchSearchIndex();
      if (!entries?.length) {
        return false;
      }
      bindSearchUi({ input, results });
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  window.Project77Search = { setup };
})();
