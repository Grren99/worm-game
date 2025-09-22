# 부하 테스트 & 성능 튜닝 가이드

온라인 지렁이 배틀의 실시간 특성상 동시 접속자 수, 파워업 빈도, 토너먼트 라운드 수에 따라 서버 부하가 빠르게 변합니다. 이 문서는 내장된 `loadtest` 스크립트를 활용해 부하 테스트를 실행하고, 관찰해야 할 지표와 튜닝 전략을 정리합니다.

## 1. 사전 준비
- Node.js 18 이상 권장 (이벤트 루프 성능 및 최신 Socket.IO 지원)
- 서버를 `NODE_ENV=production` 환경으로 실행하면 Socket.IO가 압축 기능을 비활성화하지 않아 네트워크 비용 추정이 정확해집니다.
- MongoDB 연동 시에는 프로파일러(Profiler)와 Slow Query 로그 활성화를 고려하세요.

## 2. 부하 테스트 스크립트 실행
내장 스크립트는 Socket.IO 클라이언트를 이용해 다수의 가짜 플레이어를 주기적으로 스폰하고 이동/채팅 이벤트를 전송합니다.

```bash
# 기본값: 24명, 60초, 이동 입력 180ms 간격
npm run loadtest

# 주요 파라미터
# --players        : 동시에 투입할 봇 수 (기본 24)
# --duration       : 각 봇이 활동할 시간(초) (기본 60)
# --spawn-interval : 봇 생성 간격(ms) (기본 200)
# --tick           : 이동 입력 주기(ms) (기본 180)
# --chat-interval  : 채팅 전송 간격(ms) (기본 12000)
# --mode           : 참가할 게임 모드 (classic | battle | speed | tournament)

# 예시: 48명, 90초 동안 배틀 모드 부하 테스트
npm run loadtest -- --players=48 --duration=90 --mode=battle
```

> **Tip**: 테스트는 웹 서버와 같은 머신 또는 같은 로컬 네트워크에서 실행해야 네트워크 레이턴시가 일정하게 유지됩니다.

## 3. 모니터링 체크리스트
| 구분 | 도구 | 확인 포인트 |
| --- | --- | --- |
| CPU/메모리 | `htop`, `top` | Node.js 프로세스 CPU 사용률, RSS, 스왑 여부 |
| 이벤트 루프 지연 | `node --inspect` + Performance 탭 | `setInterval` 지연, GC Pause |
| Socket.IO 통계 | 서버 로그, `io.engine.clientsCount` | 동시 접속자 수, 패킷 전송량 |
| MongoDB | `mongostat`, `db.currentOp()` | 쓰기 지연, 잠금, 느린 쿼리 |
| 네트워크 | `iftop`, `nload` | 초당 전송량, 폭주 여부 |

부하 테스트 전후로 `/api/stats` 응답 속도를 확인하면 백엔드 통계 조회 성능을 간접적으로 측정할 수 있습니다.

## 4. 튜닝 전략
1. **Tick 조정**
   - `TICK_RATE`(기본 20)과 `baseSpeed`, `speedBoostMultiplier`가 높을수록 서버 연산량이 증가합니다.
   - 대규모 세션에서는 `TICK_RATE`를 16~18로 낮추고, 이동 속도를 소폭 보정하여 체감 속도를 유지하세요.
2. **Socket 기본값 최적화**
   - `io` 인스턴스 생성 시 `maxHttpBufferSize`를 제한(예: 1MB)하면 악성 패킷을 방어할 수 있습니다.
   - `perMessageDeflate`를 비활성화하면 CPU 사용률 감소 ↔ 전송량 증가 trade-off를 조정할 수 있습니다.
3. **Room 분산**
   - `MAX_PLAYERS_PER_ROOM` 상향 대신 여러 방을 권장합니다. 방 수가 늘면 이벤트 루프 분산이 자연스럽게 이루어집니다.
4. **MongoDB 쓰기 최적화**
   - 성능 병목이 발견되면 `statsStore.record` 에 배치 큐(500ms 단위)를 도입하거나, `writeConcern: { w: 0 }`으로 전환해 비동기화를 강화할 수 있습니다.
   - 장기적으로는 Redis 같은 인메모리 캐시 계층을 추가해 랭킹 API를 캐싱하세요.
5. **프로파일링**
   - `node --cpu-prof server.js` 로 CPU 프로파일을 수집한 뒤, `node --prof-process` 로 병목 함수를 식별합니다.
   - `clinic flame server.js` (Clinic.js) 도구를 이용하면 렌더 루프 및 충돌 감지 로직의 과부하를 시각화할 수 있습니다.

## 5. 추천 테스트 시나리오
1. **기본 안정성**: 16명 · 60초 · `classic` – 기준 Latency / CPU 확인
2. **파워업 폭주**: 24명 · 90초 · `battle` – 파워업 스폰이 집중될 때의 처리량 확인
3. **토너먼트 장기전**: 32명 · 180초 · `tournament` – 라운드/하이라이트(프레임 기록) 누적 부하 측정
4. **MongoDB 의존도**: 위 테스트들을 `MONGODB_URI` 연결/해제로 한 번씩 실행하여 쓰기 지연 비교

## 6. 테스트 후 체크리스트
- 서버 로그에 `MongoDB 통계 저장 실패` 같은 경고가 반복되지 않는지 확인
- `rooms` 맵에 사용하지 않는 방(플레이어 0명)이 남아있다면 `checkRoomCleanup` 로직을 보완하세요.
- 프론트엔드에서 랙/프리즈가 체감된다면 `Renderer` 파티클 수를 줄이거나 `requestAnimationFrame` 최적화가 필요합니다.

테스트 결과를 `docs/performance.md` 하단에 표 형태로 적립해두면 추후 회귀 테스트에 큰 도움이 됩니다. 즐거운 튜닝 되세요!
