const state = {
  data: null,
};

// ---------- Sidebar navigation ----------
const sideNav = document.getElementById("side-nav");
const sideNavIndicator = document.getElementById("side-nav-indicator");
const sideNavButtons = document.querySelectorAll(".side-nav-btn");
const tabPanels = document.querySelectorAll(".tab-panel");
const headerTitle = document.getElementById("header-title");

function moveSideNavIndicator(btn) {
  if (!btn) return;
  sideNavIndicator.style.height = `${btn.offsetHeight}px`;
  sideNavIndicator.style.transform = `translateY(${btn.offsetTop}px)`;
}

sideNavButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    sideNavButtons.forEach((b) => b.classList.remove("active"));
    tabPanels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
    headerTitle.textContent = btn.querySelector("span").textContent;
    moveSideNavIndicator(btn);
    closeMobileMenu();
  });
});

window.addEventListener("resize", () => {
  moveSideNavIndicator(document.querySelector(".side-nav-btn.active"));
});

requestAnimationFrame(() => moveSideNavIndicator(document.querySelector(".side-nav-btn.active")));

// ---------- Mobile menu drawer ----------
const menuToggle = document.getElementById("menu-toggle");
const sidebarEl = document.querySelector(".sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");

function closeMobileMenu() {
  sidebarEl.classList.remove("open");
  sidebarOverlay.classList.remove("open");
}

menuToggle.addEventListener("click", () => {
  sidebarEl.classList.toggle("open");
  sidebarOverlay.classList.toggle("open");
});

sidebarOverlay.addEventListener("click", closeMobileMenu);

// ---------- Data loading ----------
async function loadData() {
  try {
    const res = await fetch("/api/data");
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    // gold_ai_match_analysis includes placeholder rows for not-yet-determined
    // knockout matches (null teams, "Draw", 0 confidence) — drop them so they
    // don't pollute the predictions tab, confidence tiers, or match lookups.
    json.predictions = (json.predictions ?? []).filter((p) => p.home_team && p.away_team);
    state.data = json;
    state.tiers = buildTiers(json);
    state.standings = computeStandings(json.match_details ?? []);
    state.teamsByName = {};
    json.power_rankings.forEach((r) => {
      state.teamsByName[r.team] = r;
    });
    renderMetrics();
    renderTables();
    renderTicker();
    renderStandings();
    renderScheduleFilters();
    renderSchedule();
    renderBracket();
  } catch (err) {
    document.getElementById("metric-grid").innerHTML = "";
    document.getElementById("ticker-track").innerHTML = `<span class="ticker-item ticker-loading">Live intelligence unavailable right now</span>`;
    showError(err.message);
  }
}

// ---------- Match data helpers ----------
const GROUP_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const STAGE_LABELS = { R32: "Round of 32", R16: "Round of 16", QF: "Quarterfinal", SF: "Semifinal", FINAL: "Final", "3RD": "3rd Place Match" };

function toNum(value) {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function isFinished(match) {
  return match.match_status === "TRUE";
}

function isGroupStage(match) {
  return GROUP_LETTERS.includes(match.group_name);
}

function groupLabel(groupName) {
  return GROUP_LETTERS.includes(groupName) ? `Group ${groupName}` : STAGE_LABELS[groupName] ?? groupName;
}

function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

function parseLocalDate(str) {
  if (!str) return null;
  const [datePart, timePart] = str.split(" ");
  const [mm, dd, yyyy] = datePart.split("/").map(Number);
  const [hh, min] = (timePart || "0:0").split(":").map(Number);
  return new Date(yyyy, mm - 1, dd, hh, min);
}

function formatMatchDate(str) {
  const date = parseLocalDate(str);
  if (!date) return "";
  const day = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

// Scorer fields come back as Postgres-array-style strings, inconsistently quoted
// (straight or curly quotes) e.g. {"J. Quiñones 9'","R. Jiménez 67'"} or "null".
function parseScorers(raw) {
  if (!raw || raw === "null") return [];
  const matches = raw.match(/["“”]([^"“”]+)["“”]/g);
  if (!matches) return [];
  return matches.map((m) => {
    const text = m.slice(1, -1);
    const minuteMatch = text.match(/(\d+(?:\+\d+)?)'\s*$/);
    if (!minuteMatch) return { name: text.trim(), minute: null };
    return { name: text.slice(0, minuteMatch.index).trim(), minute: minuteMatch[1] };
  });
}

function getTeamMatches(teamName) {
  return (state.data.match_details ?? []).filter((m) => m.home_team === teamName || m.away_team === teamName);
}

function teamResultBadge(match, teamName) {
  if (!isFinished(match)) return null;
  const isHome = match.home_team === teamName;
  const teamScore = toNum(isHome ? match.home_score : match.away_score);
  const oppScore = toNum(isHome ? match.away_score : match.home_score);
  if (teamScore > oppScore) return "W";
  if (teamScore < oppScore) return "L";
  return "D";
}

// ---------- Group standings ----------
function computeStandings(matchDetails) {
  const groupStageMatches = matchDetails.filter(isGroupStage);
  const groups = {};

  groupStageMatches.forEach((m) => {
    if (!groups[m.group_name]) groups[m.group_name] = {};
    [m.home_team, m.away_team].forEach((team) => {
      if (team && !groups[m.group_name][team]) {
        groups[m.group_name][team] = { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 };
      }
    });
  });

  groupStageMatches.filter(isFinished).forEach((m) => {
    const groupTeams = groups[m.group_name];
    const home = groupTeams[m.home_team];
    const away = groupTeams[m.away_team];
    if (!home || !away) return;

    const homeScore = toNum(m.home_score);
    const awayScore = toNum(m.away_score);

    home.played += 1;
    away.played += 1;
    home.gf += homeScore;
    home.ga += awayScore;
    away.gf += awayScore;
    away.ga += homeScore;

    if (homeScore > awayScore) {
      home.won += 1;
      away.lost += 1;
    } else if (homeScore < awayScore) {
      away.won += 1;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
    }
  });

  const standings = {};
  Object.entries(groups).forEach(([groupName, teams]) => {
    const rows = Object.values(teams).map((t) => ({ ...t, gd: t.gf - t.ga, pts: t.won * 3 + t.drawn }));
    rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
    standings[groupName] = rows;
  });

  return standings;
}

// ---------- Relative tiers (the raw model scores aren't percentages, so we
// rank teams/matches against each other instead of showing the bare number) ----------
function quantileTierFn(values, labels) {
  const sorted = values.map(Number).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);

  return (raw) => {
    const value = Number(raw);
    if (Number.isNaN(value) || !sorted.length) return labels[1];
    const percentile = sorted.filter((v) => v <= value).length / sorted.length;
    if (percentile >= 0.7) return labels[0];
    if (percentile >= 0.35) return labels[1];
    return labels[2];
  };
}

function buildTiers(data) {
  return {
    strength: quantileTierFn(data.power_rankings.map((r) => r.team_strength), ["Elite", "Competitive", "Underdog"]),
    groupDifficulty: quantileTierFn(data.group_difficulty.map((g) => g.avg_group_strength), ["Brutal", "Balanced", "Lighter"]),
    groupTopTeam: quantileTierFn(data.group_difficulty.map((g) => g.strongest_team_score), ["Elite", "Strong", "Average"]),
    confidence: quantileTierFn(data.predictions.map((p) => p.confidence_score), ["High Confidence", "Medium Confidence", "Low Confidence"]),
  };
}

const CONFIDENCE_CLASS = {
  "High Confidence": "high",
  "Medium Confidence": "mid",
  "Low Confidence": "low",
};

function matchOutcome(p) {
  const result = (p.predicted_result || "").toLowerCase();
  if (result.includes("home")) return { text: `${p.home_team} favored to win`, side: "home" };
  if (result.includes("away")) return { text: `${p.away_team} favored to win`, side: "away" };
  if (result.includes("draw")) return { text: "Even matchup — draw expected", side: null };
  return { text: p.predicted_result ?? "", side: null };
}

// ---------- Match narrative ----------
// The upstream ai_match_analysis column is a flat template ("X has a team
// strength score of Y...") that reads the same for every match. We write our
// own narrative client-side instead, pulling in world rank gap, insight_type,
// and group difficulty so the wording actually varies with the matchup.
const NARRATIVE_TEMPLATES = {
  home: {
    "Strong favorite": [
      (h, a, gap) => `${h} go in as clear favorites over ${a}, backed by a ${gap}-place world ranking gap — this looks like a routine result on paper.`,
      (h, a) => `${h} should have too much for ${a} here; the gulf in class points to a comfortable home win.`,
    ],
    "Moderate favorite": [
      (h, a) => `${h} carry the edge at home against ${a}, though there's enough quality on both sides to keep this interesting.`,
      (h, a) => `Expect ${h} to nose ahead of ${a}, but nothing here is a foregone conclusion.`,
    ],
    "Close match": [
      (h, a) => `${h} get the slightest of nods at home, but this one against ${a} is shaping up tight.`,
      (h, a) => `Wafer-thin margins separate ${h} and ${a} — home advantage may be the deciding factor.`,
    ],
  },
  away: {
    "Strong favorite": [
      (h, a, gap) => `${a} travel with a big edge, ${gap} places clear of ${h} in the world rankings — a routine away win looks likely.`,
      (h, a) => `${a} should deal comfortably with ${h} on the road; the gap in quality is significant.`,
    ],
    "Moderate favorite": [
      (h, a) => `${a} carry the edge into this away trip against ${h}, though it's far from a sure thing.`,
      (h, a) => `Expect ${a} to edge it on the road, but ${h} will fancy their chances of a shock result.`,
    ],
    "Close match": [
      (h, a) => `${a} are given a slight nod away from home, but ${h} could easily turn this one around.`,
      (h, a) => `Razor-thin gap here — ${a} travel with a marginal edge over ${h}.`,
    ],
  },
  draw: [
    (h, a) => `${h} and ${a} look evenly matched on paper — this one could easily finish level.`,
    (h, a) => `Little to separate ${h} and ${a}; don't be surprised if this ends in a draw.`,
  ],
};

function pickTemplate(list, seedKey) {
  let hash = 0;
  for (let i = 0; i < seedKey.length; i++) hash = (hash * 31 + seedKey.charCodeAt(i)) >>> 0;
  return list[hash % list.length];
}

function buildMatchNarrative(p) {
  const outcome = matchOutcome(p);
  const home = state.teamsByName?.[p.home_team];
  const away = state.teamsByName?.[p.away_team];
  const rankGap = home && away ? Math.abs(toNum(home.world_rank) - toNum(away.world_rank)) : null;

  const seedKey = `${p.home_team}|${p.away_team}|${p.local_date}`;
  let sentence;

  if (outcome.side === null) {
    sentence = pickTemplate(NARRATIVE_TEMPLATES.draw, seedKey)(p.home_team, p.away_team);
  } else {
    const bucket = NARRATIVE_TEMPLATES[outcome.side][p.insight_type] ?? NARRATIVE_TEMPLATES[outcome.side]["Close match"];
    sentence = pickTemplate(bucket, seedKey)(p.home_team, p.away_team, rankGap);
  }

  // group_difficulty is pre-sorted hardest-first; only call out the genuinely
  // toughest few groups so the clause stays meaningful instead of showing up everywhere
  const groupRank = state.data.group_difficulty.findIndex((g) => g.group_name === p.group_name);
  const GROUP_CLAUSES = [
    (g) => ` Both sides also have to survive a brutal Group ${g}.`,
    (g) => ` It's also one of the toughest groups in the draw, Group ${g}.`,
  ];
  const groupClause = groupRank >= 0 && groupRank < 3 ? pickTemplate(GROUP_CLAUSES, seedKey)(p.group_name) : "";

  const confidenceTier = state.tiers.confidence(p.confidence_score);
  const CONFIDENCE_CLOSERS = [
    (t) => ` Model confidence: ${t}.`,
    (t) => ` (${t} pick.)`,
  ];
  const confidenceClause = pickTemplate(CONFIDENCE_CLOSERS, seedKey + "c")(confidenceTier);

  return `${sentence}${groupClause}${confidenceClause}`;
}

// ---------- Live ticker ----------
function renderTicker() {
  const { power_rankings, top_scorers, group_difficulty, predictions } = state.data;
  const topPick = [...predictions].sort((a, b) => b.confidence_score - a.confidence_score)[0];

  const items = [
    power_rankings[0] && `<span class="ticker-label">Top Favorite</span> <strong>${power_rankings[0].team}</strong>`,
    top_scorers[0] && `<span class="ticker-label">Golden Boot</span> <strong>${top_scorers[0].player}</strong> (${top_scorers[0].goals})`,
    group_difficulty[0] && `<span class="ticker-label">Toughest Group</span> <strong>Group ${group_difficulty[0].group_name}</strong>`,
    topPick && `<span class="ticker-label">Top Pick</span> <strong>${matchOutcome(topPick).text}</strong>`,
  ].filter(Boolean);

  const track = document.getElementById("ticker-track");
  const html = items
    .map((item) => `<span class="ticker-item"><span class="ticker-dot"></span>${item}</span>`)
    .join("");

  track.innerHTML = html + html;
}

function renderStandings() {
  const grid = document.getElementById("standings-grid");
  const groupNames = Object.keys(state.standings).sort();

  if (!groupNames.length) {
    grid.innerHTML = `<p class="empty-state">No standings available yet.</p>`;
    return;
  }

  grid.innerHTML = groupNames
    .map((groupName) => {
      const rows = state.standings[groupName];
      const body = rows
        .map((r, i) => {
          const positionClass = i < 2 ? "qualified" : i === 2 ? "third-place" : "";
          return `
            <tr class="${positionClass}">
              <td>${i + 1}</td>
              <td><button class="team-link" data-team="${r.team}">${r.team}</button></td>
              <td>${r.played}</td>
              <td>${r.won}</td>
              <td>${r.drawn}</td>
              <td>${r.lost}</td>
              <td>${r.gf}</td>
              <td>${r.ga}</td>
              <td>${r.gd > 0 ? "+" + r.gd : r.gd}</td>
              <td><strong>${r.pts}</strong></td>
            </tr>
          `;
        })
        .join("");

      return `
        <div class="standings-card">
          <h3>Group ${groupName}</h3>
          <table class="standings-table">
            <thead>
              <tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      `;
    })
    .join("");
}

// ---------- Match schedule ----------
function renderScheduleFilters() {
  const stages = Object.keys(state.standings).sort();
  const knockoutStages = ["R32", "R16", "QF", "SF", "3RD", "FINAL"];
  const el = document.getElementById("schedule-filters");

  el.innerHTML = `
    <select id="schedule-group-filter">
      <option value="All">All Stages</option>
      ${stages.map((g) => `<option value="${g}">Group ${g}</option>`).join("")}
      ${knockoutStages.map((g) => `<option value="${g}">${groupLabel(g)}</option>`).join("")}
    </select>
    <select id="schedule-status-filter">
      <option value="all">All Matches</option>
      <option value="finished">Finished</option>
      <option value="upcoming">Upcoming</option>
    </select>
  `;

  document.getElementById("schedule-group-filter").addEventListener("change", renderSchedule);
  document.getElementById("schedule-status-filter").addEventListener("change", renderSchedule);
}

function buildScheduleRow(m) {
  const finished = isFinished(m);
  const home = m.home_team ?? "TBD";
  const away = m.away_team ?? "TBD";
  const score = finished ? `${m.home_score}–${m.away_score}` : "vs";

  return `
    <button class="schedule-row" data-match-id="${m.match_id}">
      <span class="schedule-stage">${groupLabel(m.group_name)}</span>
      <span class="schedule-date">${formatMatchDate(m.local_date)}</span>
      <span class="schedule-matchup">
        <span class="schedule-team">${home}</span>
        <span class="schedule-score${finished ? " final" : ""}">${score}</span>
        <span class="schedule-team">${away}</span>
      </span>
      <span class="schedule-status ${finished ? "status-finished" : "status-upcoming"}">${finished ? "Finished" : "Upcoming"}</span>
    </button>
  `;
}

function renderSchedule() {
  const matches = state.data.match_details ?? [];
  const groupFilter = document.getElementById("schedule-group-filter")?.value ?? "All";
  const statusFilter = document.getElementById("schedule-status-filter")?.value ?? "all";

  let rows = matches;
  if (groupFilter !== "All") rows = rows.filter((m) => m.group_name === groupFilter);
  if (statusFilter === "finished") rows = rows.filter(isFinished);
  if (statusFilter === "upcoming") rows = rows.filter((m) => !isFinished(m));

  rows = [...rows].sort((a, b) => parseLocalDate(a.local_date) - parseLocalDate(b.local_date));

  const list = document.getElementById("schedule-list");
  list.innerHTML = rows.length ? rows.map(buildScheduleRow).join("") : `<p class="empty-state">No matches found.</p>`;
}

// ---------- Match details modal ----------
function openMatchModal(matchId) {
  const match = (state.data.match_details ?? []).find((m) => String(m.match_id) === String(matchId));
  if (!match) return;

  const finished = isFinished(match);
  const timeline = [
    ...parseScorers(match.home_scorers).map((g) => ({ ...g, side: "home" })),
    ...parseScorers(match.away_scorers).map((g) => ({ ...g, side: "away" })),
  ].sort((a, b) => parseInt(a.minute, 10) - parseInt(b.minute, 10));

  const prediction = !finished
    ? (state.data.predictions ?? []).find((p) => p.home_team === match.home_team && p.away_team === match.away_team)
    : null;

  let middleSection;
  if (timeline.length) {
    middleSection = `<div class="modal-timeline">
      ${timeline
        .map(
          (g) => `
            <div class="timeline-row ${g.side}">
              <span class="timeline-minute">${g.minute}'</span>
              <span class="timeline-name">${g.name}</span>
            </div>
          `
        )
        .join("")}
     </div>`;
  } else if (finished) {
    middleSection = `<p class="modal-empty">No goals scored.</p>`;
  } else if (prediction) {
    const tierLabel = state.tiers.confidence(prediction.confidence_score);
    middleSection = `
      <div class="modal-prediction">
        <span class="stat-label">AI Prediction</span>
        <p class="modal-prediction-text">${buildMatchNarrative(prediction)}</p>
        <span class="confidence-pill ${CONFIDENCE_CLASS[tierLabel]}">${tierLabel}</span>
      </div>
    `;
  } else {
    middleSection = `<p class="modal-empty">Match hasn't kicked off yet — no prediction available.</p>`;
  }

  document.getElementById("match-modal-card").innerHTML = `
    <button class="modal-close" id="match-modal-close" aria-label="Close">&times;</button>
    <div class="modal-stage">${groupLabel(match.group_name)} · ${formatMatchDate(match.local_date)}</div>
    <div class="modal-teams">
      <span class="modal-team">${match.home_team ?? "TBD"}</span>
      <span class="modal-score">${finished ? `${match.home_score} – ${match.away_score}` : "vs"}</span>
      <span class="modal-team">${match.away_team ?? "TBD"}</span>
    </div>
    ${middleSection}
    <div class="modal-venue">
      <span class="stat-label">Stadium</span>
      <span class="stat-value">${match.stadium_name ?? "—"}</span>
      <span class="modal-venue-sub">${[match.city, match.country].filter(Boolean).join(", ")}</span>
    </div>
  `;

  document.getElementById("match-modal-overlay").classList.remove("hidden");
}

function closeMatchModal() {
  document.getElementById("match-modal-overlay").classList.add("hidden");
}

document.addEventListener("click", (e) => {
  if (e.target.id === "match-modal-close" || e.target.id === "match-modal-overlay") {
    closeMatchModal();
  }
  const scheduleRow = e.target.closest(".schedule-row");
  if (scheduleRow) openMatchModal(scheduleRow.dataset.matchId);
  const matchRow = e.target.closest(".match-row");
  if (matchRow && matchRow.dataset.matchId) openMatchModal(matchRow.dataset.matchId);
  const teamLink = e.target.closest(".team-link");
  if (teamLink) showTeamSpotlight(teamLink.dataset.team);
});

function showError(message) {
  const main = document.getElementById("tab-panels");
  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.textContent = `Something went wrong: ${message}`;
  main.prepend(banner);
}

function renderMetrics() {
  const { power_rankings, top_scorers, stadiums, group_difficulty } = state.data;
  const grid = document.getElementById("metric-grid");
  const items = [
    ["Top Favorite", power_rankings[0]?.team],
    ["Golden Boot Leader", top_scorers[0]?.player],
    ["Most Used Stadium", stadiums[0]?.stadium_name],
    ["Hardest Group", group_difficulty[0] ? `Group ${group_difficulty[0].group_name}` : null],
  ];

  grid.innerHTML = items
    .map(
      ([label, value]) => `
        <div class="metric-card">
          <div class="metric-label">${label}</div>
          <div class="metric-value">${value ?? "—"}</div>
        </div>
      `
    )
    .join("");
}

function buildTable(rows, columns) {
  if (!rows || !rows.length) {
    return `<p class="empty-state">No data available.</p>`;
  }

  const headers = columns.map(([, label]) => `<th>${label}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map(([key, , formatter]) => `<td>${formatter ? formatter(row[key], row) : row[key] ?? ""}</td>`)
          .join("")}</tr>`
    )
    .join("");

  return `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderTables() {
  const { power_rankings, top_scorers, stadiums, group_difficulty, predictions } = state.data;
  const { groupDifficulty, groupTopTeam } = state.tiers;

  document.getElementById("table-rankings").innerHTML = buildTable(power_rankings, [
    ["world_rank", "Rank"],
    ["team", "Team"],
    ["group_name", "Group"],
  ]);

  document.getElementById("table-scorers").innerHTML = buildTable(top_scorers, [
    ["player", "Player"],
    ["team", "Team"],
    ["goals", "Goals"],
  ]);

  document.getElementById("table-stadiums").innerHTML = buildTable(stadiums, [
    ["stadium_name", "Stadium"],
    ["city", "City"],
    ["country", "Country"],
    ["matches_hosted", "Matches Hosted"],
  ]);

  document.getElementById("table-groups").innerHTML = buildTable(group_difficulty, [
    ["group_name", "Group"],
    ["avg_group_strength", "Difficulty", groupDifficulty],
    ["strongest_team_score", "Toughest Team", groupTopTeam],
  ]);

  document.getElementById("match-card-grid").innerHTML = buildMatchCards(predictions);
}

function buildMatchCards(predictions) {
  if (!predictions || !predictions.length) {
    return `<p class="empty-state">No predictions available.</p>`;
  }

  const { confidence } = state.tiers;

  return predictions
    .map((p) => {
      const outcome = matchOutcome(p);
      const tierLabel = confidence(p.confidence_score);

      return `
        <div class="match-card">
          <div class="match-meta">
            <span>${p.local_date ?? ""}</span>
            <span>Group ${p.group_name ?? "—"}</span>
          </div>
          <div class="match-teams">
            <span class="match-team home${outcome.side === "home" ? " favored" : ""}">${p.home_team}</span>
            <span class="match-result">vs</span>
            <span class="match-team away${outcome.side === "away" ? " favored" : ""}">${p.away_team}</span>
          </div>
          <p class="match-outcome">${outcome.text}</p>
          <div class="match-footer">
            <span class="confidence-pill ${CONFIDENCE_CLASS[tierLabel]}">${tierLabel}</span>
            <span class="insight-tag">${p.insight_type ?? ""}</span>
          </div>
          <p class="match-analysis">${buildMatchNarrative(p)}</p>
        </div>
      `;
    })
    .join("");
}

// ---------- Knockout bracket (projected from standings, simulated forward) ----------
function teamStrengthMap() {
  const map = {};
  state.data.power_rankings.forEach((r) => {
    map[r.team] = toNum(r.team_strength);
  });
  return map;
}

function getQualifiers() {
  const winners = [];
  const runnersUp = [];
  const thirds = [];

  Object.entries(state.standings).forEach(([groupName, rows]) => {
    if (rows[0]) winners.push({ ...rows[0], group_name: groupName });
    if (rows[1]) runnersUp.push({ ...rows[1], group_name: groupName });
    if (rows[2]) thirds.push({ ...rows[2], group_name: groupName });
  });

  thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

  return { winners, runnersUp, qualifyingThirds: thirds.slice(0, 8) };
}

// FIFA only locks in the official Round of 32 slot assignment for third-placed
// teams after the group stage ends (495 possible combinations). This builds a
// reasonable stand-in: strongest group winners face the qualifying third-place
// teams, the rest face runners-up, never against a team from their own group.
function projectRound32() {
  const strength = teamStrengthMap();
  const byStrengthDesc = (a, b) => (strength[b.team] ?? 0) - (strength[a.team] ?? 0);

  const { winners, runnersUp, qualifyingThirds } = getQualifiers();
  const sortedWinners = [...winners].sort(byStrengthDesc);
  const sortedRunnersUp = [...runnersUp].sort(byStrengthDesc);
  const sortedThirds = [...qualifyingThirds].sort(byStrengthDesc);

  const used = new Set();
  function takeOpponent(pool, excludeGroup) {
    let candidate = pool.find((c) => !used.has(c.team) && c.group_name !== excludeGroup);
    if (!candidate) candidate = pool.find((c) => !used.has(c.team));
    if (candidate) used.add(candidate.team);
    return candidate;
  }

  const pairs = [];
  sortedWinners.slice(0, 8).forEach((w) => pairs.push([w, takeOpponent(sortedThirds, w.group_name)]));
  sortedWinners.slice(8, 12).forEach((w) => pairs.push([w, takeOpponent(sortedRunnersUp, w.group_name)]));

  const leftoverRunnersUp = sortedRunnersUp.filter((r) => !used.has(r.team));
  for (let i = 0; i < Math.floor(leftoverRunnersUp.length / 2); i++) {
    pairs.push([leftoverRunnersUp[i], leftoverRunnersUp[leftoverRunnersUp.length - 1 - i]]);
  }

  return pairs.filter(([a, b]) => a && b);
}

function simulateWinner(teamA, teamB) {
  if (!teamA) return teamB ?? null;
  if (!teamB) return teamA;
  const strength = teamStrengthMap();
  const sa = strength[teamA.team] ?? 0;
  const sb = strength[teamB.team] ?? 0;
  if (sa === sb) return teamA.team.localeCompare(teamB.team) < 0 ? teamA : teamB;
  return sa > sb ? teamA : teamB;
}

function chunkPairs(list) {
  const pairs = [];
  for (let i = 0; i < list.length; i += 2) {
    pairs.push([list[i], list[i + 1]]);
  }
  return pairs;
}

function buildBracketRounds() {
  const r32 = projectRound32();
  const r32Winners = r32.map(([a, b]) => simulateWinner(a, b));

  const r16 = chunkPairs(r32Winners);
  const r16Winners = r16.map(([a, b]) => simulateWinner(a, b));

  const qf = chunkPairs(r16Winners);
  const qfWinners = qf.map(([a, b]) => simulateWinner(a, b));

  const sf = chunkPairs(qfWinners);
  const sfWinners = sf.map(([a, b]) => simulateWinner(a, b));
  const sfLosers = sf.map(([a, b]) => (simulateWinner(a, b) === a ? b : a));

  const champion = simulateWinner(sfWinners[0], sfWinners[1]);

  return {
    r32,
    r16,
    qf,
    sf,
    final: [sfWinners],
    third: [sfLosers],
    champion,
  };
}

function bracketMatchHtml([a, b]) {
  const winner = simulateWinner(a, b);
  return `
    <div class="bracket-match">
      <div class="bracket-team${winner === a ? " winner" : ""}">${a ? a.team : "TBD"}</div>
      <div class="bracket-team${winner === b ? " winner" : ""}">${b ? b.team : "TBD"}</div>
    </div>
  `;
}

function bracketRoundHtml(title, pairs) {
  return `
    <div class="bracket-round">
      <div class="bracket-round-title">${title}</div>
      ${pairs.map(bracketMatchHtml).join("")}
    </div>
  `;
}

function renderBracket() {
  const bracket = document.getElementById("bracket");
  if (!Object.keys(state.standings).length) {
    bracket.innerHTML = `<p class="empty-state">Standings unavailable, can't project a bracket.</p>`;
    return;
  }

  const rounds = buildBracketRounds();

  bracket.innerHTML =
    bracketRoundHtml("Round of 32", rounds.r32) +
    bracketRoundHtml("Round of 16", rounds.r16) +
    bracketRoundHtml("Quarterfinals", rounds.qf) +
    bracketRoundHtml("Semifinals", rounds.sf) +
    bracketRoundHtml("Final", rounds.final) +
    `<div class="bracket-champion">
       <span class="stat-label">Projected Champion</span>
       <span class="stat-value">${rounds.champion ? rounds.champion.team : "—"}</span>
     </div>`;
}

// ---------- Team search ----------
const searchInput = document.getElementById("team-search");
const searchResults = document.getElementById("search-results");
const spotlight = document.getElementById("team-spotlight");

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim().toLowerCase();

  if (!query || !state.data) {
    searchResults.classList.add("hidden");
    searchResults.innerHTML = "";
    return;
  }

  const matches = state.data.power_rankings
    .filter((row) => row.team.toLowerCase().includes(query))
    .slice(0, 8);

  searchResults.innerHTML = matches.length
    ? matches
        .map(
          (row) => `
            <button class="search-result" data-team="${row.team}">
              <span><span class="search-result-rank">#${row.world_rank}</span>${row.team}</span>
              <span class="search-result-group">Group ${row.group_name}</span>
            </button>
          `
        )
        .join("")
    : `<div class="search-empty">No teams found</div>`;

  searchResults.classList.remove("hidden");
});

searchResults.addEventListener("click", (e) => {
  const btn = e.target.closest(".search-result");
  if (!btn) return;
  showTeamSpotlight(btn.dataset.team);
  searchResults.classList.add("hidden");
  searchInput.value = btn.dataset.team;
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) {
    searchResults.classList.add("hidden");
  }
});

function showTeamSpotlight(teamName) {
  const { power_rankings, top_scorers, group_difficulty, predictions } = state.data;
  const team = power_rankings.find((r) => r.team === teamName);
  if (!team) return;

  const groupInfo = group_difficulty.find((g) => g.group_name === team.group_name);
  const scorers = top_scorers.filter((s) => s.team === teamName);

  const predictionByTeams = {};
  predictions.forEach((p) => {
    predictionByTeams[`${p.home_team}|${p.away_team}`] = p;
  });

  const teamMatches = [...getTeamMatches(teamName)].sort((a, b) => parseLocalDate(a.local_date) - parseLocalDate(b.local_date));
  const recent = teamMatches.filter(isFinished).slice(-5).reverse();
  const upcoming = teamMatches.filter((m) => !isFinished(m)).slice(0, 5);

  const standingRows = state.standings[team.group_name] ?? [];
  const standingPos = standingRows.findIndex((r) => r.team === teamName);
  const standingText = standingPos >= 0 ? `${standingPos + 1}${ordinalSuffix(standingPos + 1)} in Group ${team.group_name}` : "—";

  spotlight.innerHTML = `
    <button class="spotlight-close" id="spotlight-close" aria-label="Close">&times;</button>
    <div class="spotlight-header">
      <h2>${team.team}</h2>
      <span class="spotlight-tier">${team.title_contender_tier ?? "—"}</span>
    </div>
    <div class="spotlight-stats">
      <div><span class="stat-label">World Rank</span><span class="stat-value">#${team.world_rank}</span></div>
      <div><span class="stat-label">Strength</span><span class="stat-value">${state.tiers.strength(team.team_strength)}</span></div>
      <div><span class="stat-label">Standing</span><span class="stat-value">${standingText}</span></div>
      <div><span class="stat-label">Group Difficulty</span><span class="stat-value">${groupInfo ? state.tiers.groupDifficulty(groupInfo.avg_group_strength) : "—"}</span></div>
    </div>
    ${
      recent.length
        ? `<h3>Recent Results</h3>
           <ul class="spotlight-list match-list">
             ${recent
               .map((m) => {
                 const opponent = m.home_team === teamName ? m.away_team : m.home_team;
                 const badge = teamResultBadge(m, teamName);
                 const teamScore = m.home_team === teamName ? m.home_score : m.away_score;
                 const oppScore = m.home_team === teamName ? m.away_score : m.home_score;
                 return `
                   <li class="match-row" data-match-id="${m.match_id}">
                     <span class="result-badge result-${badge}">${badge}</span>
                     <span class="match-row-opponent">vs ${opponent}</span>
                     <span class="match-row-score">${teamScore}–${oppScore}</span>
                   </li>
                 `;
               })
               .join("")}
           </ul>`
        : ""
    }
    ${
      upcoming.length
        ? `<h3>Upcoming Fixtures</h3>
           <ul class="spotlight-list match-list">
             ${upcoming
               .map((m) => {
                 const opponent = m.home_team === teamName ? m.away_team : m.home_team;
                 const pred = predictionByTeams[`${m.home_team}|${m.away_team}`];
                 return `
                   <li class="match-row" data-match-id="${m.match_id}">
                     <span class="match-row-date">${formatMatchDate(m.local_date)}</span>
                     <span class="match-row-opponent">vs ${opponent}</span>
                     ${pred ? `<span class="match-row-pick">${matchOutcome(pred).text}</span>` : ""}
                   </li>
                 `;
               })
               .join("")}
           </ul>`
        : ""
    }
    ${
      scorers.length
        ? `<h3>Top Scorers</h3>
           <ul class="spotlight-list">
             ${scorers.map((s) => `<li>${s.player} — ${s.goals} goals</li>`).join("")}
           </ul>`
        : ""
    }
  `;
  spotlight.classList.remove("hidden");
}

document.addEventListener("click", (e) => {
  if (e.target.id === "spotlight-close") {
    spotlight.classList.add("hidden");
  }
});

// ---------- Chat ----------
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");
const chatSend = document.getElementById("chat-send");

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function boldify(str) {
  return str.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function formatChatText(text) {
  const lines = text.split("\n");
  let html = "";
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const isBullet = line.startsWith("- ") || line.startsWith("* ");

    if (isBullet) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${boldify(escapeHtml(line.slice(2)))}</li>`;
    } else {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      if (line) html += `<p>${boldify(escapeHtml(line))}</p>`;
    }
  }

  if (inList) html += "</ul>";
  return html;
}

function appendBubble(role, text, opts = {}) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  const textHtml = opts.typing
    ? `<span class="typing-dots"><span></span><span></span><span></span></span>`
    : formatChatText(text);

  bubble.innerHTML = `
    <div class="chat-avatar">${role === "user" ? "You" : "AI"}</div>
    <div class="chat-bubble-content">
      <div class="chat-bubble-label">${role === "user" ? "You" : "Copilot"}</div>
      <div class="chat-bubble-text">${textHtml}</div>
    </div>
  `;

  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble.querySelector(".chat-bubble-text");
}

async function sendQuestion(question) {
  appendBubble("user", question);
  chatInput.value = "";
  chatSend.disabled = true;

  const textEl = appendBubble("ai", "", { typing: true });
  let buffer = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Request failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let raw = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });

      const events = raw.split("\n\n");
      raw = events.pop();

      for (const event of events) {
        const line = event.trim();
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;

        const parsed = JSON.parse(payload);
        if (parsed.error) throw new Error(parsed.error);

        if (parsed.token) {
          buffer += parsed.token;
          textEl.innerHTML = formatChatText(buffer);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      }
    }
  } catch (err) {
    textEl.innerHTML = `<span class="chat-error">Sorry — something went wrong: ${err.message}</span>`;
  } finally {
    chatSend.disabled = false;
  }
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;
  sendQuestion(question);
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

loadData();
