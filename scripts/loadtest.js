#!/usr/bin/env node
'use strict';

const { io } = require('socket.io-client');

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const index = args.findIndex((token) => token === flag || token.startsWith(`${flag}=`));
  if (index === -1) return fallback;
  const token = args[index];
  if (token.includes('=')) {
    return token.split('=').slice(1).join('=');
  }
  const next = args[index + 1];
  if (!next || next.startsWith('--')) return fallback;
  return next;
};

const toNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const config = {
  host: getArg('--host', 'http://localhost:3000'),
  players: toNumber(getArg('--players', '24'), 24),
  duration: toNumber(getArg('--duration', '60'), 60),
  spawnInterval: toNumber(getArg('--spawn-interval', '200'), 200),
  inputInterval: toNumber(getArg('--tick', '180'), 180),
  chatInterval: toNumber(getArg('--chat-interval', '12000'), 12000),
  mode: getArg('--mode', 'battle')
};

const DIRECTIONS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];

const pickDirection = (previous) => {
  const choices = DIRECTIONS.filter((direction) => {
    if (!previous) return true;
    return !(direction.x === -previous.x && direction.y === -previous.y);
  });
  if (!choices.length) return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
  return choices[Math.floor(Math.random() * choices.length)];
};

const summary = {
  spawned: 0,
  connected: 0,
  assigned: 0,
  errors: 0,
  completed: 0
};

const bots = [];
let finished = false;

const log = (...parts) => console.log('[loadtest]', ...parts);

const maybeFinish = () => {
  if (finished) return;
  if (!bots.length) return;
  if (bots.some((bot) => !bot.done)) return;
  finished = true;
  clearTimeout(globalTimeout);
  const durationSeconds = config.duration;
  log('시뮬레이션 종료');
  log('--- 결과 요약 ---');
  log(`요청한 봇 수: ${config.players}`);
  log(`생성된 봇 수: ${summary.spawned}`);
  log(`연결 성공: ${summary.connected}`);
  log(`게임 참여 성공: ${summary.assigned}`);
  log(`오류: ${summary.errors}`);
  log(`실행 시간(요청): ${durationSeconds}s`);
  process.exit(0);
};

class Bot {
  constructor(index) {
    this.index = index;
    this.name = `부하봇${String(index).padStart(2, '0')}`;
    this.socket = null;
    this.playerId = null;
    this.roomId = null;
    this.direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    this.movementTimer = null;
    this.chatTimer = null;
    this.done = false;
    this.startTime = Date.now();
  }

  start() {
    summary.spawned += 1;
    this.socket = io(config.host, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000
    });

    this.socket.on('connect', () => {
      summary.connected += 1;
      this.socket.emit(
        'room:quick-join',
        {
          playerName: this.name,
          preferredColor: null,
          mode: config.mode
        },
        (response = {}) => {
          if (response.error) {
            summary.errors += 1;
            log(`${this.name} 방 입장 실패: ${response.error}`);
            this.shutdown('join-error');
          }
        }
      );
    });

    this.socket.on('player:assigned', ({ playerId, roomId }) => {
      if (!playerId || !roomId) return;
      if (this.playerId) return;
      summary.assigned += 1;
      this.playerId = playerId;
      this.roomId = roomId;
      this.startMovementLoop();
      this.startChatLoop();
    });

    this.socket.on('connect_error', (error) => {
      summary.errors += 1;
      log(`${this.name} 연결 오류: ${error.message}`);
      this.shutdown('connect-error');
    });

    this.socket.on('disconnect', () => {
      this.shutdown('disconnect');
    });

    setTimeout(() => this.shutdown('duration'), config.duration * 1000 + Math.random() * 500);
  }

  startMovementLoop() {
    if (this.movementTimer) return;
    this.movementTimer = setInterval(() => {
      if (!this.playerId) return;
      this.direction = pickDirection(this.direction);
      this.socket.emit('player:input', {
        playerId: this.playerId,
        direction: this.direction
      });
    }, config.inputInterval);
  }

  startChatLoop() {
    if (config.chatInterval <= 0 || this.chatTimer) return;
    const sendChat = () => {
      if (!this.playerId || !this.roomId) return;
      const messages = ['GG', '맛있다!', '파워업 굿', '집중!'];
      const text = messages[Math.floor(Math.random() * messages.length)];
      this.socket.emit('chat:message', {
        roomId: this.roomId,
        playerId: this.playerId,
        message: `${text} (${this.name})`
      });
    };
    sendChat();
    this.chatTimer = setInterval(sendChat, config.chatInterval + Math.random() * 3000);
  }

  shutdown(reason) {
    if (this.done) return;
    this.done = true;
    clearInterval(this.movementTimer);
    clearInterval(this.chatTimer);
    this.movementTimer = null;
    this.chatTimer = null;
    if (this.socket && this.socket.connected) {
      this.socket.close();
    }
    this.socket = null;
    summary.completed += 1;
    maybeFinish();
  }
}

const spawnBots = () => {
  for (let i = 0; i < config.players; i += 1) {
    setTimeout(() => {
      const bot = new Bot(i + 1);
      bots.push(bot);
      bot.start();
    }, i * config.spawnInterval);
  }
};

const globalTimeout = setTimeout(() => {
  bots.forEach((bot) => bot.shutdown('timeout'));
  maybeFinish();
}, config.duration * 1000 + config.players * config.spawnInterval + 3000);

process.on('SIGINT', () => {
  log('수동 종료 요청 수신. 정리 중...');
  clearTimeout(globalTimeout);
  bots.forEach((bot) => bot.shutdown('sigint'));
  maybeFinish();
});

dispatchImmediateLogs();
spawnBots();

function dispatchImmediateLogs() {
  log('부하 테스트 시작');
  log(`대상: ${config.host}`);
  log(`플레이어 수: ${config.players}`);
  log(`테스트 지속 시간: ${config.duration}s`);
  log(`스폰 간격: ${config.spawnInterval}ms`);
  log(`입력 간격: ${config.inputInterval}ms`);
}
