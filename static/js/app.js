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
  });
});

window.addEventListener("resize", () => {
  moveSideNavIndicator(document.querySelector(".side-nav-btn.active"));
});

requestAnimationFrame(() => moveSideNavIndicator(document.querySelector(".side-nav-btn.active")));

// ---------- Data loading ----------
async function loadData() {
  try {
    const res = await fetch("/api/data");
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    state.data = json;
    renderMetrics();
    renderTables();
    renderTicker();
  } catch (err) {
    document.getElementById("metric-grid").innerHTML = "";
    document.getElementById("ticker-track").innerHTML = `<span class="ticker-item ticker-loading">Live intelligence unavailable right now</span>`;
    showError(err.message);
  }
}

// ---------- Live ticker ----------
function renderTicker() {
  const { power_rankings, top_scorers, group_difficulty, predictions } = state.data;
  const topPick = [...predictions].sort((a, b) => b.confidence_score - a.confidence_score)[0];

  const items = [
    power_rankings[0] && `<span class="ticker-label">Top Favorite</span> <strong>${power_rankings[0].team}</strong>`,
    top_scorers[0] && `<span class="ticker-label">Golden Boot</span> <strong>${top_scorers[0].player}</strong> (${top_scorers[0].goals})`,
    group_difficulty[0] && `<span class="ticker-label">Toughest Group</span> <strong>Group ${group_difficulty[0].group_name}</strong>`,
    topPick && `<span class="ticker-label">Highest Confidence</span> <strong>${topPick.home_team} vs ${topPick.away_team}</strong> — ${topPick.predicted_result}`,
  ].filter(Boolean);

  const track = document.getElementById("ticker-track");
  const html = items
    .map((item) => `<span class="ticker-item"><span class="ticker-dot"></span>${item}</span>`)
    .join("");

  track.innerHTML = html + html;
}

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
      (row) => `<tr>${columns.map(([key]) => `<td>${row[key] ?? ""}</td>`).join("")}</tr>`
    )
    .join("");

  return `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderTables() {
  const { power_rankings, top_scorers, stadiums, group_difficulty, predictions } = state.data;

  document.getElementById("table-rankings").innerHTML = buildTable(power_rankings, [
    ["world_rank", "Rank"],
    ["team", "Team"],
    ["group_name", "Group"],
    ["team_strength", "Strength"],
    ["title_contender_tier", "Tier"],
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
    ["avg_group_strength", "Avg Strength"],
    ["strongest_team_score", "Strongest Team Score"],
  ]);

  document.getElementById("match-card-grid").innerHTML = buildMatchCards(predictions);
}

function confidenceTier(pct) {
  if (pct >= 70) return "high";
  if (pct >= 45) return "mid";
  return "low";
}

function buildMatchCards(predictions) {
  if (!predictions || !predictions.length) {
    return `<p class="empty-state">No predictions available.</p>`;
  }

  return predictions
    .map((p) => {
      const pct = Math.round(p.confidence_score <= 1 ? p.confidence_score * 100 : p.confidence_score);
      const tier = confidenceTier(pct);

      return `
        <div class="match-card">
          <div class="match-meta">
            <span>${p.local_date ?? ""}</span>
            <span>Group ${p.group_name ?? "—"}</span>
          </div>
          <div class="match-teams">
            <span class="match-team home">${p.home_team}</span>
            <span class="match-result">${p.predicted_result}</span>
            <span class="match-team away">${p.away_team}</span>
          </div>
          <div class="match-footer">
            <span class="confidence-pill ${tier}">${pct}% confidence</span>
            <span class="insight-tag">${p.insight_type ?? ""}</span>
          </div>
          <p class="match-analysis">${p.ai_match_analysis ?? ""}</p>
        </div>
      `;
    })
    .join("");
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
  const matches = predictions.filter((p) => p.home_team === teamName || p.away_team === teamName);

  spotlight.innerHTML = `
    <button class="spotlight-close" id="spotlight-close" aria-label="Close">&times;</button>
    <div class="spotlight-header">
      <h2>${team.team}</h2>
      <span class="spotlight-tier">${team.title_contender_tier ?? "—"}</span>
    </div>
    <div class="spotlight-stats">
      <div><span class="stat-label">World Rank</span><span class="stat-value">#${team.world_rank}</span></div>
      <div><span class="stat-label">Strength</span><span class="stat-value">${team.team_strength}</span></div>
      <div><span class="stat-label">Group</span><span class="stat-value">${team.group_name}</span></div>
      <div><span class="stat-label">Group Strength</span><span class="stat-value">${groupInfo ? groupInfo.avg_group_strength : "—"}</span></div>
    </div>
    ${
      scorers.length
        ? `<h3>Top Scorers</h3>
           <ul class="spotlight-list">
             ${scorers.map((s) => `<li>${s.player} — ${s.goals} goals</li>`).join("")}
           </ul>`
        : ""
    }
    ${
      matches.length
        ? `<h3>Predicted Matches</h3>
           <ul class="spotlight-list">
             ${matches
               .map(
                 (m) =>
                   `<li>${m.home_team} vs ${m.away_team} — ${m.predicted_result} (confidence ${m.confidence_score})</li>`
               )
               .join("")}
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
