import json
import os
import random
import re
import string
import threading
import time
import urllib.parse
from copy import deepcopy
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from uuid import uuid4


BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"

HEBREW_LETTERS = list("אבגדהוזחטיכלמנסעפצקרשת")
FINISH_WINDOW_OPTIONS = [10, 20, 40]
MAX_ROUNDS = 4
ROOM_SIZE_LIMIT = 6
CATEGORY_COUNT = 4
MAX_PROPOSED_CATEGORIES = 20
MAX_CHAT_MESSAGES = 60

SUGGESTED_CATEGORIES = [
    "משקאות",
    "דברים שמוצאים במלון",
    "להקות רוק",
    "דברים עגולים",
    "חיות",
    "מאכלים",
    "ערים בעולם",
    "מקצועות",
    "דברים בים",
    "דברים בבית ספר",
    "דברים שמביאים לפיקניק",
    "סרטים",
    "שמות של בנות",
    "שמות של בנים",
    "מדינות",
    "בירות בעולם",
    "נהרות",
    "הרים",
    "איים",
    "חופים",
    "אתרי תיירות",
    "חגים",
    "דברים במטבח",
    "דברים בסלון",
    "דברים במקרר",
    "דברים בחדר שינה",
    "דברים בחדר אמבטיה",
    "דברים במשרד",
    "דברים בגינה",
    "דברים בסופר",
    "דברים בשוק",
    "דברים בבית קפה",
    "מאפים",
    "פירות",
    "ירקות",
    "קינוחים",
    "ממתקים",
    "מאכלי רחוב",
    "מנות לארוחת בוקר",
    "מנות לצהריים",
    "מנות לערב",
    "תבלינים",
    "רטבים",
    "כלי נגינה",
    "זמרים",
    "זמרות",
    "שחקנים",
    "שחקניות",
    "סדרות טלוויזיה",
    "דמויות מסרטים",
    "גיבורי על",
    "ספרים",
    "סופרים",
    "משוררים",
    "ציירים",
    "פסלים",
    "מוזיאונים",
    "ריקודים",
    "ספורטאים",
    "ענפי ספורט",
    "קבוצות כדורגל",
    "קבוצות כדורסל",
    "אצטדיונים",
    "תרגילי כושר",
    "דברים בים",
    "חיות מחמד",
    "חיות בר",
    "ציפורים",
    "דגים",
    "חרקים",
    "פרחים",
    "עצים",
    "צמחים",
    "אבני חן",
    "צבעים",
    "בדים",
    "בגדים",
    "נעליים",
    "אביזרי אופנה",
    "מותגי אופנה",
    "חפצים בתיק",
    "ציוד לבית ספר",
    "מקצועות לימוד",
    "אפליקציות",
    "אתרי אינטרנט",
    "רשתות חברתיות",
    "מכשירים אלקטרוניים",
    "מותגי טלפונים",
    "משחקי וידאו",
    "משחקי קופסה",
    "צעצועים",
    "עבודות בבית",
    "מקצועות עתידיים",
    "כלי תחבורה",
    "חלקים ברכב",
    "דברים בתחנת דלק",
    "דברים בשדה תעופה",
    "דברים במטוס",
    "דברים ברכבת",
    "דברים באוטובוס",
    "ערים בישראל",
    "יישובים בישראל",
    "אתרים בישראל",
    "דברים במדבר",
    "דברים בטבע",
    "מזג אוויר",
    "מילים שמביעות רגש",
    "מילים חיוביות",
    "מילים מצחיקות",
    "עבודות בית",
    "משהו שאורזים לחופשה",
    "דברים למסיבה",
    "דברים לחתונה",
    "דברים ליום הולדת",
    "מתנות",
    "דברים שעושים בשבת",
    "דברים שאומרים למורה",
    "דברים שאומרים לילד",
    "קללות בלי קללה",
    "עבודות יצירה",
    "חומרים ליצירה",
    "מותגי רכב",
    "חברות תעופה",
    "מקצועות ברפואה",
    "דברים בבית חולים",
    "דברים בבית מרקחת",
    "קוסמטיקה",
    "בשמים",
    "מקצועות במה",
    "דברים בחורף",
    "דברים בקיץ",
    "דברים באביב",
    "דברים בסתיו",
    "פסטיבלים",
    "ערוצי יוטיוב",
    "פודקאסטים",
    "עיתונים",
    "מאכלים ישראליים",
    "מילים באנגלית שכולם משתמשים בהן",
]


def now_ts() -> float:
    return time.time()


def normalize_hebrew(text: str) -> str:
    normalized = (text or "").strip().lower()
    normalized = normalized.replace("-", " ").replace("_", " ")
    normalized = re.sub(r"\s+", " ", normalized)
    replacements = str.maketrans({"ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ"})
    normalized = normalized.translate(replacements)
    normalized = re.sub(r"[^a-z\u0590-\u05ff0-9 ]", "", normalized)
    return normalized


def answer_starts_with_letter(answer: str, letter: str) -> bool:
    normalized_answer = normalize_hebrew(answer)
    normalized_letter = normalize_hebrew(letter)
    return bool(normalized_answer) and normalized_answer.startswith(normalized_letter)


def make_room_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(5))


@dataclass
class Player:
    id: str
    name: str
    joined_at: float
    total_score: int = 0
    liked_received: int = 0


@dataclass
class RoundState:
    round_number: int
    letter: str
    started_at: float
    countdown_started_at: float | None = None
    ends_at: float | None = None
    triggered_by: str | None = None
    answers: dict[str, dict[str, str]] = field(default_factory=dict)
    challenges: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    review_scores: dict[str, dict[str, Any]] = field(default_factory=dict)
    likes: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    review_category_index: int = 0


@dataclass
class Room:
    code: str
    host_id: str
    created_at: float
    players: dict[str, Player] = field(default_factory=dict)
    phase: str = "lobby"
    selected_categories: list[str] = field(default_factory=list)
    proposed_categories: list[dict[str, Any]] = field(default_factory=list)
    category_votes: dict[str, list[str]] = field(default_factory=dict)
    category_rejections: dict[str, list[str]] = field(default_factory=dict)
    rounds: list[RoundState] = field(default_factory=list)
    finish_window_seconds: int = 20
    finished_at: float | None = None
    chat_messages: list[dict[str, Any]] = field(default_factory=list)


class GameStore:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.lock = threading.Lock()

    def create_room(self, player_name: str) -> dict[str, str]:
        with self.lock:
            cleaned_name = self._validate_player_name(player_name)
            code = make_room_code()
            while code in self.rooms:
                code = make_room_code()
            player = Player(id=uuid4().hex, name=cleaned_name, joined_at=now_ts())
            room = Room(code=code, host_id=player.id, created_at=now_ts(), players={player.id: player})
            self.rooms[code] = room
            self._reset_lobby_categories(room)
            return {"room_code": code, "player_id": player.id}

    def join_room(self, room_code: str, player_name: str) -> dict[str, str]:
        with self.lock:
            room = self._get_room(room_code)
            if room.phase != "lobby":
                raise ValueError("אפשר להצטרף רק לפני תחילת המשחק")
            cleaned_name = self._validate_player_name(player_name)
            for existing in room.players.values():
                if normalize_hebrew(existing.name) == normalize_hebrew(cleaned_name):
                    return {"room_code": room.code, "player_id": existing.id}
            if len(room.players) >= ROOM_SIZE_LIMIT:
                raise ValueError("החדר מלא")
            player = Player(id=uuid4().hex, name=cleaned_name, joined_at=now_ts())
            room.players[player.id] = player
            return {"room_code": room.code, "player_id": player.id}

    def remove_player(self, room_code: str, player_id: str, target_player_id: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            if player_id != room.host_id:
                raise ValueError("רק המארח יכול להסיר שחקנים")
            if room.phase != "lobby":
                raise ValueError("אפשר להסיר שחקנים רק לפני תחילת המשחק")
            if target_player_id == room.host_id:
                raise ValueError("אי אפשר להסיר את המארח")
            if target_player_id not in room.players:
                raise ValueError("השחקן לא נמצא")
            del room.players[target_player_id]

    def set_finish_window(self, room_code: str, player_id: str, seconds: int) -> None:
        with self.lock:
            room = self._get_room(room_code)
            if player_id != room.host_id:
                raise ValueError("רק המארח יכול לשנות את הזמן")
            if room.phase != "lobby":
                raise ValueError("אפשר לשנות זמן רק בלובי")
            if seconds not in FINISH_WINDOW_OPTIONS:
                raise ValueError("זמן לא תקין")
            room.finish_window_seconds = seconds

    def propose_category(self, room_code: str, player_id: str, category: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            if room.phase != "lobby":
                raise ValueError("אפשר להוסיף קטגוריות רק בלובי")
            player = self._get_player(room, player_id)
            label = (category or "").strip()
            if not label:
                raise ValueError("צריך להזין קטגוריה")
            if len(room.proposed_categories) >= MAX_PROPOSED_CATEGORIES:
                raise ValueError("אפשר לשמור עד 12 הצעות בלובי")
            if any(normalize_hebrew(item["name"]) == normalize_hebrew(label) for item in room.proposed_categories):
                raise ValueError("הקטגוריה כבר קיימת")
            room.proposed_categories.append({"name": label, "source": "player", "suggestedBy": player.name})
            room.category_votes[label] = []
            room.category_rejections[label] = []

    def toggle_selected_category(self, room_code: str, player_id: str, category: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            if player_id != room.host_id:
                raise ValueError("רק המארח יכול לבחור את הקטגוריות")
            if room.phase != "lobby":
                raise ValueError("אפשר לבחור קטגוריות רק בלובי")
            category_name = self._find_proposed_category(room, category)
            if category_name in room.selected_categories:
                room.selected_categories = [item for item in room.selected_categories if normalize_hebrew(item) != normalize_hebrew(category_name)]
                return
            if len(room.selected_categories) >= CATEGORY_COUNT:
                raise ValueError("אפשר לבחור רק 4 קטגוריות")
            room.selected_categories.append(category_name)

    def add_random_category(self, room_code: str, player_id: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            if player_id != room.host_id:
                raise ValueError("רק המארח יכול להוסיף קטגוריה אקראית")
            if room.phase != "lobby":
                raise ValueError("אפשר להוסיף קטגוריה אקראית רק בלובי")
            if len(room.proposed_categories) >= MAX_PROPOSED_CATEGORIES:
                raise ValueError("הגעתם למספר ההצעות המקסימלי")
            used = {normalize_hebrew(item["name"]) for item in room.proposed_categories}
            available = [name for name in SUGGESTED_CATEGORIES if normalize_hebrew(name) not in used]
            if not available:
                raise ValueError("אין כרגע קטגוריות אקראיות חדשות להוסיף")
            name = random.choice(available)
            room.proposed_categories.append({"name": name, "source": "random", "suggestedBy": "המשחק"})
            room.category_votes[name] = []
            room.category_rejections[name] = []

    def toggle_category_vote(self, room_code: str, player_id: str, category: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            self._get_player(room, player_id)
            if room.phase != "lobby":
                raise ValueError("אפשר לסמן קטגוריות רק בלובי")
            category_name = self._find_proposed_category(room, category)
            room.category_votes.setdefault(category_name, [])
            room.category_rejections.setdefault(category_name, [])
            votes = room.category_votes[category_name]
            rejections = room.category_rejections[category_name]
            if player_id in votes:
                votes.remove(player_id)
            else:
                votes.append(player_id)
                if player_id in rejections:
                    rejections.remove(player_id)

    def toggle_category_rejection(self, room_code: str, player_id: str, category: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            self._get_player(room, player_id)
            if room.phase != "lobby":
                raise ValueError("אפשר לסמן קטגוריות רק בלובי")
            category_name = self._find_proposed_category(room, category)
            room.category_votes.setdefault(category_name, [])
            room.category_rejections.setdefault(category_name, [])
            votes = room.category_votes[category_name]
            rejections = room.category_rejections[category_name]
            if player_id in rejections:
                rejections.remove(player_id)
            else:
                rejections.append(player_id)
                if player_id in votes:
                    votes.remove(player_id)

    def send_chat_message(self, room_code: str, player_id: str, text: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            player = self._get_player(room, player_id)
            message = (text or "").strip()
            if not message:
                raise ValueError("צריך לכתוב הודעה")
            room.chat_messages.append(
                {
                    "id": uuid4().hex,
                    "playerId": player.id,
                    "playerName": player.name,
                    "text": message[:240],
                    "createdAt": now_ts(),
                }
            )
            if len(room.chat_messages) > MAX_CHAT_MESSAGES:
                room.chat_messages = room.chat_messages[-MAX_CHAT_MESSAGES:]

    def reroll_categories(self, room_code: str, player_id: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            if player_id != room.host_id:
                raise ValueError("רק המארח יכול לרענן קטגוריות")
            if room.phase != "lobby":
                raise ValueError("אפשר לרענן קטגוריות רק בלובי")
            self._reset_lobby_categories(room)

    def remove_category(self, room_code: str, player_id: str, category: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            if player_id != room.host_id:
                raise ValueError("רק המארח יכול להסיר קטגוריות")
            if room.phase != "lobby":
                raise ValueError("אפשר להסיר קטגוריות רק בלובי")
            label = (category or "").strip()
            updated = [item for item in room.proposed_categories if normalize_hebrew(item["name"]) != normalize_hebrew(label)]
            if len(updated) == len(room.proposed_categories):
                raise ValueError("הקטגוריה לא נמצאה")
            room.proposed_categories = updated
            room.selected_categories = [item for item in room.selected_categories if normalize_hebrew(item) != normalize_hebrew(label)]
            room.category_votes = {
                key: voters for key, voters in room.category_votes.items() if normalize_hebrew(key) != normalize_hebrew(label)
            }
            room.category_rejections = {
                key: voters for key, voters in room.category_rejections.items() if normalize_hebrew(key) != normalize_hebrew(label)
            }

    def start_game(self, room_code: str, player_id: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            if player_id != room.host_id:
                raise ValueError("רק המארח יכול להתחיל")
            if len(room.players) < 2:
                raise ValueError("צריך לפחות 2 שחקנים כדי להתחיל")
            if len(room.selected_categories) != CATEGORY_COUNT:
                raise ValueError("צריך לבחור 4 קטגוריות")
            if room.phase not in {"lobby", "finished"}:
                raise ValueError("המשחק כבר התחיל")
            room.rounds = []
            room.finished_at = None
            room.phase = "playing"
            self._start_next_round_locked(room)
            self._recompute_totals_locked(room)

    def return_to_lobby(self, room_code: str, player_id: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            if player_id != room.host_id:
                raise ValueError("רק המארח יכול לפתוח משחק חדש")
            room.phase = "lobby"
            room.rounds = []
            room.finished_at = None
            self._reset_lobby_categories(room)
            self._recompute_totals_locked(room)

    def terminate_game(self, room_code: str, player_id: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            if player_id != room.host_id:
                raise ValueError("רק המארח יכול לסיים את המשחק")
            if room.phase == "lobby":
                raise ValueError("אין משחק פעיל לסיים")
            room.phase = "finished"
            room.finished_at = now_ts()
            self._recompute_totals_locked(room)

    def save_answers(self, room_code: str, player_id: str, answers: dict[str, str]) -> None:
        with self.lock:
            room = self._get_room(room_code)
            player = self._get_player(room, player_id)
            self._ensure_round_up_to_date(room)
            if room.phase != "playing":
                return
            current = room.rounds[-1]
            current.answers[player.id] = {
                category: (answers.get(category, "") or "").strip() for category in room.selected_categories
            }

    def trigger_countdown(self, room_code: str, player_id: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            player = self._get_player(room, player_id)
            self._ensure_round_up_to_date(room)
            if room.phase != "playing":
                raise ValueError("אפשר להפעיל ספירה לאחור רק בזמן הסבב")
            current = room.rounds[-1]
            if current.countdown_started_at is not None:
                raise ValueError("הספירה לאחור כבר התחילה")
            if not self._is_form_complete(room.selected_categories, current.answers.get(player.id, {})):
                raise ValueError("צריך למלא את כל 4 התשובות לפני שמסיימים")
            current.countdown_started_at = now_ts()
            current.ends_at = current.countdown_started_at + room.finish_window_seconds
            current.triggered_by = player.id

    def toggle_challenge(self, room_code: str, player_id: str, target_player_id: str, category: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            self._get_player(room, player_id)
            self._ensure_round_up_to_date(room)
            if room.phase != "review":
                raise ValueError("אפשר לערער על תשובות רק בזמן הבדיקה")
            if target_player_id == player_id:
                raise ValueError("אי אפשר לערער על התשובה של עצמך")
            current = room.rounds[-1]
            if target_player_id not in current.challenges:
                raise ValueError("שחקן לא נמצא")
            category_name = self._find_selected_category(room, category)
            if not current.answers[target_player_id].get(category_name, "").strip():
                raise ValueError("אין תשובה לערער עליה")
            challenges = current.challenges[target_player_id][category_name]
            if player_id in challenges:
                challenges.remove(player_id)
            else:
                challenges.append(player_id)
            self._recompute_round_scores_locked(room, current)
            self._recompute_totals_locked(room)

    def toggle_like(self, room_code: str, player_id: str, target_player_id: str, category: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            self._get_player(room, player_id)
            self._ensure_round_up_to_date(room)
            if room.phase != "review":
                raise ValueError("לייקים זמינים רק בזמן הבדיקה")
            current = room.rounds[-1]
            category_name = self._find_selected_category(room, category)
            if target_player_id == player_id:
                raise ValueError("אי אפשר לעשות לייק לעצמך")
            if target_player_id not in current.review_scores:
                raise ValueError("שחקן לא נמצא")
            current.likes.setdefault(target_player_id, {}).setdefault(category_name, [])
            bucket = current.likes[target_player_id][category_name]
            if player_id in bucket:
                bucket.remove(player_id)
            else:
                bucket.append(player_id)
            self._recompute_totals_locked(room)

    def advance_review(self, room_code: str, player_id: str) -> None:
        with self.lock:
            room = self._get_room(room_code)
            if player_id != room.host_id:
                raise ValueError("רק המארח יכול להמשיך")
            self._ensure_round_up_to_date(room)
            if room.phase != "review":
                raise ValueError("אין כרגע סבב בדיקה")
            current = room.rounds[-1]
            if current.review_category_index < len(room.selected_categories) - 1:
                current.review_category_index += 1
                return
            if len(room.rounds) >= MAX_ROUNDS:
                room.phase = "finished"
                room.finished_at = now_ts()
            else:
                room.phase = "playing"
                self._start_next_round_locked(room)

    def get_state(self, room_code: str, player_id: str) -> dict[str, Any]:
        with self.lock:
            room = self._get_room(room_code)
            player = self._get_player(room, player_id)
            self._ensure_round_up_to_date(room)
            current_round = room.rounds[-1] if room.rounds else None
            players = sorted(room.players.values(), key=lambda item: (-item.total_score, item.joined_at))
            winner = players[0] if room.phase == "finished" and players else None
            return {
                "roomCode": room.code,
                "phase": room.phase,
                "hostId": room.host_id,
                "playerId": player.id,
                "playerName": player.name,
                "selectedCategories": room.selected_categories,
                "proposedCategories": [
                    {
                        **deepcopy(item),
                        "selected": any(normalize_hebrew(item["name"]) == normalize_hebrew(selected) for selected in room.selected_categories),
                        "voteCount": len(room.category_votes.get(item["name"], [])),
                        "rejectionCount": len(room.category_rejections.get(item["name"], [])),
                        "likedByMe": player.id in room.category_votes.get(item["name"], []),
                        "rejectedByMe": player.id in room.category_rejections.get(item["name"], []),
                        "likedByNames": [room.players[voter_id].name for voter_id in room.category_votes.get(item["name"], []) if voter_id in room.players],
                        "rejectedByNames": [room.players[voter_id].name for voter_id in room.category_rejections.get(item["name"], []) if voter_id in room.players],
                    }
                    for item in room.proposed_categories
                ],
                "players": [
                    {
                        "id": item.id,
                        "name": item.name,
                        "totalScore": item.total_score,
                        "likedReceived": item.liked_received,
                    }
                    for item in players
                ],
                "chatMessages": deepcopy(room.chat_messages),
                "roundSummaries": [self._round_summary(room, game_round) for game_round in room.rounds],
                "winner": {
                    "id": winner.id,
                    "name": winner.name,
                    "score": winner.total_score,
                }
                if winner
                else None,
                "round": self._round_snapshot(room, current_round, player.id),
                "maxRounds": MAX_ROUNDS,
                "finishWindowSeconds": room.finish_window_seconds,
                "finishWindowOptions": FINISH_WINDOW_OPTIONS,
            }

    def _round_snapshot(self, room: Room, current_round: RoundState | None, viewer_id: str) -> dict[str, Any] | None:
        if not current_round:
            return None
        review = None
        if room.phase in {"review", "finished"}:
            category = room.selected_categories[current_round.review_category_index]
            review = {
                "categoryIndex": current_round.review_category_index,
                "categoryCount": len(room.selected_categories),
                "currentCategory": category,
                "entries": self._review_entries(room, current_round, category, viewer_id),
            }
        return {
            "roundNumber": current_round.round_number,
            "letter": current_round.letter,
            "startedAt": current_round.started_at,
            "countdownStartedAt": current_round.countdown_started_at,
            "endsAt": current_round.ends_at,
            "triggeredByName": room.players[current_round.triggered_by].name if current_round.triggered_by else None,
            "myAnswers": deepcopy(current_round.answers.get(viewer_id, {})),
            "review": review,
        }

    def _review_entries(self, room: Room, current_round: RoundState, category: str, viewer_id: str) -> list[dict[str, Any]]:
        entries = []
        challenge_threshold = max(1, (len(room.players) + 1) // 2)
        for player_id, score_data in current_round.review_scores.items():
            challenges = current_round.challenges.get(player_id, {}).get(category, [])
            likes = current_round.likes.get(player_id, {}).get(category, [])
            starts_with_letter = answer_starts_with_letter(score_data["answers"].get(category, ""), current_round.letter)
            entries.append(
                {
                    "playerId": player_id,
                    "playerName": room.players[player_id].name,
                    "answer": score_data["answers"].get(category, ""),
                    "basePoints": score_data["base_points"].get(category, 0),
                    "roundPoints": score_data["round_points"],
                    "startsWithLetter": starts_with_letter,
                    "challengeThreshold": challenge_threshold,
                    "challengeCount": len(challenges),
                    "challengedByMe": viewer_id in challenges,
                    "accepted": self._is_answer_accepted(room, current_round, player_id, category),
                    "disqualified": self._is_answer_challenged_out(room, current_round, player_id, category),
                    "challengedByNames": [room.players[challenger_id].name for challenger_id in challenges if challenger_id in room.players],
                    "likes": len(likes),
                    "likedBy": likes,
                    "likedByNames": [room.players[liker_id].name for liker_id in likes if liker_id in room.players],
                }
            )
        return entries

    def _round_summary(self, room: Room, game_round: RoundState) -> dict[str, Any]:
        rows = []
        for player_id, player in room.players.items():
            answers = game_round.answers.get(player_id, {})
            score_data = game_round.review_scores.get(player_id, {})
            categories = []
            total_likes = 0
            total_challenges = 0
            for category in room.selected_categories:
                likes = game_round.likes.get(player_id, {}).get(category, [])
                challenges = game_round.challenges.get(player_id, {}).get(category, [])
                total_likes += len(likes)
                total_challenges += len(challenges)
                categories.append(
                    {
                        "category": category,
                        "answer": answers.get(category, ""),
                        "points": score_data.get("base_points", {}).get(category, 0),
                        "likes": len(likes),
                        "likeNames": [room.players[liker_id].name for liker_id in likes if liker_id in room.players],
                        "challenges": len(challenges),
                        "disqualified": self._is_answer_challenged_out(room, game_round, player_id, category),
                    }
                )
            rows.append(
                {
                    "playerId": player_id,
                    "playerName": player.name,
                    "roundPoints": score_data.get("round_points", 0),
                    "totalLikes": total_likes,
                    "totalChallenges": total_challenges,
                    "categories": categories,
                }
            )
        return {
            "roundNumber": game_round.round_number,
            "letter": game_round.letter,
            "rows": rows,
        }

    def _reset_lobby_categories(self, room: Room) -> None:
        candidates = SUGGESTED_CATEGORIES[:]
        random.shuffle(candidates)
        selected = candidates[:CATEGORY_COUNT]
        room.proposed_categories = [{"name": name, "source": "random", "suggestedBy": "המשחק"} for name in selected]
        room.category_votes = {name: [] for name in selected}
        room.category_rejections = {name: [] for name in selected}
        room.selected_categories = selected[:]

    def _start_next_round_locked(self, room: Room) -> None:
        used_letters = {entry.letter for entry in room.rounds}
        available_letters = [letter for letter in HEBREW_LETTERS if letter not in used_letters] or HEBREW_LETTERS[:]
        letter = random.choice(available_letters)
        room.rounds.append(
            RoundState(
                round_number=len(room.rounds) + 1,
                letter=letter,
                started_at=now_ts(),
            )
        )

    def _ensure_round_up_to_date(self, room: Room) -> None:
        if room.phase == "playing":
            self._maybe_end_round_locked(room)

    def _maybe_end_round_locked(self, room: Room) -> None:
        if room.phase != "playing" or not room.rounds:
            return
        current = room.rounds[-1]
        if current.ends_at is None or now_ts() < current.ends_at:
            return
        self._prepare_review_locked(room, current)
        room.phase = "review"
        self._recompute_totals_locked(room)

    def _prepare_review_locked(self, room: Room, current: RoundState) -> None:
        for player_id in room.players:
            current.answers.setdefault(player_id, {category: "" for category in room.selected_categories})
            current.challenges.setdefault(player_id, {})
            current.likes.setdefault(player_id, {})
            for category in room.selected_categories:
                current.challenges[player_id].setdefault(category, [])
                current.likes[player_id].setdefault(category, [])
        current.review_category_index = 0
        self._recompute_round_scores_locked(room, current)

    def _recompute_round_scores_locked(self, room: Room, current: RoundState) -> None:
        normalized_by_category: dict[str, dict[str, list[str]]] = {category: {} for category in room.selected_categories}
        for player_id, answers in current.answers.items():
            for category in room.selected_categories:
                if not self._is_answer_accepted(room, current, player_id, category):
                    continue
                normalized = normalize_hebrew(answers.get(category, ""))
                if normalized:
                    normalized_by_category[category].setdefault(normalized, []).append(player_id)
        current.review_scores = {}
        for player_id, answers in current.answers.items():
            base_points: dict[str, int] = {}
            round_points = 0
            for category in room.selected_categories:
                if not self._is_answer_accepted(room, current, player_id, category):
                    base_points[category] = 0
                    continue
                normalized = normalize_hebrew(answers.get(category, ""))
                duplicates = len(normalized_by_category[category].get(normalized, []))
                points = 5 if duplicates > 1 else 10
                base_points[category] = points
                round_points += points
            current.review_scores[player_id] = {
                "answers": deepcopy(answers),
                "base_points": base_points,
                "round_points": round_points,
            }

    def _recompute_totals_locked(self, room: Room) -> None:
        for participant in room.players.values():
            participant.total_score = 0
            participant.liked_received = 0
        for game_round in room.rounds:
            if game_round.review_scores:
                for player_id, score_data in game_round.review_scores.items():
                    room.players[player_id].total_score += score_data["round_points"]
            for player_id, likes_by_category in game_round.likes.items():
                like_count = sum(len(voters) for voters in likes_by_category.values())
                room.players[player_id].total_score += like_count
                room.players[player_id].liked_received += like_count

    def _is_answer_accepted(self, room: Room, current: RoundState, player_id: str, category: str) -> bool:
        answer = current.answers.get(player_id, {}).get(category, "").strip()
        if not answer or not answer_starts_with_letter(answer, current.letter):
            return False
        return not self._is_answer_challenged_out(room, current, player_id, category)

    def _is_answer_challenged_out(self, room: Room, current: RoundState, player_id: str, category: str) -> bool:
        challenges = current.challenges.get(player_id, {}).get(category, [])
        threshold = max(1, (len(room.players) + 1) // 2)
        return len(challenges) >= threshold

    def _is_form_complete(self, categories: list[str], answers: dict[str, str]) -> bool:
        return all((answers.get(category, "") or "").strip() for category in categories)

    def _get_room(self, room_code: str) -> Room:
        code = (room_code or "").strip().upper()
        room = self.rooms.get(code)
        if not room:
            raise ValueError("החדר לא נמצא")
        return room

    def _get_player(self, room: Room, player_id: str) -> Player:
        player = room.players.get((player_id or "").strip())
        if not player:
            raise ValueError("השחקן לא נמצא")
        return player

    def _find_selected_category(self, room: Room, category: str) -> str:
        label = (category or "").strip()
        for item in room.selected_categories:
            if normalize_hebrew(item) == normalize_hebrew(label):
                return item
        raise ValueError("הקטגוריה לא קיימת")

    def _find_proposed_category(self, room: Room, category: str) -> str:
        label = (category or "").strip()
        for item in room.proposed_categories:
            if normalize_hebrew(item["name"]) == normalize_hebrew(label):
                return item["name"]
        raise ValueError("הקטגוריה לא קיימת")

    def _validate_player_name(self, player_name: str) -> str:
        cleaned = (player_name or "").strip()
        if not cleaned:
            raise ValueError("צריך להזין שם")
        return cleaned[:24]


STORE = GameStore()


class AppHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            self._serve_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
            return
        if parsed.path == "/knit":
            self._serve_file(STATIC_DIR / "knit.html", "text/html; charset=utf-8")
            return
        if parsed.path == "/knit-single":
            self._serve_file(STATIC_DIR / "knit-single.html", "text/html; charset=utf-8")
            return
        if parsed.path.startswith("/static/"):
            target = STATIC_DIR / parsed.path.removeprefix("/static/")
            mime = "text/plain; charset=utf-8"
            if target.suffix == ".css":
                mime = "text/css; charset=utf-8"
            elif target.suffix == ".js":
                mime = "application/javascript; charset=utf-8"
            self._serve_file(target, mime)
            return
        if parsed.path == "/api/state":
            params = urllib.parse.parse_qs(parsed.query)
            self._handle_json(lambda: STORE.get_state(params.get("room_code", [""])[0], params.get("player_id", [""])[0]))
            return
        self._json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        body = self._read_json()
        routes = {
            "/api/create-room": lambda: STORE.create_room(body.get("name", "")),
            "/api/join-room": lambda: STORE.join_room(body.get("roomCode", ""), body.get("name", "")),
            "/api/remove-player": lambda: STORE.remove_player(
                body.get("roomCode", ""), body.get("playerId", ""), body.get("targetPlayerId", "")
            ),
            "/api/set-finish-window": lambda: STORE.set_finish_window(
                body.get("roomCode", ""), body.get("playerId", ""), int(body.get("seconds", 20))
            ),
            "/api/propose-category": lambda: STORE.propose_category(
                body.get("roomCode", ""), body.get("playerId", ""), body.get("category", "")
            ),
            "/api/toggle-category-vote": lambda: STORE.toggle_category_vote(
                body.get("roomCode", ""), body.get("playerId", ""), body.get("category", "")
            ),
            "/api/toggle-category-rejection": lambda: STORE.toggle_category_rejection(
                body.get("roomCode", ""), body.get("playerId", ""), body.get("category", "")
            ),
            "/api/toggle-selected-category": lambda: STORE.toggle_selected_category(
                body.get("roomCode", ""), body.get("playerId", ""), body.get("category", "")
            ),
            "/api/add-random-category": lambda: STORE.add_random_category(
                body.get("roomCode", ""), body.get("playerId", "")
            ),
            "/api/send-chat-message": lambda: STORE.send_chat_message(
                body.get("roomCode", ""), body.get("playerId", ""), body.get("text", "")
            ),
            "/api/reroll-categories": lambda: STORE.reroll_categories(body.get("roomCode", ""), body.get("playerId", "")),
            "/api/remove-category": lambda: STORE.remove_category(
                body.get("roomCode", ""), body.get("playerId", ""), body.get("category", "")
            ),
            "/api/start-game": lambda: STORE.start_game(body.get("roomCode", ""), body.get("playerId", "")),
            "/api/return-to-lobby": lambda: STORE.return_to_lobby(body.get("roomCode", ""), body.get("playerId", "")),
            "/api/terminate-game": lambda: STORE.terminate_game(body.get("roomCode", ""), body.get("playerId", "")),
            "/api/save-answers": lambda: STORE.save_answers(
                body.get("roomCode", ""), body.get("playerId", ""), body.get("answers", {})
            ),
            "/api/trigger-countdown": lambda: STORE.trigger_countdown(body.get("roomCode", ""), body.get("playerId", "")),
            "/api/toggle-challenge": lambda: STORE.toggle_challenge(
                body.get("roomCode", ""),
                body.get("playerId", ""),
                body.get("targetPlayerId", ""),
                body.get("category", ""),
            ),
            "/api/toggle-like": lambda: STORE.toggle_like(
                body.get("roomCode", ""),
                body.get("playerId", ""),
                body.get("targetPlayerId", ""),
                body.get("category", ""),
            ),
            "/api/advance-review": lambda: STORE.advance_review(body.get("roomCode", ""), body.get("playerId", "")),
        }
        handler = routes.get(parsed.path)
        if not handler:
            self._json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        self._handle_json(handler)

    def _handle_json(self, func) -> None:
        try:
            result = func()
        except ValueError as exc:
            self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        payload = {"ok": True}
        if result is not None:
            payload["data"] = result
        self._json_response(payload, HTTPStatus.OK)

    def _serve_file(self, path: Path, content_type: str) -> None:
        if not path.exists():
            self._json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        content = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _read_json(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length else b"{}"
        return json.loads(raw or b"{}")

    def _json_response(self, payload: dict[str, Any], status: HTTPStatus) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), AppHandler)
    print(f"Listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
