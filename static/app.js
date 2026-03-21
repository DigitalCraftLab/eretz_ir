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
};

const app = document.querySelector("#app");

hydrateRoomCodeFromUrl();

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

function hydrateRoomCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get("room");
  if (roomCode) {
    state.drafts.roomCode = roomCode.toUpperCase();
    if (state.session && state.session.room_code !== state.drafts.roomCode) {
      clearSession();
    }
  }
}

async function api(path, payload, method) {
  const httpMethod = method || "POST";
  const options = { method: httpMethod, headers: {} };
  if (httpMethod !== "GET") {
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
  return !!(state.game && state.session && state.game.hostId === state.session.player_id);
}

function roomReady() {
  return !!(state.game && state.game.proposedCategories && state.game.proposedCategories.length === 4);
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
    render();
    return;
  }
  try {
    state.game = await api(
      "/api/state?room_code=" +
        encodeURIComponent(state.session.room_code) +
        "&player_id=" +
        encodeURIComponent(state.session.player_id),
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
  if (!state.game || !state.game.round || state.game.phase !== "playing") {
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
    timer.textContent = state.game && state.game.round && state.game.round.endsAt
      ? "נשארו " + state.remainingSeconds + " שניות"
      : "הטיימר יתחיל כשמישהו יסיים את כל הטופס";
  }
  const saveState = document.querySelector("[data-save-status]");
  if (saveState) {
    saveState.textContent = state.saveStatus || "התשובות נשמרות אוטומטית";
  }
}

async function rerollCategories() {
  await api("/api/reroll-categories", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
  });
  await refreshState();
}

async function addCategory(event) {
  event.preventDefault();
  const category = state.drafts.categoryProposal.trim();
  if (!category) {
    setError("צריך להזין קטגוריה");
    return;
  }
  await api("/api/propose-category", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
    category,
  });
  state.drafts.categoryProposal = "";
  await refreshState();
}

async function removeCategory(category) {
  await api("/api/remove-category", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
    category,
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

async function startGame() {
  await api("/api/start-game", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
  });
  await refreshState();
}

async function terminateGame() {
  await api("/api/terminate-game", {
    roomCode: state.session.room_code,
    playerId: state.session.player_id,
  });
  await refreshState();
}

function scheduleAnswerSave() {
  if (!state.session || !state.game || state.game.phase !== "playing") return;
  state.saveStatus = "שומר...";
  paintStatusBar();
  clearTimeout(state.saveHandle);
  state.saveHandle = setTimeout(flushAnswerSave, 220);
}

async function flushAnswerSave() {
  if (!state.session || !state.game || state.game.phase !== "playing") return;
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
  const text = "בואו לשחק איתי ארץ עיר 🎉 קוד החדר: " + state.game.roomCode;
  if (navigator.share) {
    await navigator.share({ title: "ארץ עיר", text, url: shareUrl.toString() });
    return;
  }
  await navigator.clipboard.writeText(text + "\n" + shareUrl.toString());
  state.saveStatus = "קישור ההזמנה הועתק 📋";
  paintStatusBar();
}

function formatFinishWindow(seconds) {
  return String(seconds) + " שניות";
}

function formatSource(source) {
  return source === "random" ? "הצעה אקראית" : "הוצע ידנית";
}

function syncDraftsWithGame() {
  if (!state.game || state.game.phase !== "playing" || !state.game.round) {
    state.lastRoundKey = null;
    state.drafts.answers = {};
    return;
  }
  const roundKey = state.game.roomCode + ":" + state.game.round.roundNumber;
  if (state.lastRoundKey !== roundKey) {
    state.lastRoundKey = roundKey;
    state.drafts.answers = Object.assign({}, state.game.round.myAnswers || {});
    state.saveStatus = "התשובות נשמרות אוטומטית";
    showLetterReveal(state.game.round.letter);
  }
}

function showLetterReveal(letter) {
  let overlay = document.querySelector("#letter-reveal-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "letter-reveal-overlay";
    overlay.className = "letter-reveal hidden";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML =
    '<div class="letter-reveal-card">' +
    '<div class="letter-reveal-emoji">✨</div>' +
    "<p>האות שנבחרה היא</p>" +
    '<div class="letter-reveal-letter">' +
    escapeHtml(letter) +
    "</div></div>";
  overlay.classList.remove("hidden");
  overlay.classList.add("visible");
  clearTimeout(showLetterReveal.timeoutId);
  showLetterReveal.timeoutId = setTimeout(() => {
    overlay.classList.remove("visible");
    overlay.classList.add("hidden");
  }, 1500);
}

function attachDraftInput(selector, key, transform) {
  const input = document.querySelector(selector);
  if (!input) return;
  const mapper = transform || ((value) => value);
  input.addEventListener("input", (event) => {
    state.drafts[key] = mapper(event.currentTarget.value);
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
    selector = "#" + (window.CSS && window.CSS.escape ? window.CSS.escape(active.id) : active.id);
  } else if (answerCategory) {
    selector = '[data-answer-category="' + (window.CSS && window.CSS.escape ? window.CSS.escape(answerCategory) : answerCategory) + '"]';
  }
  if (!selector) {
    state.renderSnapshot = null;
    return;
  }
  state.renderSnapshot = {
    selector,
    selectionStart: active.selectionStart || 0,
    selectionEnd: active.selectionEnd || 0,
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
  app.innerHTML =
    '<section class="card form-card stack">' +
    "<div><h2>פתיחת חדר או הצטרפות</h2><p class=\"helper\">מזינים שם, יוצרים חדר חדש או מצטרפים עם קוד.</p></div>" +
    '<label for="player-name">השם שלך<input id="player-name" maxlength="24" placeholder="לדוגמה: יואב" autocomplete="nickname" /></label>' +
    '<div class="button-row"><button id="create-room" type="button">יצירת חדר חדש</button></div>' +
    '<div class="join-row"><input id="room-code" maxlength="5" placeholder="קוד חדר" autocomplete="off" />' +
    '<button id="join-room" type="button" class="secondary">הצטרפות לחדר</button></div>' +
    "</section>";
  document.querySelector("#player-name").value = state.drafts.playerName;
  document.querySelector("#room-code").value = state.drafts.roomCode;
  attachDraftInput("#player-name", "playerName");
  attachDraftInput("#room-code", "roomCode", (value) => value.toUpperCase());
  document.querySelector("#create-room").addEventListener("click", withErrorHandling(createRoom));
  document.querySelector("#join-room").addEventListener("click", withErrorHandling(joinRoom));
}

function renderSidebar() {
  const playersHtml = state.game.players.map((player) => {
    return (
      '<div class="player-row">' +
      "<div><strong>" +
      escapeHtml(player.name) +
      "</strong><span class=\"muted\">" +
      (player.id === state.game.hostId ? "מארח" : "שחקן") +
      "</span></div>" +
      '<div class="points">' +
      player.totalScore +
      "</div></div>"
    );
  }).join("");

  const categoriesHtml = state.game.selectedCategories.map((item) => {
    return '<span class="pill">' + escapeHtml(item) + "</span>";
  }).join("");

  const terminateButton =
    (state.game.phase === "playing" || state.game.phase === "review") && isHost()
      ? '<button type="button" id="terminate-game" class="ghost">🛑 סיום משחק</button>'
      : "";

  return (
    '<aside class="card stack">' +
    '<div class="sidebar-section">' +
    '<div class="pill">קוד חדר: <strong>' +
    escapeHtml(state.game.roomCode) +
    "</strong> ✨</div>" +
    '<div class="toolbar"><button type="button" id="share-room" class="secondary">📨 שיתוף חדר</button>' +
    terminateButton +
    "</div></div>" +
    '<div class="sidebar-section"><h3>שחקנים 👥</h3><div class="players-list">' +
    playersHtml +
    "</div></div>" +
    '<div class="sidebar-section"><h3>סגירת טיימר 🏁</h3><div class="pill">אחרי שהראשון מסיים: ' +
    formatFinishWindow(state.game.finishWindowSeconds) +
    "</div></div>" +
    '<div class="sidebar-section"><h3>קטגוריות במשחק 🗂️</h3><div class="category-chip-row">' +
    categoriesHtml +
    "</div></div></aside>"
  );
}

function renderLobby() {
  const host = isHost();
  const categoriesHtml = state.game.proposedCategories.map((item) => {
    const removeButton = host
      ? '<button type="button" data-remove-category="' + escapeAttr(item.name) + '" class="ghost">הסר קטגוריה</button>'
      : "";
    return (
      '<article class="category-chip selected"><strong>' +
      escapeHtml(item.name) +
      "</strong><small>" +
      formatSource(item.source) +
      "</small>" +
      removeButton +
      "</article>"
    );
  }).join("");

  let hostControls = '<p class="helper">המארח מגדיר את הזמן ויכול לערוך את 4 הקטגוריות לפני תחילת המשחק.</p>';
  if (host) {
    const finishButtons = state.game.finishWindowOptions.map((seconds) => {
      const klass = state.game.finishWindowSeconds === seconds ? "" : "secondary";
      return '<button type="button" data-finish-window="' + seconds + '" class="' + klass + '">' + formatFinishWindow(seconds) + "</button>";
    }).join("");
    hostControls =
      '<div class="stack">' +
      '<span class="field-label">כמה זמן יישאר לאחר שהראשון מסיים?</span>' +
      '<div class="toolbar">' +
      finishButtons +
      "</div></div>" +
      '<form id="category-form" class="stack">' +
      '<label>הוספת קטגוריה משלכם' +
      '<input id="category-proposal" maxlength="36" value="' +
      escapeAttr(state.drafts.categoryProposal) +
      '" placeholder="לדוגמה: דברים באוטו" />' +
      "</label>" +
      '<div class="toolbar"><button type="submit">➕ הוסף קטגוריה</button><span class="pill">כרגע ' +
      state.game.proposedCategories.length +
      "/4 קטגוריות</span></div></form>" +
      '<div class="toolbar"><button id="reroll-categories" type="button" class="secondary">🎲 החלפת 4 הקטגוריות</button>' +
      '<button id="start-game" ' +
      (roomReady() ? "" : "disabled") +
      '>🚀 התחלת משחק</button></div>';
  }

  return (
    '<section class="card stack">' +
    '<div class="title-row"><div><h2>קטגוריות לפתיחה 🎯</h2><p class="status-copy">החדר נפתח עם 4 קטגוריות אקראיות. אפשר להסיר, להוסיף או לרענן אותן לפני שמתחילים.</p></div></div>' +
    hostControls +
    '<div class="pill">אלה הקטגוריות למשחק הזה</div>' +
    '<div class="category-grid">' +
    categoriesHtml +
    "</div></section>"
  );
}

function renderPlaying() {
  const round = state.game.round;
  const countdownClass = round.triggeredByName ? " countdown-live" : "";
  const banner = round.triggeredByName
    ? '<div class="pill countdown-pill">⏰ ' + escapeHtml(round.triggeredByName) + " השלים ראשון. הספירה לאחור התחילה.</div>"
    : '<div class="pill">🧠 סיימו את כל הטופס כדי להפעיל את הטיימר לשאר המשתתפים.</div>';
  const answersHtml = state.game.selectedCategories.map((category) => {
    return (
      "<label>" +
      escapeHtml(category) +
      '<input data-answer-category="' +
      escapeAttr(category) +
      '" value="' +
      escapeAttr(state.drafts.answers[category] || "") +
      '" placeholder="מילה שמתחילה ב-' +
      escapeAttr(round.letter) +
      '" />' +
      "</label>"
    );
  }).join("");

  return (
    '<section class="card stack' +
    countdownClass +
    '">' +
    '<div class="title-row"><div><div class="pill">סבב ' +
    round.roundNumber +
    " מתוך " +
    state.game.maxRounds +
    '</div><h2>ממלאים תשובות ✍️</h2><p class="status-copy">הטיימר יתחיל רק כשהראשון יסיים את כל 4 התשובות.</p></div>' +
    '<div class="stack"><div class="letter-badge">' +
    escapeHtml(round.letter) +
    '</div><div class="timer" data-timer>הטיימר יתחיל כשמישהו יסיים את כל הטופס</div><div class="muted" data-save-status>' +
    (state.saveStatus || "התשובות נשמרות אוטומטית") +
    "</div></div></div>" +
    banner +
    '<form class="answers-grid">' +
    answersHtml +
    "</form></section>"
  );
}

function renderReview() {
  const review = state.game.round.review;
  const hostActionLabel = review.categoryIndex === review.categoryCount - 1
    ? (state.game.round.roundNumber === state.game.maxRounds ? "🎉 סיום משחק" : "➡️ לסבב הבא")
    : "➡️ לקטגוריה הבאה";

  const entriesHtml = review.entries.map((entry) => {
    const likedByMe = entry.likedBy.includes(state.session.player_id);
    const canApprove = state.session.player_id !== entry.playerId && entry.answer && entry.startsWithLetter;
    const approveButton =
      state.game.phase === "review" && canApprove
        ? '<button type="button" data-approval="' + escapeAttr(entry.playerId) + '" class="approve-button ' + (entry.approvedByMe ? "" : "secondary") + '">' + (entry.approvedByMe ? "✅ אישרתי" : "✅ אשר תשובה") + "</button>"
        : "";
    const likePart =
      state.game.phase === "review" && entry.playerId !== state.session.player_id
        ? '<button type="button" data-like="' + escapeAttr(entry.playerId) + '" class="' + (likedByMe ? "" : "secondary") + '">' + (likedByMe ? "הסר לייק" : "💖 לייק") + "</button>"
        : '<span class="pill">לייקים: ' + entry.likes + "</span>";

    return (
      '<article class="card review-card">' +
      '<div class="title-row"><div><h3>' +
      escapeHtml(entry.playerName) +
      '</h3><p class="muted">נקודות עד כה בסבב: ' +
      entry.roundPoints +
      '</p></div><div class="points">' +
      entry.basePoints +
      " נק'</div></div>" +
      '<div class="review-answer">' +
      (entry.answer ? escapeHtml(entry.answer) : "<span class='muted'>אין תשובה</span>") +
      '</div><div class="toolbar">' +
      '<span class="pill ' + (entry.startsWithLetter ? "pill-success" : "pill-danger") + '">' + (entry.startsWithLetter ? "מתחיל באות ✅" : "לא מתחיל באות ❌") + "</span>" +
      '<span class="pill">אישורים: ' +
      entry.approvalCount +
      "/" +
      entry.approvalsNeeded +
      "</span>" +
      '<span class="pill">' +
      (entry.approved ? "מאושר לניקוד 🌟" : "ממתין לאישור") +
      "</span></div>" +
      '<div class="toolbar">' +
      approveButton +
      likePart +
      "</div></article>"
    );
  }).join("");

  return (
    '<section class="stack">' +
    '<div class="card stack"><div class="title-row"><div><div class="pill">סבב ' +
    state.game.round.roundNumber +
    ' הסתיים ✅</div><h2>בדיקת קטגוריה: ' +
    escapeHtml(review.currentCategory) +
    ' 🔎</h2><p class="status-copy">כל המשתתפים צריכים לאשר תשובות. אישור עובד רק אם התשובה מתחילה באות הנכונה.</p></div>' +
    '<div class="stack"><div class="pill">אות: ' +
    escapeHtml(state.game.round.letter) +
    '</div><div class="pill">קטגוריה ' +
    (review.categoryIndex + 1) +
    " מתוך " +
    review.categoryCount +
    "</div></div></div>" +
    (state.game.phase === "review" && isHost() ? '<button id="advance-review">' + hostActionLabel + "</button>" : "") +
    '</div><div class="review-list">' +
    entriesHtml +
    "</div></section>"
  );
}

function renderFinished() {
  const winner = state.game.winner;
  return (
    '<section class="card winner-card stack"><div class="winner-burst">🎉 🏆 🎉</div><div class="pill">המשחק נגמר</div><h2>' +
    escapeHtml(winner.name) +
    ' ניצח בגדול!</h2><p class="winner-score">' +
    winner.score +
    ' נקודות</p><p class="status-copy">מחיאות כפיים, זיקוקים ודקה של תהילה מקומית 🎊</p>' +
    (isHost() ? '<button id="restart-game">🔁 משחק חדש</button>' : "") +
    "</section>"
  );
}

function renderGame() {
  captureRenderSnapshot();
  let main = "";
  if (state.game.phase === "lobby") {
    main = renderLobby();
  } else if (state.game.phase === "playing") {
    main = renderPlaying();
  } else {
    main = (state.game.phase === "finished" ? renderFinished() : "") + renderReview();
  }

  app.innerHTML =
    (state.error ? '<div class="error-banner">' + escapeHtml(state.error) + "</div>" : "") +
    '<div class="layout">' +
    renderSidebar() +
    '<section class="stack">' +
    main +
    "</section></div>";

  restoreRenderSnapshot();

  const shareButton = document.querySelector("#share-room");
  if (shareButton) shareButton.addEventListener("click", withErrorHandling(shareRoom));

  if (state.game.phase === "lobby") {
    attachDraftInput("#category-proposal", "categoryProposal");
    const form = document.querySelector("#category-form");
    if (form) form.addEventListener("submit", withErrorHandling(addCategory));
    document.querySelectorAll("[data-finish-window]").forEach((button) => {
      button.addEventListener("click", withErrorHandling(() => setFinishWindow(Number(button.getAttribute("data-finish-window")))));
    });
    document.querySelectorAll("[data-remove-category]").forEach((button) => {
      button.addEventListener("click", withErrorHandling(() => removeCategory(button.getAttribute("data-remove-category"))));
    });
    const rerollButton = document.querySelector("#reroll-categories");
    if (rerollButton) rerollButton.addEventListener("click", withErrorHandling(rerollCategories));
    const startButton = document.querySelector("#start-game");
    if (startButton) startButton.addEventListener("click", withErrorHandling(startGame));
  }

  if (state.game.phase === "playing") {
    attachAnswerDraftInputs();
  }

  if (state.game.phase === "review" || state.game.phase === "finished") {
    document.querySelectorAll("[data-approval]").forEach((button) => {
      button.addEventListener("click", withErrorHandling(() => toggleApproval(button.getAttribute("data-approval"), state.game.round.review.currentCategory)));
    });
    document.querySelectorAll("[data-like]").forEach((button) => {
      button.addEventListener("click", withErrorHandling(() => toggleLike(button.getAttribute("data-like"), state.game.round.review.currentCategory)));
    });
    const advanceButton = document.querySelector("#advance-review");
    if (advanceButton) advanceButton.addEventListener("click", withErrorHandling(advanceReview));
    const restartButton = document.querySelector("#restart-game");
    if (restartButton) restartButton.addEventListener("click", withErrorHandling(startGame));
  }

  if (state.game.phase === "playing" || state.game.phase === "review") {
    const terminateButton = document.querySelector("#terminate-game");
    if (terminateButton) terminateButton.addEventListener("click", withErrorHandling(terminateGame));
  }
}

function render() {
  if (!state.session || !state.game) {
    renderWelcome();
    if (state.error) {
      app.insertAdjacentHTML("afterbegin", '<div class="error-banner">' + escapeHtml(state.error) + "</div>");
