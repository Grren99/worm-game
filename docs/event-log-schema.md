# 이벤트 로그 스키마 초안

서버는 하이라이트 이벤트가 발생할 때마다 MongoDB `event_logs` 컬렉션(환경 변수 `MONGODB_EVENT_COLLECTION` 으로 변경 가능)에 아래 구조로 영구 저장합니다.

## 기본 필드
- `eventId` (`string`): 서버에서 생성한 이벤트 고유 식별자
- `type` (`string`): 이벤트 종류 (`kill`, `golden-food`, `powerup`, `round-end` 등)
- `timestamp` (`Date`): 이벤트 발생 시각 (`timestampMs` 의 ISO 표현)
- `timestampMs` (`number`): 이벤트 발생 시각 (epoch milliseconds)
- `createdAt` (`Date`): DB에 기록된 시각
- `highlight` (`boolean`): 하이라이트 기반 로그 여부 (현재는 항상 `true`)
- `tags` (`string[]`): 이벤트 분류 태그 배열, 최대 12개
- `roomId` (`string` | `null`): 이벤트가 발생한 방 ID
- `roomName` (`string` | `null`): 방 표시 이름
- `round` (`number` | `null`): 이벤트 라운드 번호
- `mode` (`object` | `null`): 게임 모드 정보 `{ key, label }`

## participants 하위 문서
각 이벤트 관련 인원 스냅샷입니다. 존재하는 키만 저장됩니다.
- `participants.killer` `{ id, name, color }`
- `participants.victim`
- `participants.player` (음식/파워업 획득자)
- `participants.winner`

## meta 하위 문서
- `meta.cause` (`string` | `null`): 사망 원인 (`collision`, `wall`, `self` 등)
- `meta.powerup` (`string` | `null`): 파워업 종류
- `meta.score` (`number` | `null`): 이벤트 직후 점수 스냅샷

## feed 하위 문서
UI 이벤트 피드에 사용되는 핵심 문자열입니다.
- `feed.type`
- `feed.message`
- `feed.detail`
- `feed.accent`
- `feed.primaryId`
- `feed.secondaryId`

## context 하위 문서
- `context.phase` (`string` | `null`): 이벤트 당시 룸 상태 (`waiting`, `running`, `ended` 등)
- `context.playerCount` (`number` | `null`): 방의 전체 플레이어 수
- `context.aliveCount` (`number` | `null`): 생존 플레이어 수
- `context.spectatorCount` (`number` | `null`): 관전자 수
- `context.leaderboard` (`array`): 상위 5명의 스냅샷
  - 각 항목 `{ id, name, score, kills, alive, color }`
- `context.tournament` (`object` | `null`)
  - `roundsToWin`
  - `championId`
  - `wins` (`array`): `{ playerId, winCount }`

## 예시 문서
```json
{
  "eventId": "1db45a96-7cf6-4b77-9ecc-1c36a5f056ef",
  "type": "kill",
  "timestamp": "2025-09-23T11:38:52.123Z",
  "timestampMs": 1769225932123,
  "createdAt": "2025-09-23T11:38:52.456Z",
  "highlight": true,
  "tags": ["highlight", "kill", "combat"],
  "roomId": "AB12CD",
  "roomName": "Room AB12CD",
  "round": 2,
  "mode": { "key": "classic", "label": "클래식 모드" },
  "participants": {
    "killer": { "id": "player-a", "name": "레드", "color": "#ff4d4f" },
    "victim": { "id": "player-b", "name": "블루", "color": "#40a9ff" }
  },
  "meta": { "cause": "collision", "powerup": null, "score": 420 },
  "feed": {
    "type": "kill",
    "message": "레드 ▶ 블루",
    "detail": "충돌 승리",
    "accent": "#ff4d4f",
    "primaryId": "player-a",
    "secondaryId": "player-b"
  },
  "context": {
    "phase": "running",
    "playerCount": 5,
    "aliveCount": 4,
    "spectatorCount": 1,
    "leaderboard": [
      { "id": "player-a", "name": "레드", "score": 420, "kills": 2, "alive": true, "color": "#ff4d4f" },
      { "id": "player-c", "name": "그린", "score": 310, "kills": 1, "alive": true, "color": "#52c41a" }
    ],
    "tournament": {
      "roundsToWin": 3,
      "championId": null,
      "wins": [
        { "playerId": "player-a", "winCount": 1 },
        { "playerId": "player-c", "winCount": 1 }
      ]
    }
  }
}
```

## 인덱스 제안
- `{ roomId: 1, timestamp: -1 }`
- `{ type: 1, timestamp: -1 }`
- `{ "participants.killer.id": 1, timestamp: -1 }`

필요에 따라 TTL 인덱스 또는 별도 아카이브 컬렉션으로 이전할 수 있습니다.

## API 필터 예시
- `/api/event-logs?type=kill&limit=10` : 최신 10개의 킬 이벤트
- `/api/event-logs?type=powerup,golden-food&playerName=레드` : 레드 플레이어가 관여한 파워업/골든 이벤트
- `/api/event-logs?roomId=AB12CD&before=2025-09-23T11:50:00.000Z` : 특정 방에서 타임라인 커서 이전 이벤트
- `/api/event-logs?tag=highlight,my-play&highlight=true` : 하이라이트 태그와 내 플레이 태그가 모두 걸린 항목
- `/api/event-logs?search=골든&limit=5` : 메시지/세부 정보에 "골든"이 포함된 최근 5건

## 운영 & TTL 전략
- **핫 데이터(최근 7일)** : 기본 컬렉션(`event_logs`)에는 TTL 인덱스를 적용하지 않고, 쿼리 성능 확보를 위해 복합 인덱스만 유지합니다.
- **웜 데이터(7~30일)** : 30일 TTL 인덱스(`expireAfterSeconds: 2592000`)를 걸어 자동 만료시키되, TTL 만료 전에 아카이브 워커가 `event_logs_archive` 컬렉션으로 이전합니다.
- **콜드 데이터(30일 이후)** : 아카이브 컬렉션은 주기적으로 BSON dump 또는 Object Storage(JSONL)로 이전하여 저비용 보관을 유지합니다.
- **아카이브 워커 제안** : 10분 간격 CRON으로 `context.mode`, `type`, `timestamp` 기준 배치 이동, 오류 발생 시 재시도 큐에 적재합니다.
- **복구 절차** : 아카이브에서 특정 기간을 재주입할 때는 `eventId` 중복을 허용하지 않도록 `upsert` 후, 필요 시 `roomId`+`timestamp` 필터로 부분 복구합니다.
