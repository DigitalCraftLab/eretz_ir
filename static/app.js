const state = {
  session: loadSession(),
  game: null,
  error: "",
  pollHandle: null,
  timerHandle: null,
  saveHandle: null,
  remainingSeconds: 0,
  saveStatus: "",
  drafts: {
    playerName: "",
    roomCode: "",
    categoryProposal: "",
    answers: {},
  },
  lastRoundKey: null,
  renderSnapshot: null,
  letterReveal: null,
};

const app = document.querySelector("#app");
const welcomeTemplate = document.querySelector("#welcome-template");

hydrateRoomCodeFromUrl();

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("eretz-ir-session") || "null");
  } catch {
    return null;
  }
}

function hydrateRoomCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get("room");
  if (roomCode) {
    state.drafts.roomCode = roomCode.toUpperCase();
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
    paintStatusBar();
    return;
  }
  const tick = () => {
    const endsAt = state.game.round.endsAt;
    state.remainingSeconds = endsAt ? Math.max(0, Math.ceil(endsAt - Date.now() / 1000)) : 0;
    if (state.remainingSeconds <= 1 && state.saveHandle) {
      flushAnswerSave();
    }
    paintStatusBar();
  };
  tick();
  state.timerHandle = setInterval(tick, 250);
}

function paintStatusBar() {
  const timer = document.querySelector("[data-timer]");
  if (timer) {
    timer.textContent = state.game?.round?.endsAt
      ? `נשארו ${state.remainingSeconds} שניות`
      : "הטיימר יתחיל כשמישהו יסיים את כל הטופס";
  }
  const saveState = document.querySelector("[data-save-status]");
  if (saveState) {
    saveState.textContent = state.saveStatus || "התשובות נשמרות אוטומטית";
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

async function setFinishWindow(seconds) {
  await api("/api/set-finish-window", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
    seconds,
  });
  await refreshState();
}

async function toggleCategoryVote(category) {
  await api("/api/toggle-category-vote", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
    category,
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

function scheduleAnswerSave() {
  if (!state.session || state.game?.phase !== "playing") return;
  state.saveStatus = "שומר...";
  paintStatusBar();
  clearTimeout(state.saveHandle);
  state.saveHandle = setTimeout(flushAnswerSave, 220);
}

async function flushAnswerSave() {
  if (!state.session || state.game?.phase !== "playing") return;
  clearTimeout(state.saveHandle);
  state.saveHandle = null;
  await api("/api/save-answers", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
    answers: state.drafts.answers,
  });
  state.saveStatus = "נשמר אוטומטית";
  paintStatusBar();
}

async function toggleApproval(targetPlayerId, category) {
  await api("/api/toggle-approval", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
    targetPlayerId,
    category,
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

async function advanceReview() {
  await api("/api/advance-review", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
  });
  await refreshState();
}

async function shareRoom() {
  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set("room", state.game.roomCode);
  const message = `בואו לשחק איתי ארץ עיר 🎉 קוד החדר: ${state.game.roomCode}\n${shareUrl.toString()}`;
  if (navigator.share) {
    await navigator.share({
      title: "ארץ עיר",
      text: `בואו לשחק איתי ארץ עיר 🎉 קוד החדר: ${state.game.roomCode}`,
      url: shareUrl.toString(),
    });
    return;
  }
  await navigator.clipboard.writeText(message);
  state.saveStatus = "קישור ההזמנה הועתק 📋";
  paintStatusBar();
}

function formatSource(source) {
  return source === "random" ? "הצעה אקראית" : "הוצע על ידי שחקן";
}

function formatFinishWindow(seconds) {
  return `${seconds} שניות`;
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
    state.saveStatus = "התשובות נשמרות אוטומטית";
    triggerLetterReveal(state.game.round.letter, currentRoundKey);
  }
}

function triggerLetterReveal(letter, roundKey) {
  state.letterReveal = { letter, roundKey };
  setTimeout(() => {
    if (state.letterReveal?.roundKey === roundKey) {
      state.letterReveal = null;
      render();
    }
  }, 1600);
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
      scheduleAnswerSave();
    });
  });
}

function captureRenderSnapshot() {
  const active = document.activeElement;
  if (!active || active.tagName !== "INPUT") {
    state.renderSnapshot = null;
    return;
  }
  const answerCategory = active.getAttribute("data-answer-category");
  let selector = null;
  if (active.id) {
    selector = `#${window.CSS?.escape(active.id) || active.id}`;
  } else if (answerCategory) {
    selector = `[data-answer-category="${window.CSS?.escape(answerCategory) || answerCategory}"]`;
  }
  if (!selector) {
    state.renderSnapshot = null;
    return;
  }
  state.renderSnapshot = {
    selector,
    selectionStart: active.selectionStart ?? 0,
    selectionEnd: active.selectionEnd ?? 0,
  };
}

function restoreRenderSnapshot() {
  if (!state.renderSnapshot) return;
  const input = document.querySelector(state.renderSnapshot.selector);
  if (!input) {
    state.renderSnapshot = null;
    return;
  }
  input.focus();
  if (typeof input.setSelectionRange === "function") {
    input.setSelectionRange(state.renderSnapshot.selectionStart, state.renderSnapshot.selectionEnd);
  }
  state.renderSnapshot = null;
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
        <div class="pill">קוד חדר: <strong>${escapeHtml(state.game.roomCode)}</strong> ✨</div>
        <div class="toolbar">
          <button type="button" id="share-room" class="secondary">📨 שיתוף חדר</button>
        </div>
      </div>
      <div class="sidebar-section">
        <h3>שחקנים 👥</h3>
        <div class="players-list">${players}</div>
      </div>
      <div class="sidebar-section">
        <h3>סגירת טיימר 🏁</h3>
        <div class="pill">אחרי שהראשון מסיים: ${formatFinishWindow(state.game.finishWindowSeconds)}</div>
      </div>
      <div class="sidebar-section">
        <h3>קטגוריות נעולות 🗂️</h3>
        <div class="category-chip-row">
          ${
            state.game.selectedCategories.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("") ||
            '<span class="muted">עדיין לא נבחרו 4 קטגוריות</span>'
          }
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
          <h2>בחירת קטגוריות 🎯</h2>
          <p class="status-copy">כולם יכולים להציע ולהצביע על קטגוריות. ברגע שהמארח נועל 4 קטגוריות, אפשר להתחיל.</p>
        </div>
      </div>
      ${
        isHost()
          ? `
            <div class="stack">
              <span class="field-label">כמה זמן יישאר לאחר שהראשון מסיים?</span>
              <div class="toolbar">
                ${state.game.finishWindowOptions
                  .map(
                    (seconds) => `
                      <button type="button" data-finish-window="${seconds}" class="${state.game.finishWindowSeconds === seconds ? "" : "secondary"}">
                        ${formatFinishWindow(seconds)}
                      </button>
                    `
                  )
                  .join("")}
              </div>
            </div>
          `
          : `<p class="helper">המארח הגדיר ${formatFinishWindow(state.game.finishWindowSeconds)} לשאר השחקנים אחרי שהראשון מסיים.</p>`
      }
      <form id="category-form" class="stack">
        <label>
          הצעת קטגוריה חדשה
          <input id="category-proposal" maxlength="36" value="${escapeAttr(state.drafts.categoryProposal)}" placeholder="לדוגמה: דברים שמוצאים במלון" />
        </label>
        <div class="toolbar">
          <button type="submit">➕ הוספת קטגוריה</button>
          <button type="button" id="random-categories" class="secondary">🎲 עוד הצעות</button>
        </div>
      </form>
      <div class="pill">ננעלו ${state.game.selectedCategories.length} מתוך 4 קטגוריות</div>
      <div class="category-grid">
        ${state.game.proposedCategories
          .map(
            (item) => `
            <article class="category-chip ${state.game.selectedCategories.includes(item.name) ? "selected" : ""}">
              <strong>${escapeHtml(item.name)}</strong>
              <small>${formatSource(item.source)}</small>
              <div class="toolbar">
                <span class="pill">👍 ${item.voteCount} הצבעות</span>
                <button type="button" data-category-vote="${escapeAttr(item.name)}" class="${item.votedByMe ? "" : "secondary"}">${item.votedByMe ? "בטל הצבעה" : "אני בעד"}</button>
              </div>
              ${isHost() ? `<button type="button" data-category-toggle="${escapeAttr(item.name)}" class="ghost">${state.game.selectedCategories.includes(item.name) ? "הסר" : "נעל למשחק"}</button>` : ""}
            </article>
          `
          )
          .join("")}
      </div>
      ${isHost() ? `<button id="start-game" ${canStart ? "" : "disabled"}>🚀 התחלת משחק</button>` : '<p class="helper">המארח נועל את 4 הקטגוריות ומתחיל את המשחק.</p>'}
    </section>
  `;
}

function renderPlaying() {
  const round = state.game.round;
  return `
    <section class="card stack">
      <div class="title-row">
        <div>
          <div class="pill">סבב ${round.roundNumber} מתוך ${state.game.maxRounds}</div>
          <h2>ממלאים תשובות ✍️</h2>
          <p class="status-copy">הטיימר לא רץ בהתחלה. הוא יתחיל רק כשמישהו יסיים את כל 4 התשובות, ואז לאחרים יישארו ${formatFinishWindow(state.game.finishWindowSeconds)}.</p>
        </div>
        <div class="stack">
          <div class="letter-badge">${escapeHtml(round.letter)}</div>
          <div class="timer" data-timer>הטיימר יתחיל כשמישהו יסיים את כל הטופס</div>
          <div class="muted" data-save-status>${state.saveStatus || "התשובות נשמרות אוטומטית"}</div>
        </div>
      </div>
      ${
        round.triggeredByName
          ? `<div class="pill">⏰ ${escapeHtml(round.triggeredByName)} השלים ראשון. הספירה לאחור התחילה.</div>`
          : `<div class="pill">🧠 סיימו את כל הטופס כדי להפעיל את הטיימר לשאר המשתתפים.</div>`
      }
      <form class="answers-grid">
        ${state.game.selectedCategories
          .map(
            (category) => `
              <label>
                ${escapeHtml(category)}
                <input data-answer-category="${escapeAttr(category)}" value="${escapeAttr(state.drafts.answers[category] || "")}" placeholder="מילה שמתחילה ב-${escapeAttr(round.letter)}" />
              </label>
            `
          )
          .join("")}
      </form>
    </section>
  `;
}

function renderReview() {
  const review = state.game.round.review;
  const hostActionLabel =
    review.categoryIndex === review.categoryCount - 1
      ? state.game.round.roundNumber === state.game.maxRounds
        ? "🎉 סיום משחק"
        : "➡️ לסבב הבא"
      : "➡️ לקטגוריה הבאה";

  return `
    <section class="stack">
      <div class="card stack">
        <div class="title-row">
          <div>
            <div class="pill">סבב ${state.game.round.roundNumber} הסתיים ✅</div>
            <h2>בדיקת קטגוריה: ${escapeHtml(review.currentCategory)} 🔎</h2>
            <p class="status-copy">כל המשתתפים צריכים לאשר תשובות. אישור עובד רק אם התשובה מתחילה באות הנכונה.</p>
          </div>
          <div class="stack">
            <div class="pill">אות: ${escapeHtml(state.game.round.letter)}</div>
            <div class="pill">קטגוריה ${review.categoryIndex + 1} מתוך ${review.categoryCount}</div>
          </div>
        </div>
        ${
          state.game.phase === "review" && isHost()
            ? `<button id="advance-review">${hostActionLabel}</button>`
            : state.game.phase === "review"
              ? `<p class="helper">ממתינים למארח שיעבור לקטגוריה הבאה.</p>`
              : ""
        }
      </div>
      <div class="review-list">
        ${review.entries
          .map((entry) => {
            const likedByMe = entry.likedBy.includes(state.session.player_id);
            const canApprove = state.session.player_id !== entry.playerId && entry.answer && entry.startsWithLetter;
            return `
              <article class="card review-card">
                <div class="title-row">
                  <div>
                    <h3>${escapeHtml(entry.playerName)}</h3>
                    <p class="muted">נקודות עד כה בסבב: ${entry.roundPoints}</p>
                  </div>
                  <div class="points">${entry.basePoints} נק'</div>
                </div>
                <div class="review-answer">${entry.answer ? escapeHtml(entry.answer) : "<span class='muted'>אין תשובה</span>"}</div>
                <div class="toolbar">
                  <span class="pill ${entry.startsWithLetter ? "pill-success" : "pill-danger"}">${entry.startsWithLetter ? "מתחיל באות ✅" : "לא מתחיל באות ❌"}</span>
                  <span class="pill">אישורים: ${entry.approvalCount}/${entry.approvalsNeeded}</span>
                  <span class="pill">${entry.approved ? "מאושר לניקוד 🌟" : "ממתין לאישור"}</span>
                </div>
                <div class="toolbar">
                  ${
                    state.game.phase === "review" && canApprove
                      ? `<button type="button" data-approval="${escapeAttr(entry.playerId)}" class="${entry.approvedByMe ? "" : "secondary"}">${entry.approvedByMe ? "בטל אישור" : "אשר תשובה"}</button>`
                      : ""
                  }
                  ${
                    state.game.phase === "review" && entry.playerId !== state.session.player_id
                      ? `<button type="button" data-like="${escapeAttr(entry.playerId)}" class="${likedByMe ? "" : "secondary"}">${likedByMe ? "הסר לייק" : "💖 לייק"}</button>`
                      : `<span class="pill">לייקים: ${entry.likes}</span>`
                  }
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderFinished() {
  const winner = state.game.winner;
  return `
    <section class="card winner-card stack">
      <div class="winner-burst">🎉 🏆 🎉</div>
      <div class="pill">המשחק נגמר</div>
      <h2>${escapeHtml(winner.name)} ניצח בגדול!</h2>
      <p class="winner-score">${winner.score} נקודות</p>
      <p class="status-copy">מחיאות כפיים, זיקוקים ודקה של תהילה מקומית 🎊</p>
      ${isHost() ? `<button id="restart-game">🔁 משחק חדש</button>` : ""}
    </section>
  `;
}

function renderLetterReveal() {
  if (!state.letterReveal || state.game?.phase !== "playing") return "";
  return `
    <div class="letter-reveal">
      <div class="letter-reveal-card">
        <div class="letter-reveal-emoji">✨</div>
        <p>האות שנבחרה היא</p>
        <div class="letter-reveal-letter">${escapeHtml(state.letterReveal.letter)}</div>
      </div>
    </div>
  `;
}

function renderGame() {
  captureRenderSnapshot();
  const showFinishedBanner = state.game.phase === "finished";
  const main =
    state.game.phase === "lobby"
      ? renderLobby()
      : state.game.phase === "playing"
        ? renderPlaying()
        : `${showFinishedBanner ? renderFinished() : ""}${renderReview()}`;

  app.innerHTML = `
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ""}
    ${renderLetterReveal()}
    <div class="layout">
      ${renderSidebar()}
      <section class="stack">${main}</section>
    </div>
  `;
  restoreRenderSnapshot();

  document.querySelector("#share-room")?.addEventListener("click", withErrorHandling(shareRoom));

  if (state.game.phase === "lobby") {
    attachDraftInput("#category-proposal", "categoryProposal");
    document.querySelector("#category-form")?.addEventListener("submit", withErrorHandling(proposeCategory));
    document.querySelector("#random-categories")?.addEventListener("click", withErrorHandling(addRandomCategories));
    document.querySelectorAll("[data-category-vote]").forEach((button) => {
      button.addEventListener(
        "click",
        withErrorHandling(() => toggleCategoryVote(button.getAttribute("data-category-vote")))
      );
    });
    document.querySelectorAll("[data-finish-window]").forEach((button) => {
      button.addEventListener(
        "click",
        withErrorHandling(() => setFinishWindow(Number(button.getAttribute("data-finish-window"))))
      );
    });
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
  }

  if (state.game.phase === "review" || state.game.phase === "finished") {
    document.querySelectorAll("[data-approval]").forEach((button) => {
      button.addEventListener(
        "click",
        withErrorHandling(() => toggleApproval(button.getAttribute("data-approval"), state.game.round.review.currentCategory))
      );
    });
    document.querySelectorAll("[data-like]").forEach((button) => {
      button.addEventListener(
        "click",
        withErrorHandling(() => toggleLike(button.getAttribute("data-like"), state.game.round.review.currentCategory))
      );
    });
    document.querySelector("#advance-review")?.addEventListener("click", withErrorHandling(advanceReview));
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
