const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 3000;
const STATIC_DIR = path.join(__dirname, "public");

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;
const SEGMENT_SIZE = 12;
const TICK_RATE = 20;
const MAX_PLAYERS_PER_ROOM = 8;
const DEFAULT_MODE_KEY = "classic";

const PLAYER_COLORS = [
  "#ff4d4f",
  "#40a9ff",
  "#52c41a",
  "#faad14",
  "#9254de",
  "#fa541c",
  "#eb2f96",
  "#13c2c2",
];

const POWERUP_TYPES = {
  SPEED: "speed",
  SHIELD: "shield",
  SHRINK: "shrink",
};

const POWERUP_EFFECT_TICKS = {
  [POWERUP_TYPES.SPEED]: TICK_RATE * 6,
  [POWERUP_TYPES.SHIELD]: TICK_RATE * 5,
  [POWERUP_TYPES.SHRINK]: TICK_RATE * 1,
};

const POWERUP_LABELS = {
  [POWERUP_TYPES.SPEED]: "속도 증가",
  [POWERUP_TYPES.SHIELD]: "무적",
  [POWERUP_TYPES.SHRINK]: "작아지기",
};

const POWERUP_ICONS = {
  [POWERUP_TYPES.SPEED]: "⚡",
  [POWERUP_TYPES.SHIELD]: "🛡",
  [POWERUP_TYPES.SHRINK]: "🌀",
};

const FOOD_TYPES = {
  BASIC: "basic",
  GOLDEN: "golden",
};

const FOOD_SCORES = {
  [FOOD_TYPES.BASIC]: 10,
  [FOOD_TYPES.GOLDEN]: 50,
};

const POWERUP_SCORES = {
  [POWERUP_TYPES.SPEED]: 20,
  [POWERUP_TYPES.SHIELD]: 20,
  [POWERUP_TYPES.SHRINK]: 15,
};

const ACHIEVEMENT_DEFINITIONS = {
  first_blood: {
    id: "first_blood",
    title: "퍼스트 블러드",
    description: "라운드 첫 번째 킬을 달성했습니다.",
    icon: "🩸",
  },
  survival_champion: {
    id: "survival_champion",
    title: "최후의 생존자",
    description: "라운드 종반까지 살아남아 승리했습니다.",
    icon: "👑",
  },
  golden_gourmet: {
    id: "golden_gourmet",
    title: "골든 미식가",
    description: "골든 음식을 2번 이상 섭취했습니다.",
    icon: "✨",
  },
  power_collector: {
    id: "power_collector",
    title: "파워업 수집가",
    description: "파워업을 3번 이상 획득했습니다.",
    icon: "🔋",
  },
  hunter: {
    id: "hunter",
    title: "헌터",
    description: "한 라운드에서 3킬 이상을 기록했습니다.",
    icon: "🎯",
  },
};

const GAME_MODES = {
  classic: {
    key: "classic",
    label: "클래식 모드",
    description: "표준 규격의 밸런스 모드",
    settings: {
      baseSpeed: 4,
      speedBoostMultiplier: 1.6,
      maxFood: 30,
      goldenFoodChance: 0.08,
      maxPowerups: 6,
      powerupSpawnChance: 0.05,
      countdownSeconds: 5,
      intermissionSeconds: 4,
      survivalBonusPerSecond: 2,
      winBonus: 200,
    },
  },
  battle: {
    key: "battle",
    label: "배틀 모드",
    description: "음식과 파워업이 풍부한 전투 모드",
    settings: {
      baseSpeed: 4,
      speedBoostMultiplier: 1.5,
      maxFood: 48,
      goldenFoodChance: 0.14,
      maxPowerups: 10,
      powerupSpawnChance: 0.12,
      countdownSeconds: 5,
      intermissionSeconds: 5,
      survivalBonusPerSecond: 3,
      winBonus: 220,
    },
  },
  speed: {
    key: "speed",
    label: "스피드 모드",
    description: "더 빠르고 치열한 속도전",
    settings: {
      baseSpeed: 5,
      speedBoostMultiplier: 1.85,
      maxFood: 26,
      goldenFoodChance: 0.1,
      maxPowerups: 5,
      powerupSpawnChance: 0.04,
      countdownSeconds: 4,
      intermissionSeconds: 3,
      survivalBonusPerSecond: 1,
      winBonus: 240,
    },
  },
  tournament: {
    key: "tournament",
    label: "토너먼트 모드",
    description: "여러 라운드로 최종 우승자를 결정",
    settings: {
      baseSpeed: 4,
      speedBoostMultiplier: 1.6,
      maxFood: 32,
      goldenFoodChance: 0.1,
      maxPowerups: 8,
      powerupSpawnChance: 0.08,
      countdownSeconds: 6,
      intermissionSeconds: 6,
      survivalBonusPerSecond: 3,
      winBonus: 180,
    },
    tournament: {
      roundsToWin: 3,
      intermissionSeconds: 8,
    },
  },
};

const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB = process.env.MONGODB_DB || "online_worm_battle";
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || "player_stats";
const MONGODB_EVENT_COLLECTION =
  process.env.MONGODB_EVENT_COLLECTION || "event_logs";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const resolveMode = (modeKey) => {
  return GAME_MODES[modeKey] || GAME_MODES[DEFAULT_MODE_KEY];
};

app.use(express.static(STATIC_DIR));

const rooms = new Map();

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
const DEFAULT_EVENT_LOG_LIMIT = 20;
const MAX_EVENT_LOG_LIMIT = 100;

const escapeRegex = (value) =>
  String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

const randomCoord = () => ({
  x:
    Math.floor(Math.random() * (WORLD_WIDTH / SEGMENT_SIZE)) * SEGMENT_SIZE +
    SEGMENT_SIZE / 2,
  y:
    Math.floor(Math.random() * (WORLD_HEIGHT / SEGMENT_SIZE)) * SEGMENT_SIZE +
    SEGMENT_SIZE / 2,
});

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

class StatsStore {
  constructor() {
    this.memory = new Map();
    this.mongoUri = MONGODB_URI;
    this.mongoDbName = MONGODB_DB;
    this.mongoCollectionName = MONGODB_COLLECTION;
    this.client = null;
    this.collection = null;
    this.db = null;
    this.mongoEventCollectionName = MONGODB_EVENT_COLLECTION;
    this.eventCollection = null;
    this.memoryEvents = [];
    this.eventBufferLimit = 400;
    this.connectPromise = null;
  }

  async ensureConnection() {
    if (this.collection) return this.collection;
    if (!this.mongoUri) return null;
    if (!this.connectPromise) {
      this.connectPromise = MongoClient.connect(this.mongoUri, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 2000,
      })
        .then((client) => {
          this.client = client;
          this.db = client.db(this.mongoDbName);
          this.collection = this.db.collection(this.mongoCollectionName);
          this.eventCollection = this.db.collection(
            this.mongoEventCollectionName
          );
          return this.collection;
        })
        .catch((error) => {
          console.error(
            "MongoDB 연결 실패, 메모리 통계를 사용합니다.",
            error.message
          );
          this.collection = null;
          this.eventCollection = null;
          this.db = null;
          return null;
        });
    }
    return this.connectPromise;
  }

  async ensureEventCollection() {
    if (this.eventCollection) return this.eventCollection;
    const baseCollection = await this.ensureConnection();
    if (!baseCollection || !this.client) {
      return null;
    }
    try {
      this.db = this.db || this.client.db(this.mongoDbName);
      this.eventCollection = this.db.collection(this.mongoEventCollectionName);
      return this.eventCollection;
    } catch (error) {
      console.error(
        "MongoDB 이벤트 로그 컬렉션 확보 실패, 메모리 로그를 사용합니다.",
        error.message
      );
      this.eventCollection = null;
      return null;
    }
  }

  buildEmptyProfile(name) {
    const now = Date.now();
    return {
      name,
      games: 0,
      wins: 0,
      totalScore: 0,
      totalSurvivalTicks: 0,
      kills: 0,
      bestScore: 0,
      bestKills: 0,
      achievements: {},
      lastColor: null,
      lastMode: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  recordInMemory({
    name,
    score,
    survivalTicks,
    kills,
    win,
    color,
    mode,
    achievements,
  }) {
    const snapshot = this.memory.get(name) || this.buildEmptyProfile(name);
    snapshot.games += 1;
    snapshot.totalScore += score;
    snapshot.totalSurvivalTicks += survivalTicks;
    snapshot.kills += kills;
    if (win) snapshot.wins += 1;
    snapshot.bestScore = Math.max(snapshot.bestScore, score);
    snapshot.bestKills = Math.max(snapshot.bestKills, kills);
    if (color) snapshot.lastColor = color;
    if (mode) snapshot.lastMode = mode;
    snapshot.updatedAt = Date.now();
    if (Array.isArray(achievements) && achievements.length) {
      snapshot.achievements = snapshot.achievements || {};
      for (const achievementId of achievements) {
        snapshot.achievements[achievementId] =
          (snapshot.achievements[achievementId] || 0) + 1;
      }
    }
    this.memory.set(name, snapshot);
  }

  async record(entry) {
    this.recordInMemory(entry);
    const collection = await this.ensureConnection();
    if (!collection) return;
    try {
      const update = {
        $inc: {
          games: 1,
          wins: entry.win ? 1 : 0,
          totalScore: entry.score,
          totalSurvivalTicks: entry.survivalTicks,
          kills: entry.kills,
        },
        $max: {
          bestScore: entry.score,
          bestKills: entry.kills,
        },
        $set: {
          updatedAt: new Date(),
          lastScore: entry.score,
          lastSurvivalTicks: entry.survivalTicks,
          lastKills: entry.kills,
          lastColor: entry.color || null,
          lastMode: entry.mode || null,
        },
        $setOnInsert: {
          createdAt: new Date(),
          bestScore: entry.score,
          bestKills: entry.kills,
        },
      };
      if (Array.isArray(entry.achievements) && entry.achievements.length) {
        update.$inc = update.$inc || {};
        for (const achievementId of entry.achievements) {
          const key = `achievements.${achievementId}`;
          update.$inc[key] = (update.$inc[key] || 0) + 1;
        }
      }
      await collection.updateOne({ name: entry.name }, update, {
        upsert: true,
      });
    } catch (error) {
      console.error(
        "MongoDB 통계 저장 실패, 메모리 통계로 대체합니다.",
        error.message
      );
    }
  }

  sanitizeEventLogEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const timestamp = Number.isFinite(raw.timestamp)
      ? raw.timestamp
      : Date.now();
    const base = {
      eventId:
        typeof raw.eventId === "string" ? raw.eventId : raw.id || uuidv4(),
      type: typeof raw.type === "string" ? raw.type : "event",
      roomId: typeof raw.roomId === "string" ? raw.roomId : null,
      roomName: typeof raw.roomName === "string" ? raw.roomName : null,
      round: Number.isFinite(raw.round) ? raw.round : null,
      mode: raw.mode || null,
      timestamp,
      highlight: Boolean(raw.highlight),
      tags: Array.isArray(raw.tags)
        ? raw.tags.slice(0, 12).map((tag) => String(tag).slice(0, 32))
        : [],
      participants:
        raw.participants && typeof raw.participants === "object"
          ? Object.entries(raw.participants).reduce((acc, [key, value]) => {
              if (!value || typeof value !== "object") return acc;
              const participant = {
                id: typeof value.id === "string" ? value.id : null,
                name: typeof value.name === "string" ? value.name : null,
                color: typeof value.color === "string" ? value.color : null,
              };
              acc[key] = participant;
              return acc;
            }, {})
          : {},
      meta:
        raw.meta && typeof raw.meta === "object"
          ? {
              cause: typeof raw.meta.cause === "string" ? raw.meta.cause : null,
              powerup:
                typeof raw.meta.powerup === "string" ? raw.meta.powerup : null,
              score: Number.isFinite(raw.meta.score) ? raw.meta.score : null,
            }
          : {},
      feed:
        raw.feed && typeof raw.feed === "object"
          ? {
              type: typeof raw.feed.type === "string" ? raw.feed.type : null,
              message:
                typeof raw.feed.message === "string" ? raw.feed.message : null,
              detail:
                typeof raw.feed.detail === "string" ? raw.feed.detail : null,
              accent:
                typeof raw.feed.accent === "string" ? raw.feed.accent : null,
              primaryId:
                typeof raw.feed.primaryId === "string"
                  ? raw.feed.primaryId
                  : null,
              secondaryId:
                typeof raw.feed.secondaryId === "string"
                  ? raw.feed.secondaryId
                  : null,
            }
          : null,
      context:
        raw.context && typeof raw.context === "object"
          ? {
              phase:
                typeof raw.context.phase === "string"
                  ? raw.context.phase
                  : null,
              playerCount: Number.isFinite(raw.context.playerCount)
                ? raw.context.playerCount
                : null,
              aliveCount: Number.isFinite(raw.context.aliveCount)
                ? raw.context.aliveCount
                : null,
              spectatorCount: Number.isFinite(raw.context.spectatorCount)
                ? raw.context.spectatorCount
                : null,
              leaderboard: Array.isArray(raw.context.leaderboard)
                ? raw.context.leaderboard.slice(0, 6).map((row) => ({
                    id: typeof row.id === "string" ? row.id : null,
                    name: typeof row.name === "string" ? row.name : null,
                    score: Number.isFinite(row.score) ? row.score : null,
                    kills: Number.isFinite(row.kills) ? row.kills : null,
                    alive: typeof row.alive === "boolean" ? row.alive : null,
                    color: typeof row.color === "string" ? row.color : null,
                  }))
                : [],
              tournament:
                raw.context.tournament &&
                typeof raw.context.tournament === "object"
                  ? {
                      roundsToWin: Number.isFinite(
                        raw.context.tournament.roundsToWin
                      )
                        ? raw.context.tournament.roundsToWin
                        : null,
                      championId:
                        typeof raw.context.tournament.championId === "string"
                          ? raw.context.tournament.championId
                          : null,
                      wins: Array.isArray(raw.context.tournament.wins)
                        ? raw.context.tournament.wins
                            .slice(0, 12)
                            .map((item) => ({
                              playerId:
                                typeof item.playerId === "string"
                                  ? item.playerId
                                  : null,
                              winCount: Number.isFinite(item.winCount)
                                ? item.winCount
                                : null,
                            }))
                        : [],
                    }
                  : null,
            }
          : {},
      payload:
        raw.payload && typeof raw.payload === "object"
          ? { ...raw.payload }
          : null,
    };
    return base;
  }

  async recordEventLog(entry) {
    const sanitized = this.sanitizeEventLogEntry(entry);
    if (!sanitized) return;
    this.memoryEvents.push(sanitized);
    if (this.memoryEvents.length > this.eventBufferLimit) {
      this.memoryEvents.splice(
        0,
        this.memoryEvents.length - this.eventBufferLimit
      );
    }
    const collection = await this.ensureEventCollection();
    if (!collection) return;
    try {
      const timestampMs = Number.isFinite(sanitized.timestamp)
        ? sanitized.timestamp
        : Date.now();
      const doc = {
        ...sanitized,
        timestamp: new Date(timestampMs),
        timestampMs,
        createdAt: new Date(),
      };
      await collection.insertOne(doc);
    } catch (error) {
      console.error(
        "MongoDB 이벤트 로그 저장 실패, 메모리 로그를 유지합니다.",
        error.message
      );
    }
  }

  normalizeEventLogEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const timestampMs = Number.isFinite(raw.timestampMs)
      ? raw.timestampMs
      : raw.timestamp instanceof Date
      ? raw.timestamp.getTime()
      : Number.isFinite(raw.timestamp)
      ? raw.timestamp
      : Date.now();
    let mode =
      raw.mode && typeof raw.mode === "object"
        ? {
            key: typeof raw.mode.key === "string" ? raw.mode.key : null,
            label: typeof raw.mode.label === "string" ? raw.mode.label : null,
          }
        : null;
    if (mode && !mode.key && !mode.label) {
      mode = null;
    }
    const normalizeParticipants = (value) => {
      if (!value || typeof value !== "object") return {};
      return Object.entries(value).reduce((acc, [key, participant]) => {
        if (!participant || typeof participant !== "object") return acc;
        acc[key] = {
          id: typeof participant.id === "string" ? participant.id : null,
          name: typeof participant.name === "string" ? participant.name : null,
          color:
            typeof participant.color === "string" ? participant.color : null,
        };
        return acc;
      }, {});
    };
    const normalizeLeaderboard = (rows) => {
      if (!Array.isArray(rows)) return [];
      return rows.slice(0, 6).map((row) => ({
        id: typeof row.id === "string" ? row.id : null,
        name: typeof row.name === "string" ? row.name : null,
        score: Number.isFinite(row.score) ? row.score : null,
        kills: Number.isFinite(row.kills) ? row.kills : null,
        alive: typeof row.alive === "boolean" ? row.alive : null,
        color: typeof row.color === "string" ? row.color : null,
      }));
    };
    const context =
      raw.context && typeof raw.context === "object"
        ? {
            phase:
              typeof raw.context.phase === "string" ? raw.context.phase : null,
            playerCount: Number.isFinite(raw.context.playerCount)
              ? raw.context.playerCount
              : null,
            aliveCount: Number.isFinite(raw.context.aliveCount)
              ? raw.context.aliveCount
              : null,
            spectatorCount: Number.isFinite(raw.context.spectatorCount)
              ? raw.context.spectatorCount
              : null,
            leaderboard: normalizeLeaderboard(raw.context.leaderboard),
            tournament:
              raw.context.tournament &&
              typeof raw.context.tournament === "object"
                ? {
                    roundsToWin: Number.isFinite(
                      raw.context.tournament.roundsToWin
                    )
                      ? raw.context.tournament.roundsToWin
                      : null,
                    championId:
                      typeof raw.context.tournament.championId === "string"
                        ? raw.context.tournament.championId
                        : null,
                    wins: Array.isArray(raw.context.tournament.wins)
                      ? raw.context.tournament.wins
                          .slice(0, 12)
                          .map((item) => ({
                            playerId:
                              typeof item.playerId === "string"
                                ? item.playerId
                                : null,
                            winCount: Number.isFinite(item.winCount)
                              ? item.winCount
                              : null,
                          }))
                      : [],
                  }
                : null,
          }
        : null;
    const feed =
      raw.feed && typeof raw.feed === "object"
        ? {
            type: typeof raw.feed.type === "string" ? raw.feed.type : null,
            message:
              typeof raw.feed.message === "string" ? raw.feed.message : null,
            detail:
              typeof raw.feed.detail === "string" ? raw.feed.detail : null,
            accent:
              typeof raw.feed.accent === "string" ? raw.feed.accent : null,
            primaryId:
              typeof raw.feed.primaryId === "string"
                ? raw.feed.primaryId
                : null,
            secondaryId:
              typeof raw.feed.secondaryId === "string"
                ? raw.feed.secondaryId
                : null,
          }
        : null;
    const meta =
      raw.meta && typeof raw.meta === "object"
        ? {
            cause: typeof raw.meta.cause === "string" ? raw.meta.cause : null,
            powerup:
              typeof raw.meta.powerup === "string" ? raw.meta.powerup : null,
            score: Number.isFinite(raw.meta.score) ? raw.meta.score : null,
          }
        : null;

    return {
      eventId:
        typeof raw.eventId === "string"
          ? raw.eventId
          : typeof raw.id === "string"
          ? raw.id
          : null,
      type: typeof raw.type === "string" ? raw.type : "event",
      timestamp: timestampMs,
      timestampIso: new Date(timestampMs).toISOString(),
      highlight: Boolean(raw.highlight),
      tags: Array.isArray(raw.tags)
        ? raw.tags.filter((tag) => typeof tag === "string").slice(0, 12)
        : [],
      roomId: typeof raw.roomId === "string" ? raw.roomId : null,
      roomName: typeof raw.roomName === "string" ? raw.roomName : null,
      round: Number.isFinite(raw.round) ? raw.round : null,
      mode,
      participants: normalizeParticipants(raw.participants),
      feed,
      meta,
      context,
      payload:
        raw.payload && typeof raw.payload === "object"
          ? { ...raw.payload }
          : null,
    };
  }

  memoryEventMatchesCriteria(event, criteria) {
    if (!event) return false;
    const {
      types,
      tags,
      roomId,
      highlight,
      before,
      mode,
      playerId,
      playerName,
      search,
    } = criteria;
    const timestamp = Number.isFinite(event.timestamp)
      ? event.timestamp
      : Date.now();
    if (before && !(timestamp < before)) return false;
    if (highlight !== undefined && Boolean(event.highlight) !== highlight)
      return false;
    if (roomId && event.roomId !== roomId) return false;
    if (mode) {
      const key =
        event.mode && typeof event.mode === "object" ? event.mode.key : null;
      if (key !== mode) return false;
    }
    if (Array.isArray(types) && types.length && !types.includes(event.type)) {
      return false;
    }
    if (Array.isArray(tags) && tags.length) {
      const eventTags = Array.isArray(event.tags) ? event.tags : [];
      if (!eventTags.some((tag) => tags.includes(tag))) return false;
    }
    const participants =
      event.participants && typeof event.participants === "object"
        ? Object.values(event.participants).filter(Boolean)
        : [];
    if (playerId) {
      if (!participants.some((participant) => participant.id === playerId))
        return false;
    }
    if (playerName) {
      const lower = playerName.toLowerCase();
      const participantMatch = participants.some(
        (participant) =>
          typeof participant.name === "string" &&
          participant.name.toLowerCase().includes(lower)
      );
      if (!participantMatch) return false;
    }
    if (search) {
      const lower = search.toLowerCase();
      const haystacks = [];
      if (event.feed?.message) haystacks.push(event.feed.message);
      if (event.feed?.detail) haystacks.push(event.feed.detail);
      participants.forEach((participant) => {
        if (participant?.name) {
          haystacks.push(participant.name);
        }
      });
      if (!haystacks.some((value) => value.toLowerCase().includes(lower))) {
        return false;
      }
    }
    return true;
  }

  async findEventLogs(options = {}) {
    const limit = clamp(
      Number.parseInt(options.limit, 10) || DEFAULT_EVENT_LOG_LIMIT,
      1,
      MAX_EVENT_LOG_LIMIT
    );
    const parseCursor = (value) => {
      if (value === null || value === undefined || value === "") return null;
      if (Number.isFinite(value)) return Number(value);
      const numeric = Number.parseInt(value, 10);
      if (Number.isFinite(numeric)) return numeric;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const before = parseCursor(options.before);
    const types = Array.isArray(options.types)
      ? options.types.filter(Boolean).slice(0, 6)
      : [];
    const tags = Array.isArray(options.tags)
      ? options.tags.filter(Boolean).slice(0, 6)
      : [];
    const highlight =
      typeof options.highlight === "boolean" ? options.highlight : undefined;
    const mode =
      typeof options.mode === "string" && options.mode ? options.mode : null;
    const playerId =
      typeof options.playerId === "string" && options.playerId
        ? options.playerId
        : null;
    const playerName =
      typeof options.playerName === "string" && options.playerName
        ? options.playerName
        : null;
    const search =
      typeof options.search === "string" && options.search
        ? options.search.trim()
        : null;
    const roomId =
      typeof options.roomId === "string" && options.roomId
        ? options.roomId
        : null;

    const criteria = {
      types,
      tags,
      roomId,
      highlight,
      before,
      mode,
      playerId,
      playerName,
      search,
    };

    const collection = await this.ensureEventCollection().catch(() => null);
    if (collection) {
      try {
        const filters = [];
        if (highlight !== undefined) filters.push({ highlight });
        if (roomId) filters.push({ roomId });
        if (mode) filters.push({ "mode.key": mode });
        if (before) filters.push({ timestampMs: { $lt: before } });
        if (types.length) filters.push({ type: { $in: types } });
        if (tags.length) filters.push({ tags: { $in: tags } });

        const participantOr = [];
        if (playerId) {
          participantOr.push({ "participants.killer.id": playerId });
          participantOr.push({ "participants.victim.id": playerId });
          participantOr.push({ "participants.player.id": playerId });
          participantOr.push({ "participants.winner.id": playerId });
        }
        if (playerName) {
          const regex = new RegExp(escapeRegex(playerName), "i");
          participantOr.push({ "participants.killer.name": regex });
          participantOr.push({ "participants.victim.name": regex });
          participantOr.push({ "participants.player.name": regex });
          participantOr.push({ "participants.winner.name": regex });
        }
        if (participantOr.length) {
          filters.push({ $or: participantOr });
        }

        if (search) {
          const regex = new RegExp(escapeRegex(search), "i");
          filters.push({
            $or: [
              { "feed.message": regex },
              { "feed.detail": regex },
              { "participants.killer.name": regex },
              { "participants.victim.name": regex },
              { "participants.player.name": regex },
              { "participants.winner.name": regex },
            ],
          });
        }

        const mongoQuery =
          filters.length === 0
            ? {}
            : filters.length === 1
            ? filters[0]
            : { $and: filters };

        const docs = await collection
          .find(mongoQuery)
          .sort({ timestampMs: -1, _id: -1 })
          .limit(limit + 1)
          .toArray();
        const hasMore = docs.length > limit;
        const trimmed = hasMore ? docs.slice(0, limit) : docs;
        const items = trimmed
          .map((doc) => this.normalizeEventLogEntry(doc))
          .filter(Boolean);
        const nextCursor =
          hasMore && trimmed.length
            ? trimmed[trimmed.length - 1].timestampMs
            : null;
        return {
          items,
          hasMore,
          nextCursor,
          nextCursorIso: nextCursor ? new Date(nextCursor).toISOString() : null,
          limit,
          source: "mongo",
        };
      } catch (error) {
        console.error(
          "이벤트 로그 조회 중 MongoDB 오류 발생, 메모리 로그로 대체합니다.",
          error.message
        );
      }
    }

    const sorted = [...this.memoryEvents].sort((a, b) => {
      const aTs = Number.isFinite(a.timestamp) ? a.timestamp : 0;
      const bTs = Number.isFinite(b.timestamp) ? b.timestamp : 0;
      return bTs - aTs;
    });
    const filtered = sorted.filter((event) =>
      this.memoryEventMatchesCriteria(event, criteria)
    );
    const sliced = filtered.slice(0, limit);
    const nextCursor =
      filtered.length > limit && sliced.length
        ? Number.isFinite(sliced[sliced.length - 1].timestamp)
          ? sliced[sliced.length - 1].timestamp
          : null
        : null;
    return {
      items: sliced
        .map((event) => this.normalizeEventLogEntry(event))
        .filter(Boolean),
      hasMore: filtered.length > limit,
      nextCursor,
      nextCursorIso: nextCursor ? new Date(nextCursor).toISOString() : null,
      limit,
      source: "memory",
    };
  }

  async rememberPreference({ name, color, mode }) {
    if (!name) return;
    const snapshot = this.memory.get(name) || this.buildEmptyProfile(name);
    const now = Date.now();
    if (color) snapshot.lastColor = color;
    if (mode) snapshot.lastMode = mode;
    snapshot.updatedAt = now;
    this.memory.set(name, snapshot);

    const collection = await this.ensureConnection();
    if (!collection) return;
    const update = {
      $set: {
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
        games: 0,
        wins: 0,
        totalScore: 0,
        totalSurvivalTicks: 0,
        kills: 0,
        bestScore: 0,
        bestKills: 0,
      },
    };
    if (color) update.$set.lastColor = color;
    if (mode) update.$set.lastMode = mode;
    try {
      await collection.updateOne({ name }, update, { upsert: true });
    } catch (error) {
      console.error("MongoDB 프로필 업데이트 실패:", error.message);
    }
  }

  async getProfile(name) {
    if (typeof name !== "string" || !name.trim()) {
      return this.buildEmptyProfile("unknown");
    }
    const safeName = name.trim();
    const memoryProfile = this.memory.get(safeName) || null;
    const collection = await this.ensureConnection();
    if (!collection) {
      return memoryProfile
        ? { ...memoryProfile }
        : this.buildEmptyProfile(safeName);
    }
    try {
      const doc = await collection.findOne(
        { name: safeName },
        {
          projection: {
            _id: 0,
            name: 1,
            games: 1,
            wins: 1,
            totalScore: 1,
            totalSurvivalTicks: 1,
            kills: 1,
            bestScore: 1,
            bestKills: 1,
            lastColor: 1,
            lastMode: 1,
            achievements: 1,
            updatedAt: 1,
            createdAt: 1,
          },
        }
      );
      if (!doc) {
        return memoryProfile
          ? { ...memoryProfile }
          : this.buildEmptyProfile(safeName);
      }
      return {
        name: doc.name,
        games: doc.games || 0,
        wins: doc.wins || 0,
        totalScore: doc.totalScore || 0,
        totalSurvivalTicks: doc.totalSurvivalTicks || 0,
        kills: doc.kills || 0,
        bestScore: doc.bestScore || 0,
        bestKills: doc.bestKills || 0,
        lastColor: doc.lastColor || memoryProfile?.lastColor || null,
        lastMode: doc.lastMode || memoryProfile?.lastMode || null,
        achievements: doc.achievements || memoryProfile?.achievements || {},
        updatedAt:
          doc.updatedAt instanceof Date ? doc.updatedAt.getTime() : Date.now(),
        createdAt:
          doc.createdAt instanceof Date
            ? doc.createdAt.getTime()
            : memoryProfile?.createdAt || Date.now(),
      };
    } catch (error) {
      console.error(
        "MongoDB 프로필 조회 실패, 메모리 프로필을 반환합니다.",
        error.message
      );
      return memoryProfile
        ? { ...memoryProfile }
        : this.buildEmptyProfile(safeName);
    }
  }

  async snapshot() {
    const collection = await this.ensureConnection();
    if (!collection) {
      return {
        updatedAt: Date.now(),
        players: [...this.memory.entries()].map(([name, stats]) => ({
          name,
          games: stats.games,
          wins: stats.wins,
          totalScore: stats.totalScore,
          totalSurvivalTicks: stats.totalSurvivalTicks,
          kills: stats.kills,
          bestScore: stats.bestScore || 0,
          bestKills: stats.bestKills || 0,
          lastColor: stats.lastColor || null,
          lastMode: stats.lastMode || null,
          achievements: stats.achievements || {},
          updatedAt: stats.updatedAt,
        })),
      };
    }
    try {
      const docs = await collection
        .find(
          {},
          {
            projection: {
              _id: 0,
              name: 1,
              games: 1,
              wins: 1,
              totalScore: 1,
              totalSurvivalTicks: 1,
              kills: 1,
              updatedAt: 1,
            },
          }
        )
        .limit(100)
        .toArray();
      const updatedAt = docs.reduce((latest, doc) => {
        const value =
          doc.updatedAt instanceof Date ? doc.updatedAt.getTime() : Date.now();
        return Math.max(latest, value);
      }, 0);
      return {
        updatedAt: updatedAt || Date.now(),
        players: docs.map((doc) => ({
          name: doc.name,
          games: doc.games || 0,
          wins: doc.wins || 0,
          totalScore: doc.totalScore || 0,
          totalSurvivalTicks: doc.totalSurvivalTicks || 0,
          kills: doc.kills || 0,
          bestScore: doc.bestScore || 0,
          bestKills: doc.bestKills || 0,
          lastColor: doc.lastColor || null,
          lastMode: doc.lastMode || null,
          achievements: doc.achievements || {},
          updatedAt:
            doc.updatedAt instanceof Date
              ? doc.updatedAt.getTime()
              : Date.now(),
        })),
      };
    } catch (error) {
      console.error(
        "MongoDB 통계 조회 실패, 메모리 통계로 대체합니다.",
        error.message
      );
      return {
        updatedAt: Date.now(),
        players: [...this.memory.entries()].map(([name, stats]) => ({
          name,
          games: stats.games,
          wins: stats.wins,
          totalScore: stats.totalScore,
          totalSurvivalTicks: stats.totalSurvivalTicks,
          kills: stats.kills,
          bestScore: stats.bestScore || 0,
          bestKills: stats.bestKills || 0,
          lastColor: stats.lastColor || null,
          lastMode: stats.lastMode || null,
          updatedAt: stats.updatedAt,
        })),
      };
    }
  }
}

const statsStore = new StatsStore();

class PlayerState {
  constructor({ id, name, color, socketId }) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.socketId = socketId;
    this.reset();
  }

  reset({ baseSpeed } = {}) {
    const effectiveBase =
      typeof baseSpeed === "number" ? baseSpeed : this.baseSpeed || 4;
    this.alive = true;
    this.direction = { x: 1, y: 0 };
    this.pendingDirection = { x: 1, y: 0 };
    this.segments = PlayerState.initialBody();
    this.growth = 0;
    this.baseSpeed = effectiveBase;
    this.speed = effectiveBase;
    this.effects = new Map();
    this.score = 0;
    this.kills = 0;
    this.lastTail = null;
    this.survivalTicks = 0;
    this.spawnTime = Date.now();
    this.survivalBonus = 0;
  }

  static initialBody() {
    const start = randomCoord();
    return [start];
  }
}

class RoomState {
  constructor({ id, name, hostId, isPrivate, modeKey }) {
    this.id = id;
    this.name = name;
    this.hostId = hostId;
    this.isPrivate = Boolean(isPrivate);
    this.mode = resolveMode(modeKey);
    this.modeKey = this.mode.key;
    this.settings = { ...this.mode.settings };
    this.players = new Map();
    this.spectators = new Set();
    this.colorsInUse = new Set();
    this.food = [];
    this.powerups = [];
    this.phase = "waiting";
    this.countdownTicks = 0;
    this.intermissionTicks = 0;
    this.frameHistory = [];
    this.round = 0;
    this.loop = null;
    this.pendingHighlights = [];
    this.roundHighlights = [];
    this.eventFeed = [];
    this.roundStats = new Map();
    this.firstKillAwardedTo = null;
    this.tournament = this.mode.tournament
      ? {
          roundsToWin: this.mode.tournament.roundsToWin,
          intermissionSeconds: this.mode.tournament.intermissionSeconds,
          wins: new Map(),
          championId: null,
          roundHistory: [],
        }
      : null;
  }

  ensureRoundStat(player) {
    if (!player) return null;
    let entry = this.roundStats.get(player.id);
    if (!entry) {
      entry = {
        playerId: player.id,
        name: player.name,
        color: player.color,
        kills: 0,
        deaths: 0,
        golden: 0,
        powerups: 0,
        food: 0,
      };
      this.roundStats.set(player.id, entry);
    }
    entry.name = player.name;
    entry.color = player.color;
    return entry;
  }

  queueHighlight(event) {
    const entry = {
      id: uuidv4(),
      timestamp: Date.now(),
      round: this.round,
      ...event,
    };
    this.pendingHighlights.push(entry);
    if (this.pendingHighlights.length > 12) {
      this.pendingHighlights = this.pendingHighlights.slice(-12);
    }
    const feedEntry = this.buildEventFeedEntry(entry);
    if (feedEntry) {
      this.pushEventFeed(feedEntry);
    }
    this.persistHighlight(entry, feedEntry);
    return entry;
  }

  serializeParticipant(id, fallbackName, fallbackColor) {
    if (!id) return null;
    const player = this.players.get(id);
    return {
      id,
      name: player?.name || fallbackName || null,
      color: player?.color || fallbackColor || null,
    };
  }

  persistHighlight(entry, feedEntry) {
    if (!entry) return;
    try {
      const participants = {};
      const assignParticipant = (key, id, name, color) => {
        const participant = this.serializeParticipant(id, name, color);
        if (participant) participants[key] = participant;
      };
      assignParticipant(
        "killer",
        entry.killerId,
        entry.killerName,
        entry.killerColor
      );
      assignParticipant(
        "victim",
        entry.victimId,
        entry.victimName,
        entry.victimColor
      );
      assignParticipant(
        "player",
        entry.playerId,
        entry.playerName,
        entry.playerColor
      );
      assignParticipant(
        "winner",
        entry.winnerId,
        entry.winnerName,
        entry.winnerColor
      );

      const leaderboardSnapshot = this.buildLeaderboard()
        .slice(0, 5)
        .map((row) => ({
          id: row.id,
          name: row.name,
          score: row.score,
          kills: row.kills,
          alive: row.alive,
          color: row.color,
        }));

      const logPayload = {
        eventId: entry.id,
        type: entry.type,
        timestamp: entry.timestamp,
        roomId: this.id,
        roomName: this.name,
        mode: {
          key: this.modeKey,
          label: this.mode.label,
        },
        round: Number.isFinite(entry.round) ? entry.round : this.round,
        highlight: true,
        tags: this.deriveHighlightTags(entry),
        participants,
        meta: {
          cause: entry.cause || null,
          powerup: entry.powerup || null,
          score: Number.isFinite(entry.score) ? entry.score : null,
        },
        feed: feedEntry
          ? {
              type: feedEntry.type,
              message: feedEntry.message,
              detail: feedEntry.detail,
              accent: feedEntry.accent,
              primaryId: feedEntry.primaryId || null,
              secondaryId: feedEntry.secondaryId || null,
            }
          : null,
        context: {
          phase: this.phase,
          playerCount: this.players.size,
          aliveCount: [...this.players.values()].filter(
            (player) => player.alive
          ).length,
          spectatorCount: this.spectators.size,
          leaderboard: leaderboardSnapshot,
          tournament: this.tournament
            ? {
                roundsToWin: this.tournament.roundsToWin,
                championId: this.tournament.championId || null,
                wins: [...this.tournament.wins.entries()].map(
                  ([playerId, winCount]) => ({
                    playerId,
                    winCount,
                  })
                ),
              }
            : null,
        },
      };

      statsStore.recordEventLog(logPayload);
    } catch (error) {
      console.error(
        "이벤트 로그 영구 저장 준비에 실패했습니다.",
        error.message
      );
    }
  }

  buildEventFeedEntry(event) {
    if (!event || !event.type) return null;
    switch (event.type) {
      case "kill": {
        const killerId =
          event.killerId && event.killerId !== event.victimId
            ? event.killerId
            : null;
        const killerName = killerId ? event.killerName : null;
        const victimName = event.victimName || "플레이어";
        const message = killerName
          ? `${killerName} ▶ ${victimName}`
          : `${victimName} 탈락`;
        const causeLabel = this.describeKillCause(event.cause, killerName);
        const accent = killerName ? event.killerColor : event.victimColor;
        return {
          type: "kill",
          message,
          detail: causeLabel,
          accent: accent || "#ff4d4f",
          primaryId: killerId || event.victimId || null,
          secondaryId: killerId ? event.victimId || null : null,
        };
      }
      case "golden-food": {
        const name = event.playerName || "플레이어";
        const message = `${name} 골든 음식!`;
        const detail = Number.isFinite(event.score)
          ? `누적 ${event.score}점`
          : null;
        return {
          type: "golden-food",
          message,
          detail,
          accent: event.playerColor || "#f5b301",
          primaryId: event.playerId || null,
        };
      }
      case "powerup": {
        const label = POWERUP_LABELS[event.powerup] || "파워업";
        const name = event.playerName || "플레이어";
        return {
          type: "powerup",
          message: `${name} ${label} 획득`,
          detail: null,
          accent: event.playerColor || "#13c2c2",
          primaryId: event.playerId || null,
          meta: { powerup: event.powerup },
        };
      }
      case "round-end": {
        const roundNumber = Number.isFinite(event.round)
          ? event.round
          : this.round;
        const winner = event.winnerName || null;
        return {
          type: "round-end",
          message: `라운드 ${roundNumber} 종료`,
          detail: winner ? `${winner} 승리` : "무승부",
          accent: event.winnerColor || "#faad14",
          primaryId: event.winnerId || null,
        };
      }
      default:
        return null;
    }
  }

  describeKillCause(cause, hasKiller) {
    switch (cause) {
      case "collision":
        return hasKiller ? "충돌 승리" : "자기 몸에 부딪힘";
      case "wall":
        return "벽에 충돌";
      case "self":
        return "자기 몸에 부딪힘";
      default:
        return null;
    }
  }

  pushEventFeed(payload = {}) {
    const entry = {
      id: uuidv4(),
      timestamp: Date.now(),
      ...payload,
    };
    this.eventFeed.push(entry);
    const maxSize = 10;
    if (this.eventFeed.length > maxSize) {
      this.eventFeed.splice(0, this.eventFeed.length - maxSize);
    }
    return entry;
  }

  assignColor(preferredColor) {
    if (
      preferredColor &&
      PLAYER_COLORS.includes(preferredColor) &&
      !this.colorsInUse.has(preferredColor)
    ) {
      this.colorsInUse.add(preferredColor);
      return preferredColor;
    }
    for (const color of PLAYER_COLORS) {
      if (!this.colorsInUse.has(color)) {
        this.colorsInUse.add(color);
        return color;
      }
    }
    return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
  }

  isColorAvailable(color, ignorePlayerId) {
    if (!PLAYER_COLORS.includes(color)) return false;
    if (!this.colorsInUse.has(color)) return true;
    for (const player of this.players.values()) {
      if (player.id === ignorePlayerId) continue;
      if (player.color === color) {
        return false;
      }
    }
    return true;
  }

  changePlayerColor(playerId, color) {
    const player = this.players.get(playerId);
    if (!player) {
      return { error: "플레이어를 찾을 수 없습니다." };
    }
    if (this.phase === "running") {
      return { error: "게임 중에는 색상을 변경할 수 없습니다." };
    }
    if (!this.isColorAvailable(color, playerId)) {
      return { error: "해당 색상은 사용할 수 없습니다." };
    }
    this.colorsInUse.delete(player.color);
    player.color = color;
    this.colorsInUse.add(color);
    return { success: true, color };
  }

  addPlayer(player) {
    this.players.set(player.id, player);
    this.spectators.delete(player.socketId);
    this.ensureLoop();
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    this.colorsInUse.delete(player.color);
    this.players.delete(playerId);
  }

  ensureLoop() {
    if (!this.loop) {
      this.loop = setInterval(() => this.update(), 1000 / TICK_RATE);
    }
  }

  beginCountdown() {
    if (this.players.size < 1) {
      this.phase = "waiting";
      this.countdownTicks = 0;
      return;
    }
    this.phase = "countdown";
    const seconds = this.settings.countdownSeconds || 5;
    this.countdownTicks = Math.max(1, Math.round(seconds * TICK_RATE));
    this.frameHistory = [];
  }

  stopLoopIfEmpty() {
    if (this.loop && this.players.size === 0 && this.spectators.size === 0) {
      clearInterval(this.loop);
      this.loop = null;
    }
  }

  broadcast(event, payload) {
    io.to(this.id).emit(event, payload);
  }

  tickPhase() {
    if (this.phase === "waiting") {
      if (this.players.size >= 1) {
        this.beginCountdown();
      }
    } else if (this.phase === "countdown") {
      if (this.players.size < 1) {
        this.phase = "waiting";
        this.countdownTicks = 0;
        return;
      }
      this.countdownTicks -= 1;
      if (this.countdownTicks <= 0) {
        this.startMatch();
      }
    } else if (this.phase === "intermission") {
      if (this.players.size < 1) {
        this.phase = "waiting";
        this.intermissionTicks = 0;
        return;
      }
      if (this.tournament?.championId) {
        this.phase = "waiting";
        return;
      }
      this.intermissionTicks -= 1;
      if (this.intermissionTicks <= 0) {
        this.beginCountdown();
      }
    }
  }

  startMatch() {
    if (this.players.size < 1) {
      this.phase = "waiting";
      this.food = [];
      this.powerups = [];
      return;
    }
    this.phase = "running";
    this.round += 1;
    this.frameHistory = [];
    this.pendingHighlights = [];
    this.roundHighlights = [];
    this.eventFeed = [];
    this.roundStats = new Map();
    this.firstKillAwardedTo = null;
    for (const player of this.players.values()) {
      player.reset({ baseSpeed: this.settings.baseSpeed });
    }
    this.food = [];
    this.powerups = [];
    while (this.food.length < this.settings.maxFood) {
      this.spawnFood();
    }
    this.intermissionTicks = 0;
  }

  spawnFood() {
    const type =
      Math.random() < (this.settings.goldenFoodChance || 0.08)
        ? FOOD_TYPES.GOLDEN
        : FOOD_TYPES.BASIC;
    const coord = randomCoord();
    this.food.push({
      id: uuidv4(),
      type,
      x: coord.x,
      y: coord.y,
    });
  }

  spawnPowerup() {
    const types = Object.values(POWERUP_TYPES);
    const type = types[Math.floor(Math.random() * types.length)];
    const coord = randomCoord();
    this.powerups.push({
      id: uuidv4(),
      type,
      x: coord.x,
      y: coord.y,
    });
  }

  handleMovement(player) {
    if (!player.alive) return;
    player.direction = player.pendingDirection;
    const head = player.segments[0];
    const boostMultiplier = player.effects.has(POWERUP_TYPES.SPEED)
      ? this.settings.speedBoostMultiplier
      : 1;
    const dx = player.direction.x * player.speed * boostMultiplier;
    const dy = player.direction.y * player.speed * boostMultiplier;
    const newHead = {
      x: head.x + dx,
      y: head.y + dy,
    };

    const clampedX = clamp(
      newHead.x,
      SEGMENT_SIZE / 2,
      WORLD_WIDTH - SEGMENT_SIZE / 2
    );
    const clampedY = clamp(
      newHead.y,
      SEGMENT_SIZE / 2,
      WORLD_HEIGHT - SEGMENT_SIZE / 2
    );
    if (clampedX !== newHead.x || clampedY !== newHead.y) {
      this.killPlayer(player, null, "wall");
      return;
    }

    player.segments.unshift(newHead);
    if (player.growth > 0) {
      player.growth -= 1;
    } else {
      player.lastTail = player.segments.pop();
    }
    player.survivalTicks += 1;
  }

  handleFoodAndPowerups(player) {
    if (!player.alive) return;
    const head = player.segments[0];
    const stats = this.ensureRoundStat(player);
    for (let i = this.food.length - 1; i >= 0; i -= 1) {
      const meal = this.food[i];
      if (distance(head, meal) < SEGMENT_SIZE) {
        player.score += FOOD_SCORES[meal.type];
        if (stats) {
          stats.food = (stats.food || 0) + 1;
        }
        player.growth += meal.type === FOOD_TYPES.GOLDEN ? 6 : 3;
        if (meal.type === FOOD_TYPES.GOLDEN) {
          if (stats) {
            stats.golden = (stats.golden || 0) + 1;
          }
          this.queueHighlight({
            type: "golden-food",
            playerId: player.id,
            playerName: player.name,
            playerColor: player.color,
            score: player.score,
          });
          player.speed = player.baseSpeed + 1;
        }
        this.food.splice(i, 1);
        this.spawnFood();
      }
    }

    for (let i = this.powerups.length - 1; i >= 0; i -= 1) {
      const power = this.powerups[i];
      if (distance(head, power) < SEGMENT_SIZE) {
        player.score += POWERUP_SCORES[power.type];
        this.applyPowerup(player, power.type);
        this.powerups.splice(i, 1);
      }
    }

    const foodRespawnChance = this.settings.foodRespawnChance ?? 0.2;
    if (
      this.food.length < this.settings.maxFood &&
      Math.random() < foodRespawnChance
    ) {
      this.spawnFood();
    }
    if (
      this.powerups.length < this.settings.maxPowerups &&
      Math.random() < (this.settings.powerupSpawnChance || 0.05)
    ) {
      this.spawnPowerup();
    }
  }

  applyPowerup(player, type) {
    const stats = this.ensureRoundStat(player);
    if (stats) {
      stats.powerups = (stats.powerups || 0) + 1;
    }
    this.queueHighlight({
      type: "powerup",
      powerup: type,
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color,
      score: player.score,
    });
    if (type === POWERUP_TYPES.SHRINK) {
      const removeCount = Math.floor(player.segments.length * 0.25);
      for (let i = 0; i < removeCount; i += 1) {
        if (player.segments.length > 1) {
          player.segments.pop();
        }
      }
    }
    const totalTicks = POWERUP_EFFECT_TICKS[type] || TICK_RATE * 4;
    player.effects.set(type, { remaining: totalTicks, total: totalTicks });
  }

  handleEffectTimers(player) {
    for (const [effect, data] of [...player.effects.entries()]) {
      const remaining =
        typeof data === "object" && data !== null ? data.remaining : data;
      const total =
        typeof data === "object" &&
        data !== null &&
        typeof data.total === "number"
          ? data.total
          : POWERUP_EFFECT_TICKS[effect] || TICK_RATE * 4;
      const next = (typeof remaining === "number" ? remaining : 0) - 1;
      if (next <= 0) {
        if (effect === POWERUP_TYPES.SPEED) {
          player.speed = player.baseSpeed;
        }
        player.effects.delete(effect);
      } else {
        player.effects.set(effect, { remaining: next, total });
      }
    }
  }

  handleCollisions() {
    const alivePlayers = [...this.players.values()].filter((p) => p.alive);
    for (const player of alivePlayers) {
      const head = player.segments[0];
      for (const other of this.players.values()) {
        if (!other.alive) continue;
        const segments = other.segments;
        const startIndex = other === player ? 1 : 0;
        for (let i = startIndex; i < segments.length; i += 1) {
          if (distance(head, segments[i]) < SEGMENT_SIZE * 0.8) {
            if (player.effects.has(POWERUP_TYPES.SHIELD)) {
              player.effects.delete(POWERUP_TYPES.SHIELD);
              continue;
            }
            this.killPlayer(player, other.id, "collision");
            break;
          }
        }
        if (!player.alive) break;
      }
    }
  }

  applySurvivalBonuses() {
    const bonusPerSecond = this.settings.survivalBonusPerSecond || 0;
    if (!bonusPerSecond) return;
    for (const player of this.players.values()) {
      const seconds = Math.floor(player.survivalTicks / TICK_RATE);
      if (seconds <= 0) continue;
      const bonus = seconds * bonusPerSecond;
      player.score += bonus;
      player.survivalBonus = bonus;
    }
  }

  handleTournamentOutcome(winner) {
    if (!this.tournament || !winner) return;
    const wins = this.tournament.wins;
    const current = (wins.get(winner.id) || 0) + 1;
    wins.set(winner.id, current);
    this.tournament.lastWinnerId = winner.id;
    if (current >= this.tournament.roundsToWin) {
      this.tournament.championId = winner.id;
      this.tournament.championAnnouncedAt = Date.now();
    }
  }

  recordTournamentRoundSummary({ highlightPackage, winner }) {
    if (!this.tournament || !highlightPackage) return;
    const now = Date.now();
    const summaryEntry = {
      id: uuidv4(),
      round: this.round,
      timestamp: now,
      winnerId: winner?.id || null,
      winnerName: winner?.name || null,
      winnerColor: winner?.color || null,
      summary: highlightPackage.summary || null,
      keyEvents: Array.isArray(highlightPackage.keyEvents)
        ? highlightPackage.keyEvents.slice(0, 4).map((event) => ({
            id: event.id,
            type: event.type,
            title: event.title,
            subtitle: event.subtitle,
            icon: event.icon,
            accent: event.accent,
            timestamp: event.timestamp || now,
          }))
        : [],
      topStats: Array.isArray(highlightPackage.stats)
        ? [...highlightPackage.stats]
            .sort((a, b) => b.score - a.score || b.kills - a.kills)
            .slice(0, 3)
            .map((stat) => ({
              playerId: stat.playerId,
              name: stat.name,
              color: stat.color,
              score: stat.score,
              kills: stat.kills,
              golden: stat.golden,
              powerups: stat.powerups,
              survivalSeconds: stat.survivalSeconds,
            }))
        : [],
    };
    this.tournament.roundHistory = this.tournament.roundHistory || [];
    this.tournament.roundHistory.push(summaryEntry);
    const maxEntries = Math.max(6, this.tournament.roundsToWin * 2);
    if (this.tournament.roundHistory.length > maxEntries) {
      this.tournament.roundHistory.splice(
        0,
        this.tournament.roundHistory.length - maxEntries
      );
    }
  }

  serializeTournament() {
    if (!this.tournament) return { enabled: false };
    const wins = [...this.tournament.wins.entries()].map(
      ([playerId, winCount]) => {
        const player = this.players.get(playerId);
        return {
          playerId,
          wins: winCount,
          name: player?.name || "탈퇴한 플레이어",
          color: player?.color || PLAYER_COLORS[0],
        };
      }
    );
    for (const player of this.players.values()) {
      if (!wins.find((entry) => entry.playerId === player.id)) {
        wins.push({
          playerId: player.id,
          wins: 0,
          name: player.name,
          color: player.color,
        });
      }
    }
    wins.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.name.localeCompare(b.name);
    });
    return {
      enabled: true,
      roundsToWin: this.tournament.roundsToWin,
      wins,
      roundHistory: (this.tournament.roundHistory || []).map((entry) => ({
        id: entry.id,
        round: entry.round,
        timestamp: entry.timestamp,
        winnerId: entry.winnerId,
        winnerName: entry.winnerName,
        winnerColor: entry.winnerColor,
        summary: entry.summary
          ? {
              winnerId: entry.summary.winnerId || null,
              winnerName: entry.summary.winnerName || null,
              round: entry.summary.round,
              topKiller: entry.summary.topKiller
                ? {
                    playerId: entry.summary.topKiller.playerId,
                    name: entry.summary.topKiller.name,
                    color: entry.summary.topKiller.color,
                    kills: entry.summary.topKiller.kills,
                    score: entry.summary.topKiller.score,
                  }
                : null,
              goldenCollector: entry.summary.goldenCollector
                ? {
                    playerId: entry.summary.goldenCollector.playerId,
                    name: entry.summary.goldenCollector.name,
                    color: entry.summary.goldenCollector.color,
                    golden: entry.summary.goldenCollector.golden,
                    score: entry.summary.goldenCollector.score,
                  }
                : null,
              survivor: entry.summary.survivor
                ? {
                    playerId: entry.summary.survivor.playerId,
                    name: entry.summary.survivor.name,
                    color: entry.summary.survivor.color,
                    survivalSeconds: entry.summary.survivor.survivalSeconds,
                    score: entry.summary.survivor.score,
                  }
                : null,
            }
          : null,
        keyEvents: Array.isArray(entry.keyEvents)
          ? entry.keyEvents.map((event) => ({
              id: event.id,
              type: event.type,
              title: event.title,
              subtitle: event.subtitle,
              icon: event.icon,
              accent: event.accent,
              timestamp: event.timestamp,
            }))
          : [],
        topStats: Array.isArray(entry.topStats)
          ? entry.topStats.map((stat) => ({
              playerId: stat.playerId,
              name: stat.name,
              color: stat.color,
              score: stat.score,
              kills: stat.kills,
              golden: stat.golden,
              powerups: stat.powerups,
              survivalSeconds: stat.survivalSeconds,
            }))
          : [],
      })),
      championId: this.tournament.championId,
      lastWinnerId: this.tournament.lastWinnerId || null,
      currentRound: this.round,
      intermissionRemaining:
        this.phase === "intermission"
          ? Math.ceil(this.intermissionTicks / TICK_RATE)
          : 0,
    };
  }

  killPlayer(player, killerId, cause) {
    if (!player.alive) return;
    player.alive = false;
    player.deathCause = cause;
    player.deathTick = Date.now();
    const victimStats = this.ensureRoundStat(player);
    if (victimStats) {
      victimStats.deaths = (victimStats.deaths || 0) + 1;
    }
    let killer = null;
    if (killerId && killerId !== player.id) {
      killer = this.players.get(killerId);
      if (killer) {
        killer.score += 100;
        killer.kills += 1;
        const killerStats = this.ensureRoundStat(killer);
        if (killerStats) {
          killerStats.kills = (killerStats.kills || 0) + 1;
        }
        if (!this.firstKillAwardedTo) {
          this.firstKillAwardedTo = killer.id;
        }
      }
    }
    this.queueHighlight({
      type: "kill",
      killerId: killer?.id || null,
      killerName: killer?.name || null,
      killerColor: killer?.color || null,
      victimId: player.id,
      victimName: player.name,
      victimColor: player.color,
      cause,
    });
    if (player.lastTail) {
      this.food.push({
        id: uuidv4(),
        type: FOOD_TYPES.BASIC,
        x: player.lastTail.x,
        y: player.lastTail.y,
      });
    }
  }

  checkMatchEnd() {
    if (this.phase !== "running") return;
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (alive.length === 0) {
      const winner = alive[0] || null;
      if (winner) {
        winner.score += this.settings.winBonus || 0;
      }
      this.applySurvivalBonuses();
      if (this.tournament) {
        this.handleTournamentOutcome(winner);
      }
      if (winner && this.tournament?.championId === winner.id) {
        this.broadcast("room:notification", {
          id: uuidv4(),
          type: "success",
          message: `${winner.name}님이 토너먼트 우승을 차지했습니다!`,
          timestamp: Date.now(),
        });
      }
      this.queueHighlight({
        type: "round-end",
        winnerId: winner?.id || null,
        winnerName: winner?.name || null,
        winnerColor: winner?.color || null,
      });
      const achievementMap = this.gatherRoundAchievements({ winner });
      for (const player of this.players.values()) {
        const isWinner = winner ? winner.id === player.id : false;
        const isChampion = this.tournament?.championId === player.id;
        const earned = achievementMap.get(player.id) || [];
        this.recordGlobalStats(player, isChampion || isWinner, earned);
      }
      const highlightPackage = this.buildHighlightPackage({ winner });
      this.recordTournamentRoundSummary({ highlightPackage, winner });
      this.broadcast("game:ended", {
        winnerId: winner?.id || null,
        leaderboard: this.buildLeaderboard(),
        tournament: this.serializeTournament(),
        highlights: highlightPackage,
        achievements: this.serializeAchievements(achievementMap),
      });
      if (
        this.tournament &&
        !this.tournament.championId &&
        this.players.size >= 2
      ) {
        this.phase = "intermission";
        const waitSeconds =
          this.tournament.intermissionSeconds ||
          this.settings.intermissionSeconds ||
          5;
        this.intermissionTicks = Math.max(
          1,
          Math.round(waitSeconds * TICK_RATE)
        );
      } else {
        this.phase = "ended";
      }
    }
  }

  recordGlobalStats(player, isWinner, achievements = []) {
    statsStore
      .record({
        name: player.name,
        score: player.score,
        survivalTicks: player.survivalTicks,
        kills: player.kills,
        win: Boolean(isWinner),
        color: player.color,
        mode: this.modeKey,
        achievements,
      })
      .then(() => this.pushProfileUpdate(player))
      .catch((error) => {
        console.error("통계 기록 실패:", error.message);
      });
  }

  pushProfileUpdate(player) {
    statsStore
      .getProfile(player.name)
      .then((profile) => {
        if (!profile) return;
        io.to(player.socketId).emit("player:profile", profile);
      })
      .catch((error) => {
        console.error("프로필 갱신 실패:", error.message);
      });
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      mode: {
        key: this.modeKey,
        label: this.mode.label,
        description: this.mode.description,
      },
      phase: this.phase,
      countdown: Math.ceil(this.countdownTicks / TICK_RATE),
      intermission:
        this.phase === "intermission"
          ? Math.ceil(this.intermissionTicks / TICK_RATE)
          : 0,
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        alive: player.alive,
        direction: player.direction,
        segments: player.segments,
        score: player.score,
        kills: player.kills,
        effects: [...player.effects.entries()].map(([effect, data]) => ({
          type: effect,
          remaining: Math.max(
            0,
            Math.round(
              typeof data === "object" &&
                data !== null &&
                typeof data.remaining === "number"
                ? data.remaining
                : Number(data) || 0
            )
          ),
          total: Math.max(
            0,
            Math.round(
              typeof data === "object" &&
                data !== null &&
                typeof data.total === "number"
                ? data.total
                : POWERUP_EFFECT_TICKS[effect] || TICK_RATE * 4
            )
          ),
        })),
      })),
      food: this.food,
      powerups: this.powerups,
      leaderboard: this.buildLeaderboard(),
      events: this.eventFeed.map((entry) => ({ ...entry })),
      round: this.round,
      timestamp: Date.now(),
      tournament: this.serializeTournament(),
    };
  }

  buildLeaderboard() {
    return [...this.players.values()]
      .map((player) => ({
        id: player.id,
        name: player.name,
        score: player.score,
        kills: player.kills,
        alive: player.alive,
        color: player.color,
      }))
      .sort((a, b) => b.score - a.score);
  }

  gatherRoundAchievements({ winner }) {
    const achievements = new Map();
    for (const player of this.players.values()) {
      const stats = this.roundStats.get(player.id) || {};
      const earned = [];
      if (
        this.firstKillAwardedTo &&
        this.firstKillAwardedTo === player.id &&
        (player.kills || 0) > 0
      ) {
        earned.push("first_blood");
      }
      if (winner && winner.id === player.id) {
        earned.push("survival_champion");
      }
      if ((stats.golden || 0) >= 2) {
        earned.push("golden_gourmet");
      }
      if ((stats.powerups || 0) >= 3) {
        earned.push("power_collector");
      }
      if ((player.kills || 0) >= 3) {
        earned.push("hunter");
      }
      if (earned.length) {
        achievements.set(player.id, earned);
      }
    }
    return achievements;
  }

  serializeAchievements(achievementMap) {
    const results = [];
    for (const [playerId, ids] of achievementMap.entries()) {
      const player = this.players.get(playerId);
      if (!player) continue;
      const earned = ids
        .map((id) => ACHIEVEMENT_DEFINITIONS[id])
        .filter(Boolean)
        .map((definition) => ({
          id: definition.id,
          title: definition.title,
          description: definition.description,
          icon: definition.icon,
        }));
      if (!earned.length) continue;
      earned.sort((a, b) => a.title.localeCompare(b.title, "ko"));
      results.push({
        playerId,
        name: player.name,
        color: player.color,
        achievements: earned,
      });
    }
    results.sort((a, b) => {
      if (b.achievements.length !== a.achievements.length) {
        return b.achievements.length - a.achievements.length;
      }
      return a.name.localeCompare(b.name, "ko");
    });
    return results;
  }

  buildRoundStatsSnapshot() {
    const snapshot = [];
    for (const player of this.players.values()) {
      const stats = this.roundStats.get(player.id) || {};
      snapshot.push({
        playerId: player.id,
        name: player.name,
        color: player.color,
        score: player.score,
        kills: player.kills,
        deaths: stats.deaths || 0,
        golden: stats.golden || 0,
        powerups: stats.powerups || 0,
        food: stats.food || 0,
        survivalSeconds: Math.round(player.survivalTicks / TICK_RATE),
      });
    }
    return snapshot;
  }

  describeHighlight(event) {
    switch (event.type) {
      case "kill": {
        if (event.killerName) {
          return {
            title: `${event.killerName}의 결정타`,
            subtitle: `${event.killerName} ▶ ${event.victimName} (${
              event.cause === "collision" ? "충돌 승" : "환경 탈락"
            })`,
          };
        }
        return {
          title: `${event.victimName} 탈락`,
          subtitle: event.cause === "wall" ? "벽과 충돌" : "자기 몸에 부딪힘",
        };
      }
      case "golden-food":
        return {
          title: `${event.playerName} 골든 음식 획득`,
          subtitle: "대량 성장 & 추가 점수 확보",
        };
      case "powerup": {
        const label =
          POWERUP_TYPES.SHIELD === event.powerup
            ? "무적"
            : POWERUP_TYPES.SPEED === event.powerup
            ? "속도"
            : "축소";
        return {
          title: `${event.playerName} ${label} 파워업`,
          subtitle: "상황을 뒤집을 준비 완료",
        };
      }
      case "round-end":
        return {
          title: `${
            event.winnerName ? `${event.winnerName} 승리` : "라운드 종료"
          }`,
          subtitle: event.winnerName
            ? "토너먼트 포인트 획득!"
            : "생존자가 없습니다",
        };
      default:
        return {
          title: "하이라이트",
          subtitle: "",
        };
    }
  }

  buildRoundSummary(stats, winner) {
    if (!stats.length) {
      return {
        winnerId: winner?.id || null,
        winnerName: winner?.name || null,
        round: this.round,
      };
    }
    const byKills = [...stats].sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills;
      return b.score - a.score;
    });
    const byGolden = [...stats].sort((a, b) => {
      if ((b.golden || 0) !== (a.golden || 0))
        return (b.golden || 0) - (a.golden || 0);
      return b.score - a.score;
    });
    const bySurvival = [...stats].sort(
      (a, b) => b.survivalSeconds - a.survivalSeconds
    );
    return {
      winnerId: winner?.id || null,
      winnerName: winner?.name || null,
      round: this.round,
      topKiller: byKills[0]?.kills ? byKills[0] : null,
      goldenCollector: byGolden[0]?.golden ? byGolden[0] : null,
      survivor: bySurvival[0] || null,
    };
  }

  buildHighlightPackage({ winner } = {}) {
    const stats = this.buildRoundStatsSnapshot();
    const sortedEvents = [...this.roundHighlights].sort(
      (a, b) => a.timestamp - b.timestamp
    );
    const selectedEvents = [...sortedEvents];
    while (selectedEvents.length > 5) {
      const removableIndex = selectedEvents.findIndex(
        (event) => event.type !== "kill"
      );
      if (removableIndex > -1) {
        selectedEvents.splice(removableIndex, 1);
      } else {
        selectedEvents.shift();
      }
    }
    const lastFrameIndex = this.frameHistory.length
      ? this.frameHistory.length - 1
      : 0;
    const clips = selectedEvents.map((event) => {
      const windowFrames = Math.round(TICK_RATE * 2);
      const startFrame = Math.max(0, (event.frameIndex || 0) - windowFrames);
      const endFrame = Math.min(
        lastFrameIndex,
        (event.frameIndex || 0) + windowFrames
      );
      const frames = this.frameHistory.slice(startFrame, endFrame + 1);
      const { title, subtitle } = this.describeHighlight(event);
      const tags = this.deriveHighlightTags(event);
      return {
        id: event.id,
        type: event.type,
        title,
        subtitle,
        startFrame,
        endFrame,
        timestamp: event.timestamp,
        round: event.round,
        meta: {
          killerId: event.killerId || null,
          killerName: event.killerName || null,
          victimId: event.victimId || null,
          victimName: event.victimName || null,
          powerup: event.powerup || null,
          playerName: event.playerName || null,
          playerId: event.playerId || null,
          winnerId: event.winnerId || null,
          winnerName: event.winnerName || null,
          cause: event.cause || null,
        },
        tags,
        frames,
      };
    });
    const keyEvents = selectedEvents.map((event) => {
      const descriptor = this.describeHighlight(event);
      return {
        id: event.id,
        type: event.type,
        title: descriptor.title,
        subtitle: descriptor.subtitle,
        icon: this.resolveMarkerIcon(event),
        accent: this.resolveMarkerAccent(event),
        timestamp: event.timestamp || Date.now(),
      };
    });
    return {
      clips,
      stats,
      summary: this.buildRoundSummary(stats, winner),
      keyEvents,
    };
  }

  resolveMarkerIcon(event) {
    switch (event.type) {
      case "kill":
        return "⚔️";
      case "golden-food":
        return "✨";
      case "powerup":
        return POWERUP_ICONS[event.powerup] || "🔋";
      case "round-end":
        return "🏁";
      default:
        return "";
    }
  }

  resolveMarkerAccent(event) {
    switch (event.type) {
      case "kill":
        return event.killerColor || event.victimColor || "#ff4d4f";
      case "golden-food":
        return event.playerColor || "#f5b301";
      case "powerup":
        return event.playerColor || "#13c2c2";
      case "round-end":
        return event.winnerColor || "#9254de";
      default:
        return "#faad14";
    }
  }

  buildReplayMarkers() {
    if (!Array.isArray(this.roundHighlights) || !this.roundHighlights.length) {
      return [];
    }
    const markers = [];
    for (const event of this.roundHighlights) {
      if (!event || !Number.isFinite(event.frameIndex)) continue;
      const descriptor = this.describeHighlight(event) || {
        title: "이벤트",
        subtitle: "",
      };
      const feedEntry = this.buildEventFeedEntry(event);
      const marker = {
        id: event.id,
        frameIndex: Math.max(0, Math.round(event.frameIndex)),
        type: event.type || "event",
        title: descriptor.title || "이벤트",
        subtitle: descriptor.subtitle || "",
        icon: this.resolveMarkerIcon(event),
        accent: feedEntry?.accent || this.resolveMarkerAccent(event),
        timestamp: event.timestamp || Date.now(),
        round: Number.isFinite(event.round) ? event.round : this.round,
        powerup: event.powerup || feedEntry?.meta?.powerup || null,
      };
      markers.push(marker);
    }
    markers.sort((a, b) => a.frameIndex - b.frameIndex);
    return markers;
  }

  deriveHighlightTags(event) {
    const tags = new Set(["highlight"]);
    switch (event.type) {
      case "kill":
        tags.add("kill");
        tags.add("combat");
        if (event.cause === "collision") tags.add("collision");
        if (event.cause === "self") tags.add("self-hit");
        if (event.cause === "wall") tags.add("wall");
        if (event.killerId && event.killerId === this.firstKillAwardedTo) {
          tags.add("first-kill");
        }
        break;
      case "golden-food":
        tags.add("golden");
        tags.add("food");
        tags.add("growth");
        break;
      case "powerup":
        tags.add("powerup");
        if (event.powerup) tags.add(`powerup:${event.powerup}`);
        break;
      case "round-end":
        tags.add("round-end");
        tags.add("summary");
        if (event.winnerId) tags.add("victory");
        if (!event.winnerId) tags.add("draw");
        break;
      default:
        break;
    }
    return [...tags];
  }

  pushFrame(state) {
    const snapshot = {
      timestamp: state.timestamp,
      players: state.players.map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        segments: player.segments,
        alive: player.alive,
      })),
      food: state.food,
      powerups: state.powerups,
    };
    this.frameHistory.push(snapshot);
    const maxFrames = TICK_RATE * 120;
    if (this.frameHistory.length > maxFrames) {
      this.frameHistory.shift();
    }
    if (this.pendingHighlights.length) {
      const frameIndex = Math.max(0, this.frameHistory.length - 1);
      for (const event of this.pendingHighlights) {
        event.frameIndex = frameIndex;
        this.roundHighlights.push(event);
      }
      this.pendingHighlights = [];
      const maxHighlights = 24;
      if (this.roundHighlights.length > maxHighlights) {
        this.roundHighlights.splice(
          0,
          this.roundHighlights.length - maxHighlights
        );
      }
    }
  }

  update() {
    this.tickPhase();
    if (this.phase === "waiting") {
      this.broadcast("game:state", this.serialize());
      return;
    }

    if (this.phase === "running") {
      for (const player of this.players.values()) {
        this.handleMovement(player);
        this.handleFoodAndPowerups(player);
        this.handleEffectTimers(player);
      }
      this.handleCollisions();
      this.checkMatchEnd();
    }

    const state = this.serialize();
    this.pushFrame(state);
    this.broadcast("game:state", state);
  }
}

const createRoom = ({ name, hostId, isPrivate, modeKey }) => {
  const id = uuidv4().slice(0, 6).toUpperCase();
  const room = new RoomState({
    id,
    name: name || `Room ${id}`,
    hostId,
    isPrivate,
    modeKey,
  });
  rooms.set(id, room);
  return room;
};

const getJoinableRooms = () => {
  return [...rooms.values()]
    .filter(
      (room) => !room.isPrivate && room.players.size < MAX_PLAYERS_PER_ROOM
    )
    .map((room) => ({
      id: room.id,
      name: room.name,
      players: room.players.size,
      phase: room.phase,
      mode: {
        key: room.modeKey,
        label: room.mode.label,
      },
    }));
};

io.on("connection", (socket) => {
  socket.emit("rooms:list", getJoinableRooms());
  socket.on("rooms:refresh", () => {
    socket.emit("rooms:list", getJoinableRooms());
  });

  socket.on(
    "room:create",
    ({ name, isPrivate, playerName, mode, preferredColor }, callback) => {
      const safeName =
        typeof playerName === "string" && playerName.trim()
          ? playerName.trim().slice(0, 16)
          : "Player";
      const modeKey =
        typeof mode === "string" ? mode.toLowerCase() : DEFAULT_MODE_KEY;
      const room = createRoom({ name, hostId: socket.id, isPrivate, modeKey });
      const joinResult = joinRoom(
        { room, socket, playerName: safeName, preferredColor },
        callback
      );
      if (joinResult.error) {
        rooms.delete(room.id);
      }
    }
  );

  socket.on("room:join", ({ roomId, playerName, preferredColor }, callback) => {
    const room = rooms.get(String(roomId).toUpperCase());
    const safeName =
      typeof playerName === "string" && playerName.trim()
        ? playerName.trim().slice(0, 16)
        : "Player";
    if (!room) {
      callback?.({ error: "방을 찾을 수 없습니다." });
      return;
    }
    joinRoom({ room, socket, playerName: safeName, preferredColor }, callback);
  });

  socket.on(
    "room:quick-join",
    ({ playerName, preferredColor, mode }, callback) => {
      const safeName =
        typeof playerName === "string" && playerName.trim()
          ? playerName.trim().slice(0, 16)
          : "Player";
      const room = [...rooms.values()].find(
        (candidate) =>
          !candidate.isPrivate && candidate.players.size < MAX_PLAYERS_PER_ROOM
      );
      if (room) {
        joinRoom(
          { room, socket, playerName: safeName, preferredColor },
          callback
        );
        return;
      }
      const requestedMode =
        typeof mode === "string" ? mode.toLowerCase() : DEFAULT_MODE_KEY;
      const created = createRoom({
        name: "Quick Match",
        hostId: socket.id,
        isPrivate: false,
        modeKey: requestedMode,
      });
      joinRoom(
        { room: created, socket, playerName: safeName, preferredColor },
        callback
      );
    }
  );

  socket.on("player:input", ({ playerId, direction }) => {
    const room = [...rooms.values()].find((r) => r.players.has(playerId));
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player || !player.alive) return;
    const { x, y } = direction || {};
    if (typeof x !== "number" || typeof y !== "number") return;
    if (Math.abs(x) === Math.abs(y)) return; // disallow diagonals
    if (x === -player.direction.x && y === -player.direction.y) return;
    player.pendingDirection = { x, y };
  });

  socket.on("player:color-change", ({ playerId, color }, callback) => {
    const room = [...rooms.values()].find((r) => r.players.has(playerId));
    if (!room) {
      callback?.({ error: "방을 찾을 수 없습니다." });
      return;
    }
    const result = room.changePlayerColor(playerId, color);
    if (result.error) {
      callback?.({ error: result.error });
      return;
    }
    const player = room.players.get(playerId);
    room.broadcast("room:notification", {
      id: uuidv4(),
      type: "info",
      message: `${player.name}님이 색상을 변경했습니다.`,
      timestamp: Date.now(),
    });
    callback?.({ success: true, color: player.color });
  });

  socket.on("chat:message", ({ roomId, playerId, message }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player) return;
    const text =
      typeof message === "string" ? message.trim().slice(0, 140) : "";
    if (!text) return;
    io.to(roomId).emit("chat:message", {
      id: uuidv4(),
      roomId,
      author: player.name,
      color: player.color,
      message: text,
      timestamp: Date.now(),
    });
  });

  socket.on("room:request-replay", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    socket.emit("room:replay", {
      roomId,
      frames: room.frameHistory,
      markers: room.buildReplayMarkers(),
      world: {
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        segmentSize: SEGMENT_SIZE,
      },
    });
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      for (const player of [...room.players.values()]) {
        if (player.socketId === socket.id) {
          room.removePlayer(player.id);
          checkRoomCleanup(room.id);
          break;
        }
      }
      room.spectators.delete(socket.id);
      room.stopLoopIfEmpty();
    }
  });
});

const joinRoom = ({ room, socket, playerName, preferredColor }, callback) => {
  if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
    callback?.({ error: "방이 가득 찼습니다." });
    return { error: "full" };
  }

  for (const existing of room.players.values()) {
    if (existing.name.toLowerCase() === playerName.toLowerCase()) {
      callback?.({ error: "이미 존재하는 이름입니다." });
      return { error: "duplicate" };
    }
  }

  const playerId = uuidv4();
  const color = room.assignColor(preferredColor);
  const player = new PlayerState({
    id: playerId,
    name: playerName,
    color,
    socketId: socket.id,
  });
  room.addPlayer(player);
  socket.join(room.id);
  socket.emit("player:assigned", {
    playerId,
    roomId: room.id,
    color,
    mode: {
      key: room.modeKey,
      label: room.mode.label,
    },
    world: {
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      segmentSize: SEGMENT_SIZE,
    },
  });

  statsStore
    .rememberPreference({ name: playerName, color, mode: room.modeKey })
    .catch((error) => {
      console.error("플레이어 선호 설정 저장 실패:", error.message);
    });

  statsStore
    .getProfile(playerName)
    .then((profile) => {
      socket.emit("player:profile", profile);
    })
    .catch((error) => {
      console.error("플레이어 프로필 전송 실패:", error.message);
    });

  room.broadcast("rooms:updated", getJoinableRooms());
  room.broadcast("room:notification", {
    id: uuidv4(),
    type: "join",
    message: `${playerName}님이 게임에 참가했습니다.`,
    timestamp: Date.now(),
  });

  callback?.({
    roomId: room.id,
    playerId,
    name: room.name,
    phase: room.phase,
    color,
    mode: {
      key: room.modeKey,
      label: room.mode.label,
    },
  });
  return { player };
};

const checkRoomCleanup = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.players.size === 0 && room.spectators.size === 0) {
    rooms.delete(roomId);
  }
};

app.get("/api/stats", async (req, res) => {
  try {
    const snapshot = await statsStore.snapshot();
    const players = snapshot.players.map((stats) => {
      const { games } = stats;
      return {
        name: stats.name,
        games,
        wins: stats.wins,
        averageScore: games ? Math.round(stats.totalScore / games) : 0,
        winRate: games ? +((stats.wins / games) * 100).toFixed(1) : 0,
        averageSurvivalSeconds: games
          ? +(stats.totalSurvivalTicks / games / TICK_RATE).toFixed(1)
          : 0,
        kills: stats.kills,
      };
    });
    res.json({
      updatedAt: snapshot.updatedAt,
      players,
    });
  } catch (error) {
    res.status(500).json({ error: "통계를 불러오지 못했습니다." });
  }
});

app.get("/api/event-logs", async (req, res) => {
  const query = req.query || {};
  const parseMultiValue = (value) => {
    if (Array.isArray(value)) {
      return value
        .flatMap((token) => String(token).split(","))
        .map((token) => token.trim())
        .filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean);
    }
    return [];
  };

  const types = parseMultiValue(query.type).slice(0, 6);
  const tags = parseMultiValue(query.tag || query.tags).slice(0, 6);
  const highlightParam =
    typeof query.highlight === "string"
      ? query.highlight.toLowerCase()
      : query.highlight;
  const highlight =
    highlightParam === "true" || highlightParam === true
      ? true
      : highlightParam === "false" || highlightParam === false
      ? false
      : undefined;

  const options = {
    limit: query.limit,
    before: query.before,
    types,
    tags,
    highlight,
    roomId: typeof query.roomId === "string" ? query.roomId.trim() : undefined,
    mode: typeof query.mode === "string" ? query.mode.trim() : undefined,
    playerId:
      typeof query.playerId === "string" ? query.playerId.trim() : undefined,
    playerName:
      typeof query.playerName === "string"
        ? query.playerName.trim()
        : undefined,
    search: typeof query.search === "string" ? query.search.trim() : undefined,
  };

  try {
    const result = await statsStore.findEventLogs(options);
    res.json({
      data: result.items,
      paging: {
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        nextCursorIso: result.nextCursorIso,
        limit: result.limit,
      },
      meta: {
        source: result.source,
        filters: {
          types,
          tags,
          highlight: highlight !== undefined ? highlight : null,
          roomId: options.roomId || null,
          mode: options.mode || null,
          playerId: options.playerId || null,
          playerName: options.playerName || null,
          search: options.search || null,
          before: options.before || null,
        },
      },
    });
  } catch (error) {
    console.error("이벤트 로그 API 오류:", error.message);
    res.status(500).json({ error: "이벤트 로그를 불러오지 못했습니다." });
  }
});

app.get("/api/profile/:name", async (req, res) => {
  const name = String(req.params.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "플레이어 이름이 필요합니다." });
    return;
  }
  try {
    const profile = await statsStore.getProfile(name);
    const games = profile.games || 0;
    const averageScore = games ? Math.round(profile.totalScore / games) : 0;
    const winRate = games ? +((profile.wins / games) * 100).toFixed(1) : 0;
    const averageSurvivalSeconds = games
      ? +(profile.totalSurvivalTicks / games / TICK_RATE).toFixed(1)
      : 0;
    res.json({
      name: profile.name,
      games,
      wins: profile.wins || 0,
      winRate,
      averageScore,
      averageSurvivalSeconds,
      totalScore: profile.totalScore || 0,
      totalSurvivalTicks: profile.totalSurvivalTicks || 0,
      kills: profile.kills || 0,
      bestScore: profile.bestScore || 0,
      bestKills: profile.bestKills || 0,
      lastColor: profile.lastColor || null,
      lastMode: profile.lastMode || null,
      achievements: profile.achievements || {},
      updatedAt: profile.updatedAt || Date.now(),
      createdAt: profile.createdAt || null,
    });
  } catch (error) {
    res.status(500).json({ error: "프로필을 불러오지 못했습니다." });
  }
});

server.listen(PORT, () => {
  console.log(`Online Worm Battle server listening on port ${PORT}`);
});
