const state = {
  session: loadSession(),
  game: null,
  error: "",
  pollHandle: null,
  timerHandle: null,
  remainingSeconds: 0,
  drafts: {
    playerName: "",
    roomCode: "",
    categoryProposal: "",
    answers: {},
  },
  lastRoundKey: null,
};

const app = document.querySelector("#app");
const welcomeTemplate = document.querySelector("#welcome-template");

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("eretz-ir-session") || "null");
  } catch {
    return null;
  }
}

function saveSession(session) {
  state.session = session;
  localStorage.setItem("eretz-ir-session", JSON.stringify(session));
}

function clearSession() {
  state.session = null;
  localStorage.removeItem("eretz-ir-session");
}

async function api(path, payload, method = "POST") {
  const options = { method, headers: {} };
  if (method !== "GET") {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(payload || {});
  }
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || "משהו השתבש");
  }
  return data.data;
}

function setError(message) {
  state.error = message || "";
  render();
}

function isHost() {
  return state.game && state.session && state.game.hostId === state.session.player_id;
}

function roomReady() {
  return state.game && state.game.selectedCategories.length === 4;
}

async function createRoom() {
  const name = state.drafts.playerName.trim();
  if (!name) {
    setError("צריך להזין שם");
    return;
  }
  const session = await api("/api/create-room", { name });
  saveSession(session);
  await refreshState();
}

async function joinRoom() {
  const name = state.drafts.playerName.trim();
  const roomCode = state.drafts.roomCode.trim().toUpperCase();
  if (!name || !roomCode) {
    setError("צריך להזין שם וקוד חדר");
    return;
  }
  const session = await api("/api/join-room", { name, roomCode });
  saveSession(session);
  await refreshState();
}

async function refreshState() {
  if (!state.session) {
    state.game = null;
    return;
  }
  try {
    state.game = await api(
      `/api/state?room_code=${encodeURIComponent(state.session.room_code)}&player_id=${encodeURIComponent(state.session.player_id)}`,
      null,
      "GET"
    );
    state.error = "";
    syncDraftsWithGame();
    syncTimer();
  } catch (error) {
    clearSession();
    state.game = null;
    state.error = error.message;
    state.lastRoundKey = null;
    state.drafts.answers = {};
  }
  render();
}

function startPolling() {
  clearInterval(state.pollHandle);
  state.pollHandle = setInterval(refreshState, 1000);
}

function syncTimer() {
  clearInterval(state.timerHandle);
  if (!state.game?.round || state.game.phase !== "playing") {
    state.remainingSeconds = 0;
    return;
  }
  const tick = () => {
    state.remainingSeconds = Math.max(0, Math.ceil(state.game.round.endsAt - Date.now() / 1000));
    paintTimerOnly();
  };
  tick();
  state.timerHandle = setInterval(tick, 250);
}

function paintTimerOnly() {
  const timer = document.querySelector("[data-timer]");
  if (timer) {
    timer.textContent = `נשארו ${state.remainingSeconds} שניות`;
  }
}

async function proposeCategory(event) {
  event.preventDefault();
  const category = state.drafts.categoryProposal.trim();
  if (!category) return;
  await api("/api/propose-category", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
    category,
  });
  state.drafts.categoryProposal = "";
  await refreshState();
}

async function addRandomCategories() {
  await api("/api/add-random-categories", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
  });
  await refreshState();
}

async function toggleCategory(category) {
  await api("/api/toggle-category", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
    category,
  });
  await refreshState();
}

async function startGame() {
  await api("/api/start-game", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
  });
  await refreshState();
}

async function submitAnswers(event) {
  event.preventDefault();
  await api("/api/submit-answers", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
    answers: state.drafts.answers,
  });
  await refreshState();
}

async function toggleLike(targetPlayerId, category) {
  await api("/api/toggle-like", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
    targetPlayerId,
    category,
  });
  await refreshState();
}

async function advanceRound() {
  await api("/api/advance-round", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
  });
  await refreshState();
}

function formatSource(source) {
  return source === "random" ? "הצעה אקראית" : "הוצע על ידי שחקן";
}

function syncDraftsWithGame() {
  if (state.game?.phase !== "playing" || !state.game.round) {
    state.lastRoundKey = null;
    state.drafts.answers = {};
    return;
  }
  const currentRoundKey = `${state.game.roomCode}:${state.game.round.roundNumber}`;
  if (state.lastRoundKey !== currentRoundKey) {
    state.lastRoundKey = currentRoundKey;
    state.drafts.answers = { ...(state.game.round.myAnswers || {}) };
  }
}

function attachDraftInput(selector, key, transform = (value) => value) {
  const input = document.querySelector(selector);
  if (!input) return;
  input.addEventListener("input", (event) => {
    state.drafts[key] = transform(event.currentTarget.value);
  });
}

function attachAnswerDraftInputs() {
  document.querySelectorAll("[data-answer-category]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const category = event.currentTarget.getAttribute("data-answer-category");
      state.drafts.answers[category] = event.currentTarget.value;
    });
  });
}

function renderWelcome() {
  app.innerHTML = "";
  app.appendChild(welcomeTemplate.content.cloneNode(true));
  document.querySelector("#player-name").value = state.drafts.playerName;
  document.querySelector("#room-code").value = state.drafts.roomCode;
  attachDraftInput("#player-name", "playerName");
  attachDraftInput("#room-code", "roomCode", (value) => value.toUpperCase());
  document.querySelector("#create-room").addEventListener("click", withErrorHandling(createRoom));
  document.querySelector("#join-room").addEventListener("click", withErrorHandling(joinRoom));
}

function renderSidebar() {
  const players = state.game.players
    .map(
      (player) => `
        <div class="player-row">
          <div>
            <strong>${escapeHtml(player.name)}</strong>
            <span class="muted">${player.id === state.game.hostId ? "מארח" : "שחקן"}</span>
          </div>
          <div class="points">${player.totalScore}</div>
        </div>
      `
    )
    .join("");
  return `
    <aside class="card stack">
      <div class="sidebar-section">
        <div class="pill">קוד חדר: <strong>${escapeHtml(state.game.roomCode)}</strong></div>
      </div>
      <div class="sidebar-section">
        <h3>שחקנים</h3>
        <div class="players-list">${players}</div>
      </div>
      <div class="sidebar-section">
        <h3>קטגוריות נעולות</h3>
        <div class="category-chip-row">
          ${state.game.selectedCategories.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("") || '<span class="muted">עדיין לא נבחרו 4 קטגוריות</span>'}
        </div>
      </div>
    </aside>
  `;
}

function renderLobby() {
  const canStart = isHost() && roomReady();
  return `
    <section class="card stack">
      <div class="title-row">
        <div>
          <h2>בחירת קטגוריות</h2>
          <p class="status-copy">צריך להסכים על 4 קטגוריות כלליות שיישארו לכל 4 הסבבים.</p>
        </div>
      </div>
      <form id="category-form" class="stack">
        <label>
          הצעת קטגוריה חדשה
          <input maxlength="36" value="${escapeAttr(state.drafts.categoryProposal)}" placeholder="לדוגמה: דברים שמוצאים במלון" />
        </label>
        <div class="toolbar">
          <button type="submit">הוספת קטגוריה</button>
          <button type="button" id="random-categories" class="secondary">עוד הצעות אקראיות</button>
        </div>
      </form>
      <div class="pill">נבחרו ${state.game.selectedCategories.length} מתוך 4</div>
      <div class="category-grid">
        ${state.game.proposedCategories
          .map(
            (item) => `
            <article class="category-chip ${state.game.selectedCategories.includes(item.name) ? "selected" : ""}">
              <strong>${escapeHtml(item.name)}</strong>
              <small>${formatSource(item.source)}</small>
              ${isHost() ? `<button type="button" data-category-toggle="${escapeAttr(item.name)}" class="ghost">${state.game.selectedCategories.includes(item.name) ? "הסרה" : "בחירה"}</button>` : ""}
            </article>
          `
          )
          .join("")}
      </div>
      ${isHost() ? `<button id="start-game" ${canStart ? "" : "disabled"}>התחלת משחק</button>` : '<p class="helper">המארח מסמן את 4 הקטגוריות ומתחיל את המשחק.</p>'}
    </section>
  `;
}

function renderPlaying() {
  const submitted = state.game.round.submittedPlayers.includes(state.session.player_id);
  return `
    <section class="card stack">
      <div class="title-row">
        <div>
          <div class="pill">סבב ${state.game.round.roundNumber} מתוך ${state.game.maxRounds}</div>
          <h2>ממלאים תשובות</h2>
          <p class="status-copy">כל תשובה חייבת להתחיל באות שנבחרה. תשובה זהה או מאוד דומה תיתן 5 נקודות לכל מי שהשתמש בה.</p>
        </div>
        <div class="stack">
          <div class="letter-badge">${escapeHtml(state.game.round.letter)}</div>
          <div class="timer" data-timer>נשארו ${state.remainingSeconds} שניות</div>
        </div>
      </div>
      <form id="answers-form" class="answers-grid">
        ${state.game.selectedCategories
          .map(
            (category, index) => `
              <label>
                ${escapeHtml(category)}
                <input data-answer-index="${index}" data-answer-category="${escapeAttr(category)}" value="${escapeAttr(state.drafts.answers[category] || "")}" placeholder="מילה שמתחילה ב-${escapeAttr(state.game.round.letter)}" />
              </label>
            `
          )
          .join("")}
        <div class="toolbar">
          <button type="submit" ${submitted ? "disabled" : ""}>${submitted ? "נשלח" : "שליחת תשובות"}</button>
          <span class="pill">${state.game.round.submittedPlayers.length} מתוך ${state.game.players.length} שלחו</span>
        </div>
      </form>
    </section>
  `;
}

function renderReview() {
  const reviewCards = state.game.round.reviewScores
    .map(
      (player) => `
      <article class="card review-card">
        <div class="title-row">
          <div>
            <h3>${escapeHtml(player.playerName)}</h3>
            <p class="muted">נקודות בסבב: ${player.roundPoints}</p>
          </div>
        </div>
        <div class="review-list">
          ${player.categories
            .map((item) => {
              const likedByMe = item.likedBy.includes(state.session.player_id);
              return `
                <div class="review-item ${item.valid ? "valid" : "invalid"}">
                  <div class="score-row">
                    <strong>${escapeHtml(item.category)}</strong>
                    <span class="points">${item.basePoints} נק'</span>
                  </div>
                  <p>${item.answer ? escapeHtml(item.answer) : "<span class='muted'>אין תשובה</span>"}</p>
                  <p class="muted">${item.valid ? "תשובה תקינה" : "לא מתחיל באות או חסר"}</p>
                  ${
                    player.playerId !== state.session.player_id
                      ? `<button type="button" data-like="${escapeAttr(player.playerId)}|${escapeAttr(item.category)}" class="${likedByMe ? "" : "secondary"}">${likedByMe ? "הסר לייק" : "אהבתי"} (+1)</button>`
                      : `<span class="pill">לייקים: ${item.likes}</span>`
                  }
                </div>
              `;
            })
            .join("")}
        </div>
      </article>
    `
    )
    .join("");
  return `
    <section class="stack">
      <div class="card">
        <div class="title-row">
          <div>
            <div class="pill">סבב ${state.game.round.roundNumber} הסתיים</div>
            <h2>בדיקת תשובות ולייקים</h2>
            <p class="status-copy">בסיום הדקה כל תשובה ייחודית מקבלת 10, תשובה כפולה או דומה מקבלת 5, ולייק מעניק עוד נקודה.</p>
          </div>
          ${state.game.phase === "review" && isHost() ? `<button id="advance-round">${state.game.round.roundNumber === state.game.maxRounds ? "סיום משחק" : "לסבב הבא"}</button>` : ""}
        </div>
      </div>
      ${reviewCards}
    </section>
  `;
}

function renderFinished() {
  const winner = state.game.players[0];
  return `
    <section class="card stack">
      <div class="pill">המשחק נגמר</div>
      <h2>${escapeHtml(winner.name)} ניצח עם ${winner.totalScore} נקודות</h2>
      <p class="status-copy">אפשר להתחיל משחק חדש עם אותן קטגוריות, או לפתוח חדר חדש.</p>
      ${isHost() ? `<button id="restart-game">משחק חדש</button>` : ""}
    </section>
    ${renderReview()}
  `;
}

function renderGame() {
  const main =
    state.game.phase === "lobby"
      ? renderLobby()
      : state.game.phase === "playing"
        ? renderPlaying()
        : state.game.phase === "review"
          ? renderReview()
          : renderFinished();

  app.innerHTML = `
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ""}
    <div class="layout">
      ${renderSidebar()}
      <section class="stack">${main}</section>
    </div>
  `;

  if (state.game.phase === "lobby") {
    attachDraftInput("#category-form input", "categoryProposal");
    document.querySelector("#category-form")?.addEventListener("submit", withErrorHandling(proposeCategory));
    document.querySelector("#random-categories")?.addEventListener("click", withErrorHandling(addRandomCategories));
    document.querySelectorAll("[data-category-toggle]").forEach((button) => {
      button.addEventListener(
        "click",
        withErrorHandling(() => toggleCategory(button.getAttribute("data-category-toggle")))
      );
    });
    document.querySelector("#start-game")?.addEventListener("click", withErrorHandling(startGame));
  }

  if (state.game.phase === "playing") {
    attachAnswerDraftInputs();
    document.querySelector("#answers-form")?.addEventListener("submit", withErrorHandling(submitAnswers));
  }

  if (state.game.phase === "review" || state.game.phase === "finished") {
    document.querySelectorAll("[data-like]").forEach((button) => {
      button.addEventListener(
        "click",
        withErrorHandling(() => {
          const [playerId, category] = button.getAttribute("data-like").split("|");
          return toggleLike(playerId, category);
        })
      );
    });
    document.querySelector("#advance-round")?.addEventListener("click", withErrorHandling(advanceRound));
    document.querySelector("#restart-game")?.addEventListener("click", withErrorHandling(startGame));
  }
}

function render() {
  if (!state.session || !state.game) {
    renderWelcome();
    if (state.error) {
      app.insertAdjacentHTML("afterbegin", `<div class="error-banner">${escapeHtml(state.error)}</div>`);
    }
    return;
  }
  renderGame();
}

function withErrorHandling(fn) {
  return async (event) => {
    try {
      await fn(event);
    } catch (error) {
      setError(error.message);
    }
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

startPolling();
refreshState();
render();
