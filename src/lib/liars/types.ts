/**
 * «الكذابون» (Liars): shared constants and types. Safe to import on the client:
 * nothing here touches the database or the server.
 */

export const LIARS_SLUG = "liars";

/** Points for levels 1..9 of every category column. */
export const POINT_LEVELS = [100, 200, 300, 400, 500, 600, 700, 800, 1000] as const;
export const LEVEL_COUNT = POINT_LEVELS.length;

export const MIN_CATEGORIES = 1;
export const MAX_CATEGORIES = 6;
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 14;

/** Seconds per question. 0 turns the timer off: the question closes when everyone has answered. */
export const TIMER_CHOICES = [0, 15, 20, 30, 45, 60] as const;
export const DEFAULT_TIMER = 30;

export type LiarsState = "lobby" | "board" | "question" | "reveal" | "finished";

export type LiarsSettings = {
  /** 0 = no timer. */
  timerSeconds: number;
  /** Helper: hide two wrong options, once per player per game. */
  fiftyFifty: boolean;
  /** Modifier: a wrong answer loses half the cell's points. */
  penalty: boolean;
  /** Modifier: a fast correct answer earns up to +50%. */
  speedBonus: boolean;
  maxPlayers: number;
};

export type CategoryCard = {
  id: string;
  nameAr: string;
  nameEn: string;
  icon: string;
};

export type ViewMode = "host" | "tv" | "pad";

export type SnapPlayer = {
  id: string;
  name: string;
  seat: number;
  score: number;
  correct: number;
  wrong: number;
  isHost: boolean;
  connected: boolean;
  /** Has answered the open question. */
  answered: boolean;
};

export type RevealRow = {
  playerId: string;
  name: string;
  choice: number;
  correct: boolean;
  awarded: number;
};

export type LiarsSnapshot = {
  ok: true;
  unchanged?: false;
  revision: number;
  /** Server clock (ms), so clients can correct their own clock for the countdown. */
  serverNow: number;
  room: {
    code: string;
    state: LiarsState;
    settings: LiarsSettings;
    categories: CategoryCard[];
    usedCells: string[];
    pickerId: string | null;
    cell: null | {
      key: string;
      categoryId: string;
      level: number;
      points: number;
      startedAt: number;
      endsAt: number | null;
    };
    question: null | {
      text: string;
      options: string[];
    };
    reveal: null | {
      correctIndex: number;
      rows: RevealRow[];
    };
    answeredCount: number;
    connectedCount: number;
  };
  players: SnapPlayer[];
  you: {
    role: "host" | "player" | "viewer";
    playerId: string | null;
    isHost: boolean;
    canPick: boolean;
    /** Your choice on the open question, if any. */
    choice: number | null;
    helperAvailable: boolean;
    /** Option indexes your 50:50 helper removed on this question. */
    hidden: number[];
  };
};

export type LiarsUnchanged = { ok: true; unchanged: true; revision: number; serverNow: number };
export type LiarsFail = { ok: false; error: LiarsError };

export type LiarsError =
  | "BAD_INPUT"
  | "NOT_FOUND"
  | "EXPIRED"
  | "FORBIDDEN"
  | "WRONG_STATE"
  | "ROOM_FULL"
  | "NAME_TAKEN"
  | "BAD_NAME"
  | "CELL_USED"
  | "NO_QUESTION"
  | "ALREADY_ANSWERED"
  | "TOO_LATE"
  | "HELPER_USED"
  | "NO_PLAYERS"
  | "RATE_LIMIT"
  | "NOT_READY";

/** Arabic messages for every error code the engine can return. */
export const ERROR_TEXT: Record<LiarsError, string> = {
  BAD_INPUT: "البيانات غير صحيحة.",
  NOT_FOUND: "لم نجد غرفة بهذا الرمز.",
  EXPIRED: "انتهت صلاحية هذه الغرفة. أنشئ غرفة جديدة.",
  FORBIDDEN: "هذا الإجراء للمضيف أو لصاحب الدور فقط.",
  WRONG_STATE: "لا يمكن تنفيذ هذا الآن.",
  ROOM_FULL: "الغرفة ممتلئة.",
  NAME_TAKEN: "الاسم مستخدم في هذه الغرفة. اختر اسمًا آخر.",
  BAD_NAME: "الاسم يجب أن يكون من 2 إلى 16 حرفًا، بلا روابط.",
  CELL_USED: "هذه الخانة فُتحت من قبل.",
  NO_QUESTION: "لا يوجد سؤال لهذه الخانة بعد.",
  ALREADY_ANSWERED: "سجّلنا إجابتك مسبقًا.",
  TOO_LATE: "انتهى وقت السؤال.",
  HELPER_USED: "استخدمت هذه المساعدة من قبل.",
  NO_PLAYERS: "انتظر انضمام لاعب واحد على الأقل.",
  RATE_LIMIT: "طلبات كثيرة. انتظر لحظة وحاول مجددًا.",
  NOT_READY: "اللعبة غير مهيأة بعد في قاعدة البيانات.",
};
