(function setupEventCharts(global) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MINUTE_CS = 6000;
  const FIVE_MINUTES_CS = 30000;
  const TEN_MINUTES_CS = 60000;

  function normalizeTimingIntervals(rows = []) {
    return rows
      .map((row) => ({
        courseId: row?.course_id || "",
        courseName: row?.course_name || "Unnamed course",
        start: Number(row?.start_centiseconds),
        finish: Number(row?.finish_centiseconds),
        count: Number(row?.runner_count || 1),
      }))
      .filter((row) => (
        Number.isFinite(row.start)
        && Number.isFinite(row.finish)
        && row.start >= 0
        && row.finish > row.start
        && row.finish <= 8640000
        && Number.isFinite(row.count)
        && row.count > 0
      ));
  }

  function normalizeControlPunches(rows = []) {
    return rows
      .map((row) => ({
        courseId: row?.course_id || "",
        courseName: row?.course_name || "Unnamed course",
        controlCode: String(row?.control_code || "").trim(),
        time: Number(row?.time_bucket_centiseconds),
        count: Number(row?.punch_count || 0),
      }))
      .filter((row) => (
        row.controlCode
        && Number.isFinite(row.time)
        && row.time >= 0
        && row.time <= 8640000
        && Number.isFinite(row.count)
        && row.count > 0
      ));
  }

  function mapToObject(map) {
    return Object.fromEntries(
      [...map.entries()]
        .filter(([, value]) => value > 0)
        .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true })),
    );
  }

  function buildOccupancySeries(intervals) {
    const deltas = new Map();
    const addDelta = (time, courseName, amount) => {
      if (!deltas.has(time)) deltas.set(time, new Map());
      const courseDeltas = deltas.get(time);
      courseDeltas.set(courseName, (courseDeltas.get(courseName) || 0) + amount);
    };

    intervals.forEach((row) => {
      addDelta(row.start, row.courseName, row.count);
      addDelta(row.finish, row.courseName, -row.count);
    });

    const active = new Map();
    return [...deltas.keys()].sort((a, b) => a - b).map((time) => {
      deltas.get(time).forEach((amount, courseName) => {
        const next = (active.get(courseName) || 0) + amount;
        if (next > 0) active.set(courseName, next);
        else active.delete(courseName);
      });
      const byCourse = mapToObject(active);
      return {
        time,
        total: Object.values(byCourse).reduce((sum, value) => sum + value, 0),
        byCourse,
      };
    });
  }

  function buildRollingRateSeries(intervals, windowCs = TEN_MINUTES_CS, stepCs = MINUTE_CS) {
    if (!intervals.length) return [];
    const minTime = Math.floor(Math.min(...intervals.map((row) => row.start)) / stepCs) * stepCs;
    const maxTime = Math.ceil(Math.max(...intervals.map((row) => row.finish)) / stepCs) * stepCs;
    const windowMinutes = windowCs / MINUTE_CS;
    const series = [];

    for (let time = minTime; time <= maxTime; time += stepCs) {
      let starts = 0;
      let finishes = 0;
      const byCourse = new Map();
      const windowStart = time - windowCs;

      intervals.forEach((row) => {
        const startCount = row.start > windowStart && row.start <= time ? row.count : 0;
        const finishCount = row.finish > windowStart && row.finish <= time ? row.count : 0;
        if (!startCount && !finishCount) return;

        starts += startCount;
        finishes += finishCount;
        const course = byCourse.get(row.courseName) || { starts: 0, finishes: 0 };
        course.starts += startCount / windowMinutes;
        course.finishes += finishCount / windowMinutes;
        byCourse.set(row.courseName, course);
      });

      series.push({
        time,
        startRate: starts / windowMinutes,
        finishRate: finishes / windowMinutes,
        byCourse: Object.fromEntries(
          [...byCourse.entries()].sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true })),
        ),
      });
    }

    return series;
  }

  function buildControlPunchMatrix(punches) {
    const controls = [...new Set(punches.map((row) => row.controlCode))]
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const cells = new Map();
    let maxCount = 0;

    punches.forEach((row) => {
      const key = `${row.controlCode}\u0000${row.time}`;
      const cell = cells.get(key) || { total: 0, byCourse: {} };
      cell.total += row.count;
      cell.byCourse[row.courseName] = (cell.byCourse[row.courseName] || 0) + row.count;
      cells.set(key, cell);
      maxCount = Math.max(maxCount, cell.total);
    });

    return { controls, cells, maxCount };
  }

  function getActiveBreakdown(intervals, time) {
    const byCourse = new Map();
    intervals.forEach((row) => {
      if (row.start <= time && row.finish > time) {
        byCourse.set(row.courseName, (byCourse.get(row.courseName) || 0) + row.count);
      }
    });
    return mapToObject(byCourse);
  }

  function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function formatClockTime(centiseconds) {
    const totalMinutes = Math.max(0, Math.round(centiseconds / MINUTE_CS));
    if (totalMinutes >= 24 * 60) return "24:00";
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const suffix = hours >= 12 ? "PM" : "AM";
    const displayHour = hours % 12 || 12;
    return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
  }

  function formatRate(value) {
    return Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }

  function niceMaximum(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const exponent = Math.floor(Math.log10(value));
    const magnitude = 10 ** exponent;
    const normalized = value / magnitude;
    const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return nice * magnitude;
  }

  function getTimeDomain(intervals) {
    const rawMin = Math.min(...intervals.map((row) => row.start));
    const rawMax = Math.max(...intervals.map((row) => row.finish));
    const min = Math.floor(rawMin / FIVE_MINUTES_CS) * FIVE_MINUTES_CS;
    let max = Math.ceil(rawMax / FIVE_MINUTES_CS) * FIVE_MINUTES_CS;
    if (max <= min) max = min + FIVE_MINUTES_CS;
    return [min, max];
  }

  function createChartSvg({ width, height, title, description }) {
    const svg = createSvgElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": `${title}. ${description}`,
      preserveAspectRatio: "xMidYMid meet",
    });
    svg.classList.add("event-load-svg");
    const titleNode = createSvgElement("title");
    titleNode.textContent = title;
    const descriptionNode = createSvgElement("desc");
    descriptionNode.textContent = description;
    svg.append(titleNode, descriptionNode);
    return svg;
  }

  function appendTimeAxis(svg, domain, dimensions, tickCount = 5) {
    const { width, height, margin } = dimensions;
    const plotWidth = width - margin.left - margin.right;
    const y = height - margin.bottom;
    const axis = createSvgElement("g", { class: "event-load-axis" });

    for (let index = 0; index < tickCount; index += 1) {
      const ratio = tickCount === 1 ? 0 : index / (tickCount - 1);
      const x = margin.left + plotWidth * ratio;
      const time = domain[0] + (domain[1] - domain[0]) * ratio;
      const line = createSvgElement("line", { x1: x, x2: x, y1: margin.top, y2: y });
      const anchor = index === 0 ? "start" : index === tickCount - 1 ? "end" : "middle";
      const label = createSvgElement("text", { x, y: y + 24, "text-anchor": anchor });
      label.textContent = formatClockTime(time);
      axis.append(line, label);
    }
    svg.append(axis);
  }

  function appendValueAxis(svg, maxValue, dimensions, { decimals = false } = {}) {
    const { width, height, margin } = dimensions;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const axis = createSvgElement("g", { class: "event-load-axis" });

    for (let index = 0; index <= 4; index += 1) {
      const ratio = index / 4;
      const y = margin.top + plotHeight * (1 - ratio);
      const value = maxValue * ratio;
      const line = createSvgElement("line", { x1: margin.left, x2: margin.left + plotWidth, y1: y, y2: y });
      const label = createSvgElement("text", { x: margin.left - 10, y: y + 4, "text-anchor": "end" });
      label.textContent = decimals ? formatRate(value) : String(Math.round(value));
      axis.append(line, label);
    }
    svg.append(axis);
  }

  function createTooltip(chartRoot) {
    const tooltip = document.createElement("div");
    tooltip.className = "event-load-tooltip";
    tooltip.hidden = true;
    chartRoot.append(tooltip);
    return tooltip;
  }

  function setTooltipContent(tooltip, heading, summaryLines, courseRows) {
    const title = document.createElement("strong");
    title.textContent = heading;
    const summary = document.createElement("div");
    summary.className = "event-load-tooltip-summary";
    summaryLines.forEach((line) => {
      const row = document.createElement("div");
      row.textContent = line;
      summary.append(row);
    });
    const courses = document.createElement("div");
    courses.className = "event-load-tooltip-courses";
    courseRows.forEach(([label, value]) => {
      const row = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = label;
      const count = document.createElement("b");
      count.textContent = value;
      row.append(name, count);
      courses.append(row);
    });
    tooltip.replaceChildren(title, summary, courses);
  }

  function attachTimeHover({ chartRoot, svg, dimensions, domain, onHover }) {
    const { width, height, margin } = dimensions;
    const plotWidth = width - margin.left - margin.right;
    const crosshair = createSvgElement("line", {
      class: "event-load-crosshair",
      y1: margin.top,
      y2: height - margin.bottom,
    });
    crosshair.setAttribute("visibility", "hidden");
    svg.append(crosshair);
    const tooltip = createTooltip(chartRoot);

    svg.addEventListener("pointermove", (event) => {
      const bounds = svg.getBoundingClientRect();
      const viewX = ((event.clientX - bounds.left) / bounds.width) * width;
      const clampedX = Math.max(margin.left, Math.min(width - margin.right, viewX));
      const ratio = (clampedX - margin.left) / plotWidth;
      const time = domain[0] + ratio * (domain[1] - domain[0]);

      crosshair.setAttribute("x1", clampedX);
      crosshair.setAttribute("x2", clampedX);
      crosshair.setAttribute("visibility", "visible");
      onHover(time, tooltip);
      tooltip.hidden = false;

      const pixelX = (clampedX / width) * bounds.width;
      tooltip.style.left = `${Math.max(8, Math.min(bounds.width - 268, pixelX + 12))}px`;
      tooltip.style.top = "12px";
    });

    svg.addEventListener("pointerleave", () => {
      crosshair.setAttribute("visibility", "hidden");
      tooltip.hidden = true;
    });
  }

  function renderOccupancyChart(chartRoot, intervals, domain) {
    const series = buildOccupancySeries(intervals);
    const dimensions = { width: 960, height: 310, margin: { top: 18, right: 18, bottom: 44, left: 54 } };
    const { width, height, margin } = dimensions;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const yMax = niceMaximum(Math.max(...series.map((point) => point.total), 1));
    const x = (time) => margin.left + ((time - domain[0]) / (domain[1] - domain[0])) * plotWidth;
    const y = (value) => margin.top + plotHeight * (1 - value / yMax);
    const svg = createChartSvg({
      width,
      height,
      title: "Runners on course over time",
      description: "A step chart of simultaneous timed runners, with hover breakdown by course.",
    });

    appendValueAxis(svg, yMax, dimensions);
    appendTimeAxis(svg, domain, dimensions);

    let linePath = `M ${x(domain[0])} ${y(0)}`;
    series.forEach((point) => { linePath += ` H ${x(point.time)} V ${y(point.total)}`; });
    linePath += ` H ${x(domain[1])}`;
    const areaPath = `${linePath} L ${x(domain[1])} ${y(0)} L ${x(domain[0])} ${y(0)} Z`;
    svg.append(
      createSvgElement("path", { class: "event-load-area", d: areaPath }),
      createSvgElement("path", { class: "event-load-line occupancy", d: linePath }),
    );

    chartRoot.replaceChildren(svg);
    attachTimeHover({
      chartRoot,
      svg,
      dimensions,
      domain,
      onHover: (time, tooltip) => {
        const byCourse = getActiveBreakdown(intervals, time);
        const total = Object.values(byCourse).reduce((sum, value) => sum + value, 0);
        setTooltipContent(
          tooltip,
          formatClockTime(time),
          [`${total.toLocaleString("en-US")} runner${total === 1 ? "" : "s"} on course`],
          Object.entries(byCourse)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], undefined, { numeric: true }))
            .map(([course, count]) => [course, count.toLocaleString("en-US")]),
        );
      },
    });
  }

  function renderRateChart(chartRoot, intervals, domain) {
    const series = buildRollingRateSeries(intervals);
    const dimensions = { width: 960, height: 310, margin: { top: 18, right: 18, bottom: 44, left: 54 } };
    const { width, height, margin } = dimensions;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const yMax = niceMaximum(Math.max(...series.flatMap((point) => [point.startRate, point.finishRate]), 0.1));
    const x = (time) => margin.left + ((time - domain[0]) / (domain[1] - domain[0])) * plotWidth;
    const y = (value) => margin.top + plotHeight * (1 - value / yMax);
    const line = (key) => series.map((point, index) => (
      `${index ? "L" : "M"} ${x(point.time)} ${y(point[key])}`
    )).join(" ");
    const svg = createChartSvg({
      width,
      height,
      title: "Ten-minute rolling start and finish rates",
      description: "Starts and finishes per minute over the preceding ten minutes, with hover breakdown by course.",
    });

    appendValueAxis(svg, yMax, dimensions, { decimals: true });
    appendTimeAxis(svg, domain, dimensions);
    svg.append(
      createSvgElement("path", { class: "event-load-line starts", d: line("startRate") }),
      createSvgElement("path", { class: "event-load-line finishes", d: line("finishRate") }),
    );

    chartRoot.replaceChildren(svg);
    attachTimeHover({
      chartRoot,
      svg,
      dimensions,
      domain,
      onHover: (time, tooltip) => {
        const index = Math.max(0, Math.min(series.length - 1, Math.round((time - series[0].time) / MINUTE_CS)));
        const point = series[index];
        const rows = Object.entries(point.byCourse)
          .sort((left, right) => (
            (right[1].starts + right[1].finishes) - (left[1].starts + left[1].finishes)
            || left[0].localeCompare(right[0], undefined, { numeric: true })
          ))
          .map(([course, values]) => [course, `${formatRate(values.starts)} S · ${formatRate(values.finishes)} F`]);
        setTooltipContent(
          tooltip,
          formatClockTime(point.time),
          [`Starts ${formatRate(point.startRate)}/min`, `Finishes ${formatRate(point.finishRate)}/min`],
          rows,
        );
      },
    });
  }

  function renderControlChart(chartRoot, punches, fallbackDomain) {
    const matrix = buildControlPunchMatrix(punches);
    if (!matrix.controls.length) {
      chartRoot.closest(".event-load-chart-card").hidden = true;
      return;
    }

    const punchMin = Math.min(...punches.map((row) => row.time));
    const punchMax = Math.max(...punches.map((row) => row.time + FIVE_MINUTES_CS));
    const domain = [Math.min(fallbackDomain[0], punchMin), Math.max(fallbackDomain[1], punchMax)];
    const rowHeight = 24;
    const dimensions = {
      width: 960,
      height: 28 + matrix.controls.length * rowHeight + 50,
      margin: { top: 18, right: 18, bottom: 44, left: 70 },
    };
    const { width, height, margin } = dimensions;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = (time) => margin.left + ((time - domain[0]) / (domain[1] - domain[0])) * plotWidth;
    const svg = createChartSvg({
      width,
      height,
      title: "Control punch load over time",
      description: "A five-minute heatmap for every control. Darker cells indicate more recorded punches.",
    });

    const grid = createSvgElement("g", { class: "event-control-grid" });
    matrix.controls.forEach((controlCode, rowIndex) => {
      const y = margin.top + rowIndex * rowHeight;
      const label = createSvgElement("text", {
        x: margin.left - 10,
        y: y + rowHeight / 2 + 4,
        "text-anchor": "end",
      });
      label.textContent = controlCode;
      grid.append(
        createSvgElement("rect", {
          class: "event-control-row",
          x: margin.left,
          y,
          width: plotWidth,
          height: rowHeight,
        }),
        label,
      );
    });
    svg.append(grid);
    appendTimeAxis(svg, domain, dimensions);

    matrix.cells.forEach((cell, key) => {
      const [controlCode, timeText] = key.split("\u0000");
      const time = Number(timeText);
      const rowIndex = matrix.controls.indexOf(controlCode);
      const opacity = 0.16 + 0.84 * Math.sqrt(cell.total / matrix.maxCount);
      svg.append(createSvgElement("rect", {
        class: "event-control-cell",
        x: x(time),
        y: margin.top + rowIndex * rowHeight + 2,
        width: Math.max(1, x(time + FIVE_MINUTES_CS) - x(time)),
        height: rowHeight - 4,
        opacity,
      }));
    });

    chartRoot.replaceChildren(svg);
    const tooltip = createTooltip(chartRoot);
    const crosshair = createSvgElement("line", {
      class: "event-load-crosshair",
      y1: margin.top,
      y2: margin.top + plotHeight,
    });
    crosshair.setAttribute("visibility", "hidden");
    svg.append(crosshair);

    svg.addEventListener("pointermove", (event) => {
      const bounds = svg.getBoundingClientRect();
      const viewX = ((event.clientX - bounds.left) / bounds.width) * width;
      const viewY = ((event.clientY - bounds.top) / bounds.height) * height;
      if (viewX < margin.left || viewX > width - margin.right || viewY < margin.top || viewY > height - margin.bottom) {
        tooltip.hidden = true;
        crosshair.setAttribute("visibility", "hidden");
        return;
      }
      const ratio = (viewX - margin.left) / plotWidth;
      const rawTime = domain[0] + ratio * (domain[1] - domain[0]);
      const time = Math.floor(rawTime / FIVE_MINUTES_CS) * FIVE_MINUTES_CS;
      const rowIndex = Math.min(matrix.controls.length - 1, Math.floor((viewY - margin.top) / rowHeight));
      const controlCode = matrix.controls[rowIndex];
      const cell = matrix.cells.get(`${controlCode}\u0000${time}`) || { total: 0, byCourse: {} };

      setTooltipContent(
        tooltip,
        `Control ${controlCode} · ${formatClockTime(time)}–${formatClockTime(time + FIVE_MINUTES_CS)}`,
        [`${cell.total.toLocaleString("en-US")} punch${cell.total === 1 ? "" : "es"}`],
        Object.entries(cell.byCourse)
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], undefined, { numeric: true }))
          .map(([course, count]) => [course, count.toLocaleString("en-US")]),
      );
      tooltip.hidden = false;
      crosshair.setAttribute("x1", x(time));
      crosshair.setAttribute("x2", x(time));
      crosshair.setAttribute("visibility", "visible");
      const pixelX = (viewX / width) * bounds.width;
      tooltip.style.left = `${Math.max(8, Math.min(bounds.width - 268, pixelX + 12))}px`;
      tooltip.style.top = `${Math.max(8, ((margin.top + rowIndex * rowHeight) / height) * bounds.height)}px`;
    });

    svg.addEventListener("pointerleave", () => {
      tooltip.hidden = true;
      crosshair.setAttribute("visibility", "hidden");
    });
  }

  function renderMeetLoadCharts(detail) {
    const panel = document.getElementById("event-load-panel");
    const intervals = normalizeTimingIntervals(detail?.timing_intervals || []);
    if (!panel || !intervals.length) {
      if (panel) panel.hidden = true;
      return;
    }

    const timedCount = intervals.reduce((sum, row) => sum + row.count, 0);
    const courseCount = new Set(intervals.map((row) => row.courseId || row.courseName)).size;
    document.getElementById("event-load-copy").textContent = (
      `Based on ${timedCount.toLocaleString("en-US")} results with paired electronic start and finish times across `
      + `${courseCount.toLocaleString("en-US")} course${courseCount === 1 ? "" : "s"}. Hover for course detail.`
    );

    const domain = getTimeDomain(intervals);
    renderOccupancyChart(document.getElementById("event-occupancy-chart"), intervals, domain);
    renderRateChart(document.getElementById("event-rate-chart"), intervals, domain);
    renderControlChart(
      document.getElementById("event-control-chart"),
      normalizeControlPunches(detail?.control_punches || []),
      domain,
    );
    panel.hidden = false;
  }

  global.Project77EventCharts = Object.freeze({
    normalizeTimingIntervals,
    normalizeControlPunches,
    buildOccupancySeries,
    buildRollingRateSeries,
    buildControlPunchMatrix,
    renderMeetLoadCharts,
  });
}(typeof window === "undefined" ? globalThis : window));
