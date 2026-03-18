import { useState, useCallback, useMemo, useEffect, useRef } from "react";

const CARDS = [
  { id: "prophecy_shard", name: "예지의 파편", cat: "info", target: "two", desc: "2명 중 공허 포함 여부", emoji: "🔮" },
  { id: "sentinel_eye", name: "파수꾼의 눈", cat: "info", target: "two", desc: "2명이 같은 진영인지", emoji: "👁️" },
  { id: "tracker_eye", name: "추적자의 눈", cat: "info", target: "one", desc: "대상의 행동 카드 확인", emoji: "🔍" },
  { id: "shadow_eye", name: "미행의 눈", cat: "info", target: "one", desc: "대상이 누구를 지목했는지", emoji: "👤" },
  { id: "vigilant_eye", name: "경계의 눈", cat: "info", target: "one", desc: "대상이 지목당했는지", emoji: "⚠️" },
  { id: "dead_memory", name: "망자의 기억", cat: "info", target: "none", desc: "제거된 자의 행동 확인", emoji: "💀" },
  { id: "abyssal_blade", name: "심연의 칼날", cat: "combat", target: "one", desc: "대상 제거", emoji: "⚔️" },
  { id: "ward_shield", name: "결계의 방패", cat: "combat", target: "any", desc: "대상 보호 (자신 포함)", emoji: "🛡️" },
  { id: "fog_veil", name: "안개의 장막", cat: "combat", target: "self", desc: "정보 조사 차단", emoji: "🌫️" },
  { id: "disruption", name: "교란의 속삭임", cat: "combat", target: "one", desc: "대상 효과 무효화", emoji: "💨" },
  { id: "specter_chain", name: "망령의 사슬", cat: "combat", target: "one", desc: "다음 턴 전투 금지", emoji: "⛓️" },
  { id: "abyssal_touch", name: "심연의 손길", cat: "combat", target: "one", desc: "대상의 정보 결과 강탈", emoji: "🖐️" },
];
const cn = id => CARDS.find(c => c.id === id)?.name || id;

const pick = a => a[Math.floor(Math.random() * a.length)];
const sample = (a, n) => { const c = [...a], r = []; for (let i = 0; i < n && c.length; i++) { const j = Math.floor(Math.random() * c.length); r.push(c.splice(j, 1)[0]); } return r; };
const pn = (ps, id) => ps.find(p => p.id === id)?.name || `P${id+1}`;

// ═══════════════════════════════════════════
// Bot (행동/투표용)
// ═══════════════════════════════════════════
class Bot {
  constructor(p) { this.p = p; this.kf = {}; this.susp = {}; this.vt = []; this.sk = 0.7; this.secrets = []; this.myChoices = []; }
  initV(ids) { this.vt = ids; ids.forEach(v => { if (v !== this.p.id) this.kf[v] = "void"; }); }
  gs(id) { return this.susp[id] || 0; }
  as(id, v) { this.susp[id] = (this.susp[id] || 0) + v; }
  recE(pid, f) { this.kf[pid] = f; }
  vote(ps) {
    const al = ps.filter(p => p.alive && p.id !== this.p.id);
    if (!al.length) return this.p.id;
    if (this.p.faction === "guardian") {
      const cf = al.filter(p => this.kf[p.id] === "void");
      // 확정 공허여도 30% 확률로 다른 사람 투표 (의견 불일치)
      if (cf.length && Math.random() < 0.7) return pick(cf).id;
      if (Math.random() < this.sk * 0.7) { const s = [...al].sort((a, b) => this.gs(b.id) - this.gs(a.id)); if (s.length && this.gs(s[0].id) > 0) return s[0].id; }
      return pick(al).id;
    }
    const nt = al.filter(p => !this.vt.includes(p.id)), pool = nt.length ? nt : al;
    return pick(pool).id;
  }
  act(ps, taken, round) {
    this._round = round;
    const al = ps.filter(p => p.alive), oth = al.filter(p => p.id !== this.p.id);
    if (!oth.length) return { c: "fog_veil", t: [this.p.id] };
    let av = CARDS.filter(c => !taken.has(c.id));
    if (this.p.chained) av = av.filter(c => c.cat === "info");
    if (round === 1) av = av.filter(c => !["abyssal_blade", "dead_memory", "ward_shield", "specter_chain"].includes(c.id));
    if (!av.length) av = CARDS.filter(c => !taken.has(c.id));
    if (!av.length) av = [...CARDS];
    return this.p.faction === "guardian" ? this._ga(oth, al, av) : this._va(oth, al, av);
  }
  _ga(o, al, av) {
    const cf = o.filter(p => this.kf[p.id] === "void");
    if (cf.length && av.find(c => c.id === "abyssal_blade") && Math.random() < 0.5) return { c: "abyssal_blade", t: [pick(cf).id] };
    const r = Math.random();
    if (r < .45) return this._pi(o, av);
    if (r < .58 && av.find(c => c.id === "ward_shield")) return { c: "ward_shield", t: [pick(al).id] };
    if (r < .70 && av.find(c => c.id === "disruption")) return { c: "disruption", t: [this._ms(o).id] };
    if (r < .80 && av.find(c => c.id === "specter_chain")) return { c: "specter_chain", t: [this._ms(o).id] };
    if (r < .92 && av.find(c => c.id === "abyssal_blade")) return { c: "abyssal_blade", t: [this._ms(o).id] };
    return this._pi(o, av);
  }
  _va(o, al, av) {
    const nv = al.filter(p => p.faction === "void").length, ng = al.filter(p => p.faction === "guardian").length;
    if (nv >= ng - 1 && av.find(c => c.id === "abyssal_blade")) { const g = o.filter(p => !this.vt.includes(p.id)); if (g.length) return { c: "abyssal_blade", t: [pick(g).id] }; }
    // 정보통 수호자 정렬 (타겟팅용)
    const ir = [...o].sort((a, b) => (b.actionHistory?.filter(h => h.cat === "info").length || 0) - (a.actionHistory?.filter(h => h.cat === "info").length || 0));
    const nt = ir.filter(p => !this.vt.includes(p.id));
    const r = Math.random();
    if (r < .25 && av.find(c => c.id === "abyssal_blade")) { return { c: "abyssal_blade", t: [(nt.length ? nt[0] : pick(o)).id] }; }
    if (r < .45 && av.find(c => c.id === "disruption")) return { c: "disruption", t: [(nt.length ? nt[0] : ir[0]).id] };
    if (r < .60 && av.find(c => c.id === "abyssal_touch")) return { c: "abyssal_touch", t: [(nt.length ? nt[0] : ir[0]).id] };
    if (r < .72 && av.find(c => c.id === "fog_veil")) return { c: "fog_veil", t: [this.p.id] };
    if (r < .82 && av.find(c => c.id === "specter_chain")) return { c: "specter_chain", t: [(nt.length ? nt[0] : pick(o)).id] };
    return this._pi(o, av);
  }
  _pi(o, av) {
    const un = o.filter(p => this.kf[p.id] === undefined), pool = un.length ? un : o;
    let ia = av.filter(c => c.cat === "info");
    // R1에는 망자의 기억 제외 (칼날 잠금으로 빈 카드 확정)
    if (this._round === 1) ia = ia.filter(c => c.id !== "dead_memory");
    if (!ia.length) { const a = av[0]; return { c: a.id, t: a.target === "self" ? [this.p.id] : a.target === "none" ? [] : [pick(pool).id] }; }
    const r = Math.random();
    if (r < .25 && ia.find(c => c.id === "prophecy_shard") && pool.length >= 2) return { c: "prophecy_shard", t: sample(pool, 2).map(p => p.id) };
    if (r < .45 && ia.find(c => c.id === "sentinel_eye") && pool.length >= 2) return { c: "sentinel_eye", t: sample(pool, 2).map(p => p.id) };
    if (r < .58 && ia.find(c => c.id === "tracker_eye")) return { c: "tracker_eye", t: [pick(pool).id] };
    if (r < .68 && ia.find(c => c.id === "dead_memory")) return { c: "dead_memory", t: [] };
    if (r < .80 && ia.find(c => c.id === "shadow_eye")) return { c: "shadow_eye", t: [pick(pool).id] };
    if (ia.find(c => c.id === "vigilant_eye")) return { c: "vigilant_eye", t: [pick(pool).id] };
    const card = pick(ia); return { c: card.id, t: card.target === "two" && pool.length >= 2 ? sample(pool, 2).map(p => p.id) : card.target === "none" ? [] : [pick(pool).id] };
  }
  _ms(o) { const s = [...o].sort((a, b) => this.gs(b.id) - this.gs(a.id)); return s.length && this.gs(s[0].id) > 0 ? s[0] : pick(o); }

  learn(infos) {
    (infos || []).forEach(i => {
      this.secrets.push(i);
      if (i.result === "unknown" || i.result === "stolen" || i.result === "disrupted") return;
      if (i.card === "prophecy_shard") { if (i.result === "void_absent") (i.targets || []).forEach(t => { this.kf[t] = "guardian"; this.as(t, -0.3); }); else if (i.result === "void_present") (i.targets || []).forEach(t => this.as(t, 0.2)); }
      else if (i.card === "sentinel_eye" && i.targets?.length === 2) { if (i.result === "different") i.targets.forEach(t => this.as(t, 0.15)); else if (i.result === "same") i.targets.forEach(t => { if (this.kf[t] !== undefined) { const o = i.targets.find(x => x !== t); if (o !== undefined) this.kf[o] = this.kf[t]; } }); }
      else if (i.card === "tracker_eye" && ["abyssal_blade", "fog_veil", "specter_chain", "abyssal_touch"].includes(i.result)) this.as(i.target, 0.25);
      else if (i.card === "dead_memory" && i.result && i.result !== "no_death") { if (["abyssal_blade", "fog_veil", "specter_chain", "abyssal_touch"].includes(i.result)) this.as(i.target, 0.2); }
    });
  }
  predict(ps) {
    // 자기가 이번 밤에 칼날을 썼으면 대상을 예측 (공허) — 단 들통 위험 때문에 30%만
    const myChoice = this.myChoices[this.myChoices.length - 1];
    const oth = ps.filter(p => p.alive && p.id !== this.p.id);
    if (!oth.length) return -1; // 아무도 안 죽는다
    if (this.p.faction === "void" && myChoice?.cid === "abyssal_blade") {
      if (Math.random() < 0.3) return myChoice.tgt[0]; // 위험하지만 보상 노림
      return Math.random() < 0.5 ? -1 : pick(oth).id; // 안전하게 다른 사람 or 없음
    }
    // 수호자: 의심 높은 사람이 칼날 들었을 수 있으니 그 대상을 예측
    if (Math.random() < 0.3) return -1; // 아무도 안 죽는다
    return pick(oth).id; // 랜덤 예측
  }
}

// ═══════════════════════════════════════════
// Claude API — 프롬프트 전면 재설계
// ═══════════════════════════════════════════
let _currentModel = "claude-sonnet-4-5-20250929";
let _apiKey = ""; // 사용자가 입력하는 API 키

async function callAPI(system, user) {
  if (!_apiKey) {
    console.error("API 키가 설정되지 않았습니다.");
    return "[]";
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": _apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ model: _currentModel, max_tokens: 1000, system, messages: [{ role: "user", content: user }] })
    });
    const data = await res.json();
    if (data.error) {
      console.error("API 오류:", data.error);
      return "[]";
    }
    return (data.content || []).map(c => c.text || "").join("");
  } catch (e) { console.error("API:", e); return "[]"; }
}

// 봇 1명의 "실제로 아는 정보"를 정확히 구성
function buildBotSystem(bot, players, allChoices, round) {
  const p = bot.p;
  const myChoice = allChoices.find(c => c.pid === p.id);
  const myCard = myChoice ? cn(myChoice.cid) : "없음";
  const myTgt = myChoice?.tgt?.map(id => pn(players, id)).join(", ") || "";
  const disrupted = myChoice?.wasDisrupted;
  const secrets = bot.secrets.map(s => `R${s.round}: ${s.msg}`).join("\n") || "없음";
  const team = p.faction === "void"
    ? `\n너는 공허다. 팀원: ${bot.vt.filter(v => v !== p.id).map(id => pn(players, id)).join(", ")}. 수호자들을 속여야 한다.`
    : `\n너는 수호자다. 공허를 찾아 추방해야 한다.`;

  // 전체 행동 기록 (이전 라운드 포함)
  const historyLines = (bot.myChoices || []).map((ch, i) => {
    const cardName = cn(ch.cid);
    const tgtNames = ch.tgt?.map(id => pn(players, id)).join(", ") || "없음";
    return `R${ch.round || i + 1}: ${cardName} → ${tgtNames}`;
  });
  const myHistory = historyLines.length ? historyLines.join("\n") : "없음";

  // 수호자/공허 별 전용 규칙
  const factionRules = p.faction === "guardian"
    ? `[수호자 행동 규칙]
- 너는 수호자이므로 진실만 말한다. 실제 사용한 카드와 실제 결과만 공유.
- 위 "네가 아는 조사 결과"에 있는 정보만 말할 수 있다. 모르는 것을 아는 척 하면 안 된다.
- ★ 결과 공유 형식: 카드명 + 대상 + 결과를 반드시 모두 말해라. "파수꾼의 눈으로 P5, P6을 조사했다"처럼 결과를 빠뜨리면 안 된다. 반드시 "파수꾼의 눈으로 P5, P6을 봤는데 같은 진영이었다"처럼 결과까지 말해라.

★ 정보 카드 결과 해석 (매우 중요):
- 예지의 파편 "공허가 있다" → 2명 중 누구인지 알 수 없다. 반드시 "PX 또는 PY 중 공허가 있다"처럼 둘 다 언급해야 한다. 한 명만 찍어 의심하는 것은 논리적으로 불가능하다.
- 파수꾼의 눈 "다르다" → 2명 중 누가 공허인지 알 수 없다. 두 대상 모두 언급하라.
- 경계의 눈 "지목당했다" → 누군가 그 사람을 대상으로 카드를 썼다는 뜻일 뿐이다. 이것만으로는 아무도 의심할 근거가 안 된다.
- 추적자의 눈으로 누군가가 결계의 방패/정보 카드를 썼다는 것은 정상 행동이다. 의심 근거는 전투/방해 카드(칼날, 안개, 교란, 손길)를 썼을 때다.

★ 모순 감지 — 다른 사람 발언을 꼼꼼히 확인하고 반드시 지적하라:
- 같은 라운드에 2명 이상이 같은 카드를 썼다고 주장하면 → "같은 라운드에 같은 카드를 2명이 쓸 수 없다. 둘 중 하나가 거짓말이다" 반드시 지적.
- 누군가 "미행의 눈으로 PX를 봤더니 지목 없음"이라 했는데, 다른 사람이 "PX가 A카드로 PY를 지목했다"고 했다면 → 모순이므로 지적.
- 누군가 "PX가 A카드를 썼다"고 하는데 PX 본인이 "B카드를 썼다"고 했다면 → 둘 중 하나가 거짓말이므로 지적.
- 이전 라운드 발언과 모순되면 지적하라.
- 이전에 "믿는다"고 한 사람을 새로운 증거 없이 갑자기 의심하면 안 된다.

★ 의심의 근거:
- 의심하려면 반드시 논리적 인과관계가 있어야 한다. "어쩐지 수상하다"식의 근거 없는 의심 금지.`
    : `[공허 행동 규칙 — 중요!]
너의 목표: 수호자들을 속이고 수호자를 추방시키는 것이다. 팀원(${bot.vt.filter(v => v !== p.id).map(id => pn(players, id)).join(", ")})은 절대 공격하지 마라.

★ 거짓말 전략 — 적극적으로 사용하라:
1. **가짜 조사 결과 주장**: 실제로는 전투 카드를 썼더라도, 정보 카드를 쓴 것처럼 거짓 결과를 만들어 발표하라. 카드명 + 대상 + 결과를 모두 포함해야 자연스럽다. 예: "예지의 파편으로 PX, PY를 봤는데 공허가 없었다."
2. **수호자 프레이밍**: 수호자를 공허로 몰아라. 거짓 근거를 만들어라.
3. **팀원 엄호**: 팀원이 의심받으면 거짓 정보로 방어하라.
4. **의심 분산**: 한 사람에게 의심이 몰리면 다른 쪽으로 돌려라.

★ 거짓말 제약 (매우 중요 — 이것을 어기면 들통난다):
- ★★★ 다른 사람이 이미 주장한 카드를 네가 같은 라운드에 썼다고 하면 절대 안 된다! 위 "지금까지 다른 플레이어들의 발언"을 확인하고, 이미 누가 주장한 카드는 피해라. 예: 앞에서 P5가 "미행의 눈"을 썼다고 했으면 너도 "미행의 눈"을 썼다고 하면 안 된다.
- 다른 사람의 발언과 모순되는 거짓말도 위험하다. 예: P3이 "추적자의 눈으로 P4가 경계의 눈을 썼다"고 했는데, 네가 "미행의 눈으로 P4를 봤더니 지목 없음"이라 하면 → P4가 경계의 눈으로 누군가를 지목했을 텐데 "지목 없음"은 모순이라 들통난다.
- 규칙상 불가능한 행동을 주장하면 안 된다 (예: 자기 자신을 예지의 파편 대상에 포함).
- 이전 라운드 발언과 모순되면 안 된다.
- 거짓말의 결과가 규칙상 유효해야 한다 (예: 예지의 파편 결과는 "있다" 또는 "없다"만 가능).`;

  return `너는 "성역의 균열" 게임의 ${p.name}이다. 현재 라운드 ${round}.
${p.faction === "void" ? `너는 공허다. 팀원: ${bot.vt.filter(v => v !== p.id).map(id => pn(players, id)).join(", ")}. 수호자들을 속여야 한다.` : "너는 수호자다. 공허를 찾아 추방해야 한다."}

네가 매 라운드 사용한 카드 기록 (진실):
${myHistory}

이번 밤 네가 실제 사용한 카드: ${myCard}${myTgt ? " → " + myTgt : ""}${disrupted ? " (교란당해 무효화됨)" : ""}
네가 아는 조사 결과:
${secrets}

게임 규칙:
- 매 밤 12종 카드 중 1장을 드래프트. 중복 불가(같은 라운드에 같은 카드를 2명이 못 씀).
- 정보: 예지의 파편(다른 2명 지목, 공허 포함?→있다/없다), 파수꾼의 눈(다른 2명 지목, 같은 진영?→같다/다르다), 추적자의 눈(다른 1명, 카드명), 미행의 눈(다른 1명, 지목대상), 경계의 눈(다른 1명, 지목당함?), 망자의 기억(대상 없음, 제거된 자의 행동 확인)
- 전투: 심연의 칼날(다른 1명, 제거), 결계의 방패(자신 포함 1명, 보호), 안개의 장막(자기 자신만, 조사차단), 교란의 속삭임(다른 1명, 무효화), 망령의 사슬(다른 1명, 전투금지), 심연의 손길(다른 1명, 정보 결과 강탈)
- ★ 예지의 파편, 파수꾼의 눈은 반드시 "자기 자신이 아닌 다른 사람" 2명을 지목한다.
- R1 제한: 칼날, 방패, 사슬, 망자의 기억은 R1에서 사용 불가.
- 교란의 속삭임은 정보/전투 무관 모든 카드 효과를 무효화한다.

${factionRules}

공통 규칙:
1. 반드시 1인칭("나는", "내가")으로만 말한다. 절대 자기 이름을 3인칭으로 부르지 않는다.
2. 한국어 1~2문장으로 간결하게.
3. 조사 결과를 공유할 때 반드시 카드명 + 대상 + 결과를 모두 말해라. "미행의 눈으로 P3을 추적했다"처럼 결과를 빠뜨리면 안 된다. "미행의 눈으로 P3을 봤더니 P4을 지목했다"처럼 결과까지 말해라.
4. 교란당해서 결과를 못 받은 경우, 그 사실 자체를 공유해도 된다.
5. 이번 라운드(R${round})의 새 정보를 우선 공유하라. 이전 라운드에서 이미 공유한 내용을 반복하지 마라.
6. 아직 발언하지 않은 사람에게 "조용하다", "왜 말이 없냐"고 하지 마라. 발언 순서가 나중이라 아직 차례가 안 온 것이다.
7. 누군가를 의심할 때 반드시 구체적 근거를 함께 말해라.
8. 초반 라운드에 조사당하는 것은 정상이다. "왜 나를 조사했냐"는 식의 반응을 하지 마라.`;
}

// 개별 에이전트 순차 토론
async function generateDiscussion(players, bots, allChoices, round, gameHistory, publicLog) {
  const aliveBots = players.filter(p => p.alive && p.id !== 0).map(p => bots[p.id]).filter(Boolean);
  if (!aliveBots.length) return [];

  const context = `라운드 ${round}. 생존: ${players.filter(p => p.alive).map(p => p.name).join(", ")}
공개 결과: ${publicLog.length ? publicLog.join("; ") : "없음"}
이전: ${gameHistory.length ? gameHistory.join(" | ") : "첫 라운드"}`;

  const results = [];
  let conversation = "";

  // 좌석 순서대로 1명씩 API 호출
  for (const bot of aliveBots) {
    const system = buildBotSystem(bot, players, allChoices, round);
    const hasInfo = bot.secrets.some(s => s.result && s.result !== "unknown" && s.result !== "disrupted");
    const user = `${context}
${conversation ? `지금까지 다른 플레이어들의 발언:\n${conversation}` : "아직 아무도 발언하지 않았다."}

너의 차례다. 공유할 조사 결과가 있으면 공유하고, 다른 사람의 발언에 의견이 있으면 말해라. 할 말이 없으면 "패스"라고만 해라.
${!hasInfo && bot.p.faction !== "void" ? "(너는 이번 라운드에 정보 카드 결과가 없다. 할 말이 없으면 패스해도 된다.)" : ""}
${bot.p.faction === "void" ? "(★ 너는 공허다. 패스하지 마라. 가짜 조사 결과를 발표하거나, 다른 수호자를 의심하거나, 팀원을 엄호하는 발언을 하라.)" : ""}
발언만 1~2문장으로 답해라. 따옴표나 이름 태그 없이 말만.`;

    try {
      const text = await callAPI(system, user);
      const clean = text.trim().replace(/^["']|["']$/g, "").replace(/^[A-Z]\d+:\s*/i, "");
      if (clean && !clean.includes("패스") && clean.length > 2) {
        results.push({ id: bot.p.id, msg: clean });
        conversation += `${bot.p.name}: "${clean}"\n`;
      }
    } catch {}
  }
  return results;
}

// 개별 에이전트 반응 (병렬 호출 후 필터)
async function generateReactions(players, bots, playerMsg, allChoices, round, conversationSoFar) {
  const aliveBots = Object.values(bots).filter(b => b.p.alive);
  if (!aliveBots.length) return [];

  const conv = conversationSoFar ? conversationSoFar + `P1: "${playerMsg}"\n` : `P1: "${playerMsg}"\n`;

  // 병렬 호출
  const promises = aliveBots.map(async (bot) => {
    const system = buildBotSystem(bot, players, allChoices, round);
    const user = `토론 중 대화 내용:\n${conv}
P1이 방금 위와 같이 발언했다. 너(${bot.p.name})는 이 발언에 반응해라.
- P1이 너에게 질문했다면 (예: "왜 의심?", "근거가 뭐야?", "어떤 카드 썼어?") 반드시 답해라. 질문을 무시하면 안 된다.
- P1이 너를 의심하거나 언급했다면 방어하거나 반박해라.
- P1이 다른 사람을 의심했다면, 관련 정보가 있으면 동조하거나 반박해라.
- 정말 아무 관련이 없으면 "패스"라고만 해라.
1문장으로 답해라. 따옴표나 이름 태그 없이 말만.`;
    try {
      const text = await callAPI(system, user);
      const clean = text.trim().replace(/^["']|["']$/g, "").replace(/^[A-Z]\d+:\s*/i, "");
      if (clean && !clean.includes("패스") && clean.length > 2) return { id: bot.p.id, msg: clean };
    } catch {}
    return null;
  });

  const all = await Promise.all(promises);
  return all.filter(Boolean);
}

// Claude API 기반 투표 — 토론 내용 반영
async function generateBotVotes(players, bots, allChoices, round, conversationLog) {
  const aliveBots = players.filter(p => p.alive && p.id !== 0).map(p => bots[p.id]).filter(Boolean);
  if (!aliveBots.length) return {};

  const aliveNames = players.filter(p => p.alive).map(p => p.name);
  const tally = {};

  const promises = aliveBots.map(async (bot) => {
    const system = buildBotSystem(bot, players, allChoices, round);
    const user = `토론이 끝났다. 지금까지의 대화 내용:
${conversationLog || "대화 없음"}

생존자: ${aliveNames.join(", ")}

이제 추방 투표를 해야 한다. 지금까지의 토론 내용, 네가 아는 조사 결과, 다른 사람들의 주장을 종합하여 1명을 선택해라.
${bot.p.faction === "void" ? "너는 공허다. 수호자를 추방해야 한다. 팀원(" + bot.vt.filter(v => v !== bot.p.id).map(id => pn(players, id)).join(", ") + ")을 절대 추방하지 마라. 정보를 많이 모은 수호자, 또는 토론에서 너나 팀원을 의심하는 수호자를 우선 추방하라." : "토론에서 드러난 모순, 조사 결과, 규칙 위반 등을 근거로 가장 공허일 가능성이 높은 사람을 추방하라."}

반드시 이름만 답해라. 예: "P3"`;

    try {
      const text = await callAPI(system, user);
      const clean = text.trim().replace(/["""'']/g, "").trim();
      // P숫자 패턴 추출
      const match = clean.match(/P(\d+)/i);
      if (match) {
        const pid = parseInt(match[1]) - 1; // P1 → id 0
        const target = players.find(p => p.id === pid && p.alive && p.id !== bot.p.id);
        if (target) return { botId: bot.p.id, voteFor: target.id };
      }
    } catch {}
    // API 실패 시 기존 Bot.vote() 폴백
    return { botId: bot.p.id, voteFor: bot.vote(players) };
  });

  const results = await Promise.all(promises);
  results.forEach(r => { if (r) tally[r.voteFor] = (tally[r.voteFor] || 0) + 1; });
  return tally;
}

// ═══════════════════════════════════════════
// 드래프트/밤 처리
// ═══════════════════════════════════════════
function getDraftOrder(players, round) {
  const n = players.length, start = (round - 1) % n, order = [];
  for (let i = 0; i < n; i++) { const p = players[(start + i) % n]; if (p.alive) order.push(p); }
  return order;
}

function nightProc(ps, ch) {
  const cm = {}; ch.forEach(c => { cm[c.pid] = c; });
  const R = { killed: [], prot: [], chained: [], disr: new Set(), priv: {}, pub: [], stats: { i: 0, c: 0 }, disruptedBy: {} };
  const fog = new Set(), sc = {}, kt = {}, tb = new Set();
  ch.forEach(c => { if (CARDS.find(x => x.id === c.cid).cat === "info") R.stats.i++; else R.stats.c++; });

  // 교란
  {
    const ds = ch.filter(c => c.cid === "disruption"), dm = {};
    ds.forEach(c => { if (c.tgt.length) dm[c.pid] = c.tgt[0]; });
    const mu = new Set();
    Object.entries(dm).forEach(([p, t]) => { if (dm[t] == p) { mu.add(+p); mu.add(+t); } });
    ds.forEach(c => {
      if (mu.has(c.pid)) { R.disr.add(c.pid); return; }
      if (c.tgt.length) { const tid = c.tgt[0]; R.disr.add(tid); R.disruptedBy[tid] = c.pid; tb.add(tid); }
    });
  }

  // 안개
  ch.forEach(c => { if (c.cid === "fog_veil" && !R.disr.has(c.pid)) fog.add(c.pid); });

  // 심연의 손길 — stolen_from[victim] = thief
  const stolenFrom = {};
  ch.forEach(c => { if (c.cid === "abyssal_touch" && !R.disr.has(c.pid) && c.tgt.length) { stolenFrom[c.tgt[0]] = c.pid; tb.add(c.tgt[0]); } });

  // 방패
  ch.forEach(c => { if (c.cid === "ward_shield" && !R.disr.has(c.pid) && c.tgt.length) { sc[c.tgt[0]] = (sc[c.tgt[0]] || 0) + 1; tb.add(c.tgt[0]); } });

  // 칼날
  ch.forEach(c => { if (c.cid === "abyssal_blade" && !R.disr.has(c.pid) && c.tgt.length) { const t = c.tgt[0]; kt[t] = kt[t] || []; kt[t].push(c.pid); tb.add(t); } });
  Object.entries(kt).forEach(([t, atk]) => { t = +t; const tp = ps.find(p => p.id === t); if (!tp?.alive) return; let rem = atk.length; const av = sc[t] || 0; if (av > 0) { rem -= Math.min(rem, av); if (rem < atk.length) R.prot.push(t); } if (rem > 0) { R.killed.push(t); R.pub.push(`💀 ${tp.name}이(가) 제거되었다. (진영 비공개)`); } else R.pub.push("🛡️ 누군가가 보호받았다."); });

  // 사슬
  ch.forEach(c => { if (c.cid === "specter_chain" && !R.disr.has(c.pid) && c.tgt.length) { R.chained.push({ id: c.tgt[0], r: 1 }); tb.add(c.tgt[0]); } });

  // 정보 결과 라우팅: 강탈 처리
  const route = (pid, info) => {
    if (stolenFrom[pid] !== undefined) {
      const thief = stolenFrom[pid];
      if (!R.priv[thief]) R.priv[thief] = [];
      info.stolenFrom = pid;
      R.priv[thief].push(info);
      if (!R.priv[pid]) R.priv[pid] = [];
      R.priv[pid].push({ card: info.card, result: "stolen", msg: `조사 결과를 빼앗겼다! (심연의 손길)` });
    } else {
      if (!R.priv[pid]) R.priv[pid] = [];
      R.priv[pid].push(info);
    }
  };

  // 정보 카드 처리
  ch.forEach(c => {
    if (!R.priv[c.pid]) R.priv[c.pid] = [];
    if (R.disr.has(c.pid)) {
      R.priv[c.pid].push({ card: c.cid, result: "disrupted", msg: `교란당했다! ${cn(c.cid)} 효과가 무효화되었다.` });
      return;
    }
    if (c.cid === "prophecy_shard" && c.tgt.length >= 2) { const [t1, t2] = c.tgt; tb.add(t1); tb.add(t2); if (fog.has(t1) || fog.has(t2)) route(c.pid, { card: c.cid, targets: c.tgt, result: "unknown", msg: `${pn(ps,t1)}, ${pn(ps,t2)} 조사: 불명 (안개)` }); else { const hv = ps.find(p => p.id === t1)?.faction === "void" || ps.find(p => p.id === t2)?.faction === "void"; route(c.pid, { card: c.cid, targets: c.tgt, result: hv ? "void_present" : "void_absent", msg: `${pn(ps,t1)}, ${pn(ps,t2)} 중 공허: ${hv ? "있다 ⚠️" : "없다 ✅"}` }); } }
    else if (c.cid === "sentinel_eye" && c.tgt.length >= 2) { const [t1, t2] = c.tgt; tb.add(t1); tb.add(t2); if (fog.has(t1) || fog.has(t2)) route(c.pid, { card: c.cid, targets: c.tgt, result: "unknown", msg: `${pn(ps,t1)}, ${pn(ps,t2)} 조사: 불명 (안개)` }); else { const s = ps.find(p => p.id === t1)?.faction === ps.find(p => p.id === t2)?.faction; route(c.pid, { card: c.cid, targets: c.tgt, result: s ? "same" : "different", msg: `${pn(ps,t1)}, ${pn(ps,t2)}: ${s ? "같은 진영" : "다른 진영 ⚠️"}` }); } }
    else if (c.cid === "tracker_eye" && c.tgt.length) { const t = c.tgt[0]; tb.add(t); if (fog.has(t)) route(c.pid, { card: c.cid, target: t, result: "unknown", msg: `${pn(ps,t)} 조사: 불명 (안개)` }); else { const tc = cm[t]; if (tc) route(c.pid, { card: c.cid, target: t, result: tc.cid, msg: `${pn(ps,t)}의 행동: ${cn(tc.cid)}` }); } }
    else if (c.cid === "shadow_eye" && c.tgt.length) { const t = c.tgt[0]; tb.add(t); if (fog.has(t)) route(c.pid, { card: c.cid, target: t, result: "unknown", msg: `${pn(ps,t)} 조사: 불명 (안개)` }); else { const tc = cm[t]; if (tc?.tgt?.length) route(c.pid, { card: c.cid, target: t, result: tc.tgt[0], msg: `${pn(ps,t)} → ${pn(ps,tc.tgt[0])}을(를) 지목` }); else route(c.pid, { card: c.cid, target: t, result: "none", msg: `${pn(ps,t)}: 지목 없음` }); } }
    else if (c.cid === "vigilant_eye" && c.tgt.length) { const t = c.tgt[0]; const wasTgt = tb.has(t); tb.add(t); if (fog.has(t)) route(c.pid, { card: c.cid, target: t, result: "unknown", msg: `${pn(ps,t)} 조사: 불명 (안개)` }); else route(c.pid, { card: c.cid, target: t, result: wasTgt ? "targeted" : "not_targeted", msg: `${pn(ps,t)}: ${wasTgt ? "지목당함 ⚠️" : "지목당하지 않음"}` }); }
    else if (c.cid === "dead_memory" && !R.disr.has(c.pid)) {
      if (R.killed.length) {
        R.killed.forEach(kid => { const kc = cm[kid]; const kp = ps.find(p => p.id === kid); if (kc && kp) { const tgtN = kc.tgt?.length ? kc.tgt.map(t => pn(ps, t)).join(", ") : "없음"; route(c.pid, { card: "dead_memory", target: kid, result: kc.cid, msg: `[망자의 기억] ${kp.name}의 마지막 행동: ${cn(kc.cid)} → ${tgtN}` }); } });
      } else {
        route(c.pid, { card: "dead_memory", target: null, result: "no_death", msg: `[망자의 기억] 이번 밤 제거된 사람이 없다.` });
      }
    }
    // 전투 카드는 priv 결과 없음
  });
  return R;
}

// ═══════════════════════════════════════════
// 메인
// ═══════════════════════════════════════════
export default function App() {
  const [phase, setPhase] = useState("setup");
  const [pendingN, setPendingN] = useState(8);
  const [pendingModel, setPendingModel] = useState("sonnet");
  const [pendingApiKey, setPendingApiKey] = useState("");
  const [players, setPlayers] = useState([]);
  const [bots, setBots] = useState({});
  const HID = 0;
  const [round, setRound] = useState(0);
  const [log, setLog] = useState([]);
  const [secrets, setSecrets] = useState([]);
  const [selCard, setSelCard] = useState(null);
  const [selTgt, setSelTgt] = useState([]);
  const [taken, setTaken] = useState(new Set());
  const [nightData, setNightData] = useState(null);
  const [allChoicesRef, setAllChoicesRef] = useState([]);
  const [dc, setDc] = useState(0);
  const [convLog, setConvLog] = useState("");
  const [draftBefore, setDraftBefore] = useState([]);
  const [gameHistory, setGameHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [pubLogs, setPubLogs] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [revoteCandidates, setRevoteCandidates] = useState([]);
  const ref = useRef(null);

  const addL = useCallback(m => setLog(p => [...p, m]), []);
  const human = useMemo(() => players.find(p => p.id === HID), [players]);
  const alive = useMemo(() => players.filter(p => p.alive), [players]);
  const aliveOth = useMemo(() => alive.filter(p => p.id !== HID), [alive]);
  const humanAlive = human?.alive ?? false;
  const checkV = ps => { const av = ps.filter(p => p.alive && p.faction === "void").length, ag = ps.filter(p => p.alive && p.faction === "guardian").length; if (av === 0) return { w: "guardian", r: "공허 전원 추방" }; if (av >= ag) return { w: "void", r: "공허 수 ≥ 수호자 수" }; return null; };
  useEffect(() => { setTimeout(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, 50); }, [log]);

  const startGame = n => {
    _apiKey = pendingApiKey;
    _currentModel = pendingModel === "opus" ? "claude-opus-4-5-20251101" : "claude-sonnet-4-5-20250929";
    const [ng, nv] = n === 5 ? [4, 1] : [6, 2];
    const fs = [...Array(ng).fill("guardian"), ...Array(nv).fill("void")];
    for (let i = fs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [fs[i], fs[j]] = [fs[j], fs[i]]; }
    const ps = fs.map((f, i) => ({ id: i, name: `P${i + 1}`, faction: f, alive: true, ghost: false, chained: false, chainRounds: 0, actionHistory: [] }));
    const nb = {}, vids = ps.filter(p => p.faction === "void").map(p => p.id);
    ps.forEach(p => { if (p.id !== HID) { const b = new Bot(p); if (p.faction === "void") b.initV(vids); nb[p.id] = b; } });
    setPlayers(ps); setBots(nb); setRound(1); setSecrets([]); setGameHistory([]); setConvLog("");
    const h = ps[HID], vm = h.faction === "void" ? ps.filter(p => p.faction === "void" && p.id !== HID).map(p => p.name).join(", ") : null;
    setLog([`🎮 ${n}인 (수호자 ${ng} / 공허 ${nv})`, `당신은 ${h.name} — ${h.faction === "guardian" ? "🛡️ 수호자" : "🌑 공허"}`, ...(vm ? [`🌑 공허 팀원: ${vm}`] : []), `\n━━━ 라운드 1 · 밤 ━━━`, `🔒 첫 밤: 칼날/방패/사슬/망자의 기억 사용 불가`]);
    doNightDraft(ps, nb, 1);
  };

  const doNightDraft = (ps, bt, rnd) => {
    const order = getDraftOrder(ps, rnd);
    const tk = new Set(), before = [], allDraft = [];
    const orderNames = order.map(p => p.id === HID ? `[${p.name}]` : p.name).join(" → ");
    addL(`🔄 드래프트: ${orderNames}`);
    let humanReached = false, idx = 0;
    const afterIds = [];
    for (const p of order) {
      if (p.id === HID) { humanReached = true; window._humanDraftIdx = idx; idx++; continue; }
      if (!humanReached) {
        const bot = bt[p.id]; if (bot) { const a = bot.act(ps, tk, rnd); const info = { pid: p.id, cid: a.c, tgt: a.t, disr: false, order: idx }; before.push(info); allDraft.push(info); tk.add(a.c); bot.myChoices.push({ round: rnd, cid: a.c, tgt: a.t }); }
      } else { afterIds.push(p.id); }
      idx++;
    }
    if (before.length) addL(`🌙 ${before.length}명이 먼저 골랐다 (남은 ${12 - tk.size}장)`);
    setTaken(tk); setDraftBefore(before); setSelCard(null); setSelTgt([]);
    window._afterBots = afterIds; window._bots = bt; window._rnd = rnd; window._allDraft = allDraft;
    if (ps.find(p => p.id === HID)?.alive) { setPhase("night_card"); }
    else { finishDraft(ps, bt, tk, before, afterIds, allDraft, rnd, null); }
  };

  const finishDraft = (ps, bt, tk, before, afterIds, allDraft, rnd, humanChoice) => {
    const afterChoices = [];
    let idx = allDraft.length + (humanChoice ? 1 : 0);
    for (const pid of afterIds) { const bot = bt[pid]; if (bot) { const a = bot.act(ps, tk, rnd); const info = { pid, cid: a.c, tgt: a.t, disr: false, order: idx++ }; afterChoices.push(info); allDraft.push(info); tk.add(a.c); bot.myChoices.push({ round: rnd, cid: a.c, tgt: a.t }); } }
    const allChoices = humanChoice ? [...before, humanChoice, ...afterChoices] : [...before, ...afterChoices];
    setNightData(allChoices); setAllChoicesRef(allDraft); setTaken(tk);
    // R1: 칼날 잠금이라 예측 스킵. R2+: 예측 단계
    if (rnd >= 2 && ps.find(p => p.id === HID)?.alive) {
      // 봇 예측 미리 수집
      const botPreds = {};
      ps.filter(p => p.alive && p.id !== HID).forEach(p => { const b = bt[p.id]; if (b) botPreds[p.id] = b.predict(ps); });
      setPredictions(botPreds);
      addL(`\n🔮 이번 밤 누가 죽을지 예측하세요.`);
      setPhase("night_predict");
    } else {
      resolveNight(ps, allChoices, allDraft, rnd, {});
    }
  };

  const submitNight = (cid, tgt) => {
    if (loading) return; // 중복 클릭 방지
    setPhase("night_resolving"); // 즉시 버튼 숨김
    const ps = players, tk = new Set(taken); tk.add(cid);
    const c = CARDS.find(x => x.id === cid);
    addL(`🌙 당신: ${c?.emoji} ${c?.name}${tgt.length ? ` → ${tgt.map(t => pn(ps, t)).join(", ")}` : ""}`);
    const hc = { pid: HID, cid, tgt, disr: false, order: window._humanDraftIdx };
    const allDraft = [...(window._allDraft || []), hc];
    finishDraft(ps, window._bots || bots, tk, draftBefore, window._afterBots || [], allDraft, window._rnd, hc);
  };

  const submitPrediction = (tid) => {
    if (loading) return; // 중복 클릭 방지
    setLoading(true);
    setPhase("night_resolving"); // 즉시 버튼 숨김
    const preds = { ...predictions, [HID]: tid };
    if (tid === -1) addL(`🔮 예측: 아무도 안 죽는다`);
    else addL(`🔮 예측: ${pn(players, tid)}이(가) 죽을 것이다`);
    resolveNight(players, nightData, allChoicesRef, round, preds);
  };

  const resolveNight = async (ps, ch, allDraft, rnd, preds = {}) => {
    ps.forEach(p => { if (p.chained) { p.chainRounds--; if (p.chainRounds <= 0) p.chained = false; } });

    const R = nightProc(ps, ch);
    R.disr.forEach(pid => { const d = allDraft.find(c => c.pid === pid); if (d) d.wasDisrupted = true; });

    R.killed.forEach(k => { const p = ps.find(x => x.id === k); if (p) { p.alive = false; p.ghost = true; } });
    R.chained.forEach(({ id, r }) => { const p = ps.find(x => x.id === id); if (p) { p.chained = true; p.chainRounds = r; } });
    ch.forEach(c => { const p = ps.find(x => x.id === c.pid); if (p) p.actionHistory.push({ round: rnd, cat: CARDS.find(x => x.id === c.cid).cat }); });
    setPlayers([...ps]);

    const pubLogs = [];
    R.pub.forEach(l => { addL(l); pubLogs.push(l); });
    R.chained.forEach(({ id, r }) => { const m = `⛓️ ${pn(ps, id)}가 망령의 사슬에 걸렸다 — ${r}라운드 동안 전투 카드 사용 불가`; addL(m); pubLogs.push(m); });
    if (!R.pub.length && !R.chained.length) { addL("🌙 평화로운 밤이었다."); }

    // 예측 결과 확인
    if (Object.keys(preds).length > 0) {
      const killedSet = new Set(R.killed);
      const noneKilled = R.killed.length === 0;
      let correctCount = 0;
      const publicReveals = []; // 사망한 예측 적중자 → 진영 공개
      Object.entries(preds).forEach(([pid, pred]) => {
        pid = +pid;
        const correct = (pred === -1 && noneKilled) || killedSet.has(pred);
        if (correct) {
          correctCount++;
          if (pred !== -1) {
            const dead = ps.find(p => p.id === pred);
            // 예측 적중자가 이번 밤에 같이 죽었으면 → 죽은 대상의 진영 공개 (유언 효과)
            if (dead && killedSet.has(pid)) {
              const fs = dead.faction === "guardian" ? "수호자" : "공허";
              publicReveals.push(`🪦 ${pn(ps, pid)}의 유언 예측 적중! ${dead.name}의 진영 공개: ${fs}`);
              Object.values(bots).forEach(b => b.kf[dead.id] = dead.faction);
              if (pid === HID) {
                addL(`🎯 예측 적중! (유언) ${dead.name}의 진영: ${fs} — 전원 공개`);
                setSecrets(prev => [...prev, { round: rnd, card: "prediction", result: dead.faction, msg: `[유언 예측] ${dead.name}은(는) ${fs}였다 (공개)` }]);
              }
            } else if (dead && pid === HID) {
              const fs = dead.faction === "guardian" ? "수호자" : "공허";
              addL(`🎯 예측 적중! ${dead.name}의 진영: ${fs}`);
              setSecrets(prev => [...prev, { round: rnd, card: "prediction", result: dead.faction, msg: `[예측 적중] ${dead.name}은(는) ${fs}였다` }]);
            }
            // 봇이 맞혔으면 봇에게도 진영 정보 제공
            const b = bots[pid];
            if (b && dead) { b.kf[dead.id] = dead.faction; }
          } else if (pid === HID) {
            addL(`🎯 예측 적중! 아무도 죽지 않았다.`);
          }
        } else if (pid === HID) {
          addL(`❌ 예측 빗나감.`);
        }
      });
      if (correctCount > 0) { const m = `🎯 ${correctCount}명이 예측에 성공했다.`; addL(m); pubLogs.push(m); }
      publicReveals.forEach(m => { addL(m); pubLogs.push(m); });
    }

    // 비밀 정보 — 인간 (항상 표시!)
    const myInfos = R.priv[HID] || [];
    myInfos.forEach(i => {
      if (i.result === "disrupted") addL(`⚡ ${i.msg}`);
      else addL(`🔮 ${i.msg}`);
      setSecrets(prev => [...prev, { round: rnd, ...i }]);
    });
    // 봇
    Object.entries(R.priv).forEach(([pid, infos]) => { const b = bots[+pid]; if (b) b.learn(infos.map(i => ({ ...i, round: rnd }))); });

    // 승리 판정 (밤 제거 후)
    const v1 = checkV(ps);
    if (v1) { setPhase("gameover"); return; }

    setPubLogs(pubLogs);
    addL(`\n━━━ 밤 결과 확인 ━━━`);

    // 인간 생존 → night_result에서 대기, 사망 → 자동 진행
    if (ps.find(p => p.id === HID)?.alive) {
      setLoading(false);
      setPhase("night_result");
    } else {
      setLoading(false);
      await proceedToDiscussion(ps, allDraft, pubLogs, rnd);
    }
  };

  const proceedToDiscussion = async (ps, allDraft, pubLogsArr, rnd) => {
    addL(`\n━━━ 라운드 ${rnd} · 낮 ━━━`);


    const prevConv = convLog ? `이전 대화 요약:\n${convLog}\n` : "";
    setLoading(true);
    let conv = prevConv;
    try {
      const stmts = await generateDiscussion(ps || players, bots, allDraft || allChoicesRef, rnd || round, gameHistory, pubLogsArr || pubLogs);
      stmts.forEach(s => { const sp = (ps || players).find(p => p.id === s.id); if (sp?.alive) { const line = `${sp.name}: "${s.msg}"`; addL(`💬 ${line}`); conv += line + "\n"; } });
      if (!stmts.length) addL("💬 아무도 발언하지 않았다.");
    } catch { addL("💬 (토론 생성 실패)"); }
    setConvLog(conv);
    setLoading(false);
    setDc(0);

    if ((ps || players).find(p => p.id === HID)?.alive) { setPhase("discuss"); }
    else {
      // 인간 사망 → 봇끼리 API 기반 투표
      try {
        const tally = await generateBotVotes(ps || players, bots, allDraft || allChoicesRef, rnd || round, conv);
        doVoteResult(ps || players, tally, rnd || round);
      } catch {
        const tally = {};
        (ps || players).filter(p => p.alive).forEach(p => { const b = bots[p.id]; if (b) { const v = b.vote(ps || players); tally[v] = (tally[v] || 0) + 1; } });
        doVoteResult(ps || players, tally, rnd || round);
      }
    }
  };

  const myDecl = async (type, tid, claim) => {
    const tp = players.find(p => p.id === tid);
    let msg = type === "faction" ? `${tp?.name}은(는) ${claim === "void" ? "공허" : "수호자"}다` : type === "suspect" ? `${tp?.name}이(가) 수상하다` : type === "trust" ? `${tp?.name}을(를) 믿는다` : claim;
    addL(`🗣️ 당신: "${msg}"`);
    setDc(p => p + 1);
    const currentConv = convLog + `P1: "${msg}"\n`;
    setLoading(true);
    try {
      const rx = await generateReactions(players, bots, msg, allChoicesRef, round, currentConv);
      let newConv = currentConv;
      rx.forEach(r => { const sp = players.find(p => p.id === r.id); if (sp?.alive) { addL(`  💬 ${sp.name}: "${r.msg}"`); newConv += `${sp.name}: "${r.msg}"\n`; } });
      if (!rx.length) addL("  💭 반응 없음");
      setConvLog(newConv);
    } catch { addL("  💭 반응 없음"); }
    setLoading(false);
  };

  const submitVote = async (tid) => {
    setLoading(true);
    addL("🗳️ 투표 집계 중...");
    try {
      const tally = await generateBotVotes(players, bots, allChoicesRef, round, convLog);
      if (tid >= 0) tally[tid] = (tally[tid] || 0) + 1;
      setLoading(false);
      doVoteResult([...players], tally, round);
    } catch {
      // API 실패 시 기존 방식 폴백
      const ps = [...players];
      const tally = {};
      if (tid >= 0) tally[tid] = 1;
      ps.filter(p => p.alive && p.id !== HID).forEach(p => { const b = bots[p.id]; if (b) { const v = b.vote(ps); tally[v] = (tally[v] || 0) + 1; } });
      setLoading(false);
      doVoteResult(ps, tally, round);
    }
  };

  const submitRevote = async (tid) => {
    setLoading(true);
    addL("⚖️ 재투표 집계 중...");
    try {
      const allTally = await generateBotVotes(players, bots, allChoicesRef, round, convLog);
      // 재투표: 동점 후보만 유효
      const revoteTally = {};
      Object.entries(allTally).forEach(([id, v]) => { if (revoteCandidates.includes(+id)) revoteTally[+id] = v; });
      if (tid >= 0 && revoteCandidates.includes(tid)) revoteTally[tid] = (revoteTally[tid] || 0) + 1;
      setLoading(false);
      doVoteResult([...players], Object.keys(revoteTally).length ? revoteTally : {}, round, true);
    } catch {
      const ps = [...players];
      const revoteTally = {};
      if (tid >= 0 && revoteCandidates.includes(tid)) revoteTally[tid] = 1;
      ps.filter(p => p.alive && p.id !== HID).forEach(p => { const b = bots[p.id]; if (b) { const v = b.vote(ps); if (revoteCandidates.includes(v)) revoteTally[v] = (revoteTally[v] || 0) + 1; } });
      setLoading(false);
      doVoteResult(ps, Object.keys(revoteTally).length ? revoteTally : {}, round, true);
    }
  };

  const doVoteResult = (ps, tally, rnd, isRevote = false) => {
    const vals = Object.values(tally), maxV = vals.length ? Math.max(...vals) : 0;
    if (!maxV) { addL("🗳️ 투표 없음"); goNextNight(rnd, ps); return; }

    const top = Object.entries(tally).filter(([, v]) => v === maxV).map(([id]) => +id);
    { const vs = Object.entries(tally).sort(([, a], [, b]) => b - a).map(([id, v]) => `${pn(ps,+id)}:${v}`).join(" "); addL(`📊 투표: ${vs}`); }

    // 동점 처리
    if (top.length > 1) {
      if (!isRevote) {
        // 1차 동점: 재투표 실시
        addL(`⚖️ 동점! ${top.map(id => pn(ps, id)).join(", ")} — 재투표 실시`);
        // 인간이 살아있으면 재투표 UI로
        if (ps.find(p => p.id === HID)?.alive) {
          setRevoteCandidates(top);
          setPhase("revote");
          return;
        }
        // 인간 사망 → 봇만 재투표
        const revoteTally = {};
        ps.filter(p => p.alive && p.id !== HID).forEach(p => { const b = bots[p.id]; if (b) { const v = b.vote(ps); if (top.includes(v)) revoteTally[v] = (revoteTally[v] || 0) + 1; } });
        doVoteResult(ps, Object.keys(revoteTally).length ? revoteTally : tally, rnd, true);
        return;
      } else {
        // 재투표에서도 동점: 추방 없음
        addL("⚖️ 재투표에서도 동점 — 추방 없음");
        setGameHistory(prev => [...prev, `R${rnd}: 추방없음(동점)`]);
        goNextNight(rnd, ps);
        return;
      }
    }

    const isH = false;
    let exiled = [top[0]];
    const summ = [];
    exiled.forEach(eid => { const p = ps.find(x => x.id === eid); if (p) { p.alive = false; p.ghost = true; const fs = isH ? "비공개" : (p.faction === "guardian" ? "수호자" : "공허"); addL(`🗳️ ${p.name} 추방 (${fs})`); summ.push(`${p.name} 추방(${fs})`); if (!isH) Object.values(bots).forEach(b => b.recE(p.id, p.faction)); } });
    setPlayers([...ps]);
    setGameHistory(prev => [...prev, `R${rnd}: ${summ.join(", ") || "추방없음"}`]);

    const voids = ps.filter(p => p.alive && p.faction === "void").length;
    const guards = ps.filter(p => p.alive && p.faction === "guardian").length;
    if (voids === 0 || voids >= guards) {
      setPhase("gameover");
      return;
    }
    goNextNight(rnd, ps);
  };

  const goNextNight = (currentRound, currentPlayers) => {
    const rnd = currentRound || round;
    const ps = currentPlayers || players;
    const nr = rnd + 1; setRound(nr);

    const surv = ps.filter(p => p.alive);
    addL(`\n━━━ 라운드 ${nr} · 밤 ━━━`);
    addL(`👥 생존 ${surv.length}명: ${surv.map(p => p.name + (p.id === 0 ? "★" : "")).join(", ")}`);

    doNightDraft(ps, bots, nr);
  };

  const victory = checkV(players);
  const availCards = useMemo(() => {
    if (!human?.alive) return [];
    let c = CARDS.filter(x => !taken.has(x.id));
    if (human?.chained) c = c.filter(x => x.cat === "info");
    if (round === 1) c = c.filter(x => !["abyssal_blade", "dead_memory", "ward_shield", "specter_chain"].includes(x.id));
    return c;
  }, [human, taken, round]);
  const recentSecrets = useMemo(() => secrets.filter(s => s.round === round && s.result !== "no_death"), [secrets, round]);

  const S = {
    page: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "#0B0E17", color: "#E2E8F0", fontFamily: "'Noto Sans KR', sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" },
    hdr: { padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "#94A3B8", flexShrink: 0 },
    main: { flex: 1, display: "flex", flexDirection: "column", maxWidth: 560, margin: "0 auto", width: "100%", padding: "0 10px", position: "relative", minHeight: 0 },
    logBox: { flex: 1, overflowY: "auto", padding: "6px 0", minHeight: 0, WebkitOverflowScrolling: "touch" },
    pnl: { flexShrink: 0, padding: "8px 0 12px", borderTop: "1px solid rgba(255,255,255,0.06)", maxHeight: "40vh", overflowY: "auto", WebkitOverflowScrolling: "touch" },
    btn: c => ({ display: "block", width: "100%", padding: "9px 14px", background: `${c}18`, border: `1px solid ${c}44`, borderRadius: 8, color: "#E2E8F0", fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left", marginBottom: 3 }),
    btnSm: c => ({ display: "block", width: "100%", padding: "6px 10px", background: `${c}12`, border: `1px solid ${c}33`, borderRadius: 6, color: "#E2E8F0", fontSize: 11, cursor: "pointer", textAlign: "left", marginBottom: 2 }),
    tBtn: s => ({ padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, background: s ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.05)", border: s ? "1px solid #3B82F6" : "1px solid rgba(255,255,255,0.1)", color: "#E2E8F0" }),
    sub: { fontSize: 10, color: "#64748B", marginBottom: 3, marginTop: 6 },
  };

  return (
    <div style={S.page}>
      <style>{`html,body,#root{margin:0;padding:0;height:100%;overflow:hidden}`}</style>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet" />
      {phase !== "setup" && phase !== "rules" && <div style={S.hdr}><span>R{round} {human?.faction === "guardian" ? "🛡️" : "🌑"}{!humanAlive ? " 💀" : ""}</span><span style={{ fontWeight: 700, letterSpacing: 1 }}>성역의 균열</span><span style={{ display: "flex", alignItems: "center", gap: 8 }}><button onClick={() => setShowHelp(h => !h)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, color: "#94A3B8", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>📖 규칙</button>{pendingModel === "opus" ? "🧠" : "⚡"} 생존{alive.length}</span></div>}
      <div style={S.main}>
        {showHelp && <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(11,14,23,0.95)", zIndex: 100, overflowY: "auto", padding: "16px 12px" }}>
          <div style={{ maxWidth: 540, margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#E2E8F0" }}>규칙 & 카드</h2>
              <button onClick={() => setShowHelp(false)} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 6, color: "#E2E8F0", fontSize: 13, padding: "6px 14px", cursor: "pointer" }}>✕ 닫기</button>
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#93C5FD", marginBottom: 4 }}>승리 조건</div>
              <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.8 }}>🛡️ 수호자: 공허 전원 추방<br/>🌑 공허: 생존 공허 ≥ 생존 수호자</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#93C5FD", marginBottom: 4 }}>라운드 흐름</div>
              <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.8 }}>밤(카드 드래프트) → 예측(R2+) → 밤 결과 → 토론 → 투표 추방</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#60A5FA", marginBottom: 6 }}>정보 카드 (청색) — 6종</div>
              <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 2 }}>
                🔮 <b>예지의 파편</b> — 2명 중 공허 포함? (있다/없다)<br/>
                👁️ <b>파수꾼의 눈</b> — 2명 같은 진영? (같다/다르다)<br/>
                🔍 <b>추적자의 눈</b> — 대상의 카드 이름 확인<br/>
                👤 <b>미행의 눈</b> — 대상이 누구를 지목했는지<br/>
                ⚠️ <b>경계의 눈</b> — 대상이 지목당했는지<br/>
                💀 <b>망자의 기억</b> — 칼날 제거된 자의 행동+지목 확인 (R1 사용불가 🔒)
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#F87171", marginBottom: 6 }}>전투 카드 (적색) — 6종</div>
              <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 2 }}>
                ⚔️ <b>심연의 칼날</b> — 1명 제거 (R1 사용불가 🔒)<br/>
                🛡️ <b>결계의 방패</b> — 1명 보호 (자신 포함) (R1 사용불가 🔒)<br/>
                🌫️ <b>안개의 장막</b> — 자신에 대한 정보 조사 → "불명"<br/>
                💨 <b>교란의 속삭임</b> — 대상 카드 효과 무효화<br/>
                ⛓️ <b>망령의 사슬</b> — 다음 턴 전투 카드 사용 금지 (R1 사용불가 🔒)<br/>
                🖐️ <b>심연의 손길</b> — 대상의 정보 결과를 빼앗아 내가 받음
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#FBBF24", marginBottom: 4 }}>핵심 메커니즘</div>
              <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.8 }}>
                <b>드래프트</b> — 시계방향 회전. 중복 불가(같은 카드 2명 못 씀).<br/>
                <b>처리 순서</b> — 교란→안개→손길→방패→칼날→사슬→정보→망자의 기억<br/>
                <b>R1 제한</b> — 칼날/방패/사슬/망자의 기억 사용 불가.<br/>
                <b>예측</b> — R2부터, 카드 선택 후 "누가 죽을까" 예측. 맞히면 사망자 진영 확인(비공개). 맞힌 사람이 같은 밤에 죽으면 진영 공개(유언).<br/>
                <b>추방</b> — 기본 진영 공개.<br/>
                <b>제거(칼날)</b> — 진영 비공개. (예측 적중 시에만 확인 가능)<br/>
                <b>동점</b> — 재투표 1회 실시, 그래도 동점이면 추방 없음.
              </div>
            </div>

          </div>
        </div>}

        {phase !== "setup" && phase !== "rules" && <div ref={ref} style={S.logBox}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginBottom: 4 }}>{players.map(p => <div key={p.id} style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, background: p.id === HID ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.04)", opacity: p.alive ? 1 : 0.3, border: p.chained ? "1px solid #EF444466" : "none" }}>{p.name}{p.id === HID ? "★" : ""}{!p.alive ? "💀" : ""}{p.chained ? "⛓️" : ""}<span style={{ color: "#475569", marginLeft: 2, fontSize: 9 }}>정{p.actionHistory.filter(h => h.cat === "info").length}전{p.actionHistory.filter(h => h.cat === "combat").length}</span></div>)}</div>
          {log.map((l, i) => <div key={i} style={{ fontSize: 12, lineHeight: 1.6, color: l.startsWith("🔮") ? "#A78BFA" : l.startsWith("💀") ? "#F87171" : l.startsWith("━") ? "#475569" : l.startsWith("🗣️") ? "#60A5FA" : l.startsWith("  ") ? "#94A3B8" : l.startsWith("🔄") ? "#6EE7B7" : l.startsWith("🔒") || l.startsWith("⚡") ? "#FBBF24" : l.startsWith("👥") ? "#6EE7B7" : l.startsWith("⚖️") ? "#F59E0B" : l.startsWith("🪦") ? "#FCA5A5" : l.startsWith("🎯") ? "#34D399" : l.startsWith("❌") ? "#EF4444" : "#CBD5E1", fontWeight: l.startsWith("━") ? 700 : 400 }}>{l}</div>)}
          {loading && <div style={{ textAlign: "center", padding: "12px 0", color: "#94A3B8", fontSize: 13 }}>{phase === "vote" || phase === "revote" ? "🗳️ 봇들이 투표 중..." : phase === "night_resolving" ? "🌙 밤 결과 처리 중..." : "💭 각 봇이 순서대로 발언 중..."}</div>}
        </div>}

        {phase === "setup" && <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
          <div style={{ fontSize: 12, letterSpacing: 6, color: "#475569", marginBottom: 8 }}>RIFT OF THE SANCTUARY</div>
          <h1 style={{ fontSize: 32, fontWeight: 900, margin: "0 0 6px", background: "linear-gradient(135deg, #3B82F6, #8B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>성역의 균열</h1>
          <p style={{ color: "#475569", margin: "0 0 24px", fontSize: 13 }}>1인 vs AI (Claude) · 프로토타입</p>

          <div style={{ marginBottom: 20, width: "100%", maxWidth: 320 }}>
            <label style={{ display: "block", fontSize: 11, color: "#94A3B8", marginBottom: 6 }}>🔑 Anthropic API Key <span style={{ color: "#EF4444" }}>*필수</span></label>
            <input
              type="password"
              placeholder="sk-ant-..."
              value={pendingApiKey}
              onChange={e => setPendingApiKey(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "#E2E8F0", fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
            <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>
              API 키는 <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#60A5FA" }}>console.anthropic.com</a>에서 발급받으세요
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
            <button onClick={() => setPendingModel("sonnet")} style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, background: pendingModel === "sonnet" ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.05)", border: pendingModel === "sonnet" ? "1px solid #3B82F6" : "1px solid rgba(255,255,255,0.1)", color: "#E2E8F0" }}>⚡ Sonnet<br/><span style={{ fontSize: 10, fontWeight: 400, color: "#94A3B8" }}>빠름 · 일반</span></button>
            <button onClick={() => setPendingModel("opus")} style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, background: pendingModel === "opus" ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.05)", border: pendingModel === "opus" ? "1px solid #8B5CF6" : "1px solid rgba(255,255,255,0.1)", color: "#E2E8F0" }}>🧠 Opus<br/><span style={{ fontSize: 10, fontWeight: 400, color: "#94A3B8" }}>깊은 추론 · 느림</span></button>
          </div>
          <div style={{ display: "flex", gap: 12 }}>{[5, 8].map(n => <button key={n} disabled={!pendingApiKey} onClick={() => { setPendingN(n); setPhase("rules"); }} style={{ padding: "14px 28px", background: pendingApiKey ? "rgba(59,130,246,0.1)" : "rgba(100,100,100,0.1)", border: pendingApiKey ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(100,100,100,0.2)", borderRadius: 8, color: pendingApiKey ? "#E2E8F0" : "#64748B", fontSize: 15, fontWeight: 700, cursor: pendingApiKey ? "pointer" : "not-allowed" }}>{n}인</button>)}</div>
          {!pendingApiKey && <div style={{ marginTop: 8, fontSize: 11, color: "#EF4444" }}>API 키를 입력해야 게임을 시작할 수 있습니다</div>}
        </div>}

        {phase === "rules" && <div style={{ flex: 1, overflowY: "auto", padding: "16px 4px" }}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <h2 style={{ fontSize: 22, fontWeight: 900, margin: "0 0 4px", color: "#E2E8F0" }}>게임 규칙</h2>
            <p style={{ color: "#64748B", fontSize: 12, margin: 0 }}>{pendingN}인 모드 · 수호자 {pendingN === 5 ? 4 : 6} / 공허 {pendingN === 5 ? 1 : 2}</p>
          </div>

          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#93C5FD", marginBottom: 6 }}>승리 조건</div>
            <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.8 }}>
              🛡️ <b>수호자</b>: 공허를 전원 추방하면 승리<br/>
              🌑 <b>공허</b>: 생존 공허 수 ≥ 생존 수호자 수가 되면 승리
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#93C5FD", marginBottom: 6 }}>라운드 흐름</div>
            <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.8 }}>
              <b>① 밤</b> — 카드 1장을 드래프트 순서대로 선택 (중복 불가)<br/>
              <b>② 예측</b> — "이번 밤 누가 죽을까?" 비밀 예측. 맞히면 죽은 사람의 진영 확인 (R1 스킵)<br/>
              <b>③ 밤 결과</b> — 제거, 보호, 사슬 등 공개 + 조사 결과 비밀 전달<br/>
              <b>④ 토론</b> — 봇들이 순서대로 발언, 플레이어도 3회 발언 가능<br/>
              <b>⑤ 투표</b> — 추방 대상 선택, 과반 시 추방 (기본: 진영 공개)
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#60A5FA", marginBottom: 6 }}>정보 카드 (청색)</div>
            <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 2 }}>
              🔮 <b>예지의 파편</b> — 2명 지목, 공허 포함 여부 ("있다/없다")<br/>
              👁️ <b>파수꾼의 눈</b> — 2명 지목, 같은 진영인지 ("같다/다르다")<br/>
              🔍 <b>추적자의 눈</b> — 1명 지목, 이번 밤 사용한 카드 이름 확인<br/>
              👤 <b>미행의 눈</b> — 1명 지목, 이번 밤 누구를 지목했는지 확인<br/>
              ⚠️ <b>경계의 눈</b> — 1명 지목, 누군가에게 지목당했는지 확인<br/>
              💀 <b>망자의 기억</b> — 대상 없음, 칼날로 제거된 자의 행동+지목 확인 (R1 사용불가 🔒)
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#F87171", marginBottom: 6 }}>전투 카드 (적색)</div>
            <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 2 }}>
              ⚔️ <b>심연의 칼날</b> — 1명 제거 (R1 사용불가 🔒)<br/>
              🛡️ <b>결계의 방패</b> — 1명 보호 (자신 포함, 제거 1회 방어) (R1 사용불가 🔒)<br/>
              🌫️ <b>안개의 장막</b> — 자기 자신, 모든 정보 조사를 "불명"으로<br/>
              💨 <b>교란의 속삭임</b> — 1명 지목, 대상 카드 효과 완전 무효화<br/>
              ⛓️ <b>망령의 사슬</b> — 1명 지목, 다음 라운드 전투 카드 사용 금지 (R1 사용불가 🔒)<br/>
              🖐️ <b>심연의 손길</b> — 1명 지목, 대상의 정보 카드 결과를 빼앗아 내가 받음
            </div>
          </div>



          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#FBBF24", marginBottom: 6 }}>핵심 메커니즘</div>
            <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.8 }}>
              <b>드래프트</b> — 매 라운드 시작점이 시계방향으로 1칸 회전. 앞 사람이 고른 카드는 못 고름.<br/>
              <b>밤 처리 순서</b> — 교란 → 안개 → 손길 → 방패 → 칼날 → 사슬 → 정보 → 망자의 기억<br/>
              <b>R1 제한</b> — 칼날/방패/사슬/망자의 기억 사용 불가. 첫 밤은 정보 수집+교란+안개+손길만 가능.<br/>
              <b>예측</b> — R2부터, 카드 선택 후 "누가 죽을까" 예측. 맞히면 사망자 진영 확인(비공개). 맞힌 사람이 같은 밤에 죽으면 진영 공개(유언).<br/>
              <b>추방(투표)</b> — 기본 진영 공개. 동점 시 재투표 1회, 그래도 동점이면 추방 없음.<br/>
              <b>제거(칼날)</b> — 진영 비공개.<br/>
              <b>유령</b> — 제거/추방 후 유령 상태. 투표 0.5표, 발언 1문장, 카드 선택 불가.
            </div>
          </div>

          <button onClick={() => startGame(pendingN)} style={{ display: "block", width: "100%", padding: "14px", background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.4)", borderRadius: 10, color: "#E2E8F0", fontSize: 16, fontWeight: 700, cursor: "pointer", marginTop: 8, textAlign: "center" }}>🎮 게임 시작</button>
          <button onClick={() => setPhase("setup")} style={{ display: "block", width: "100%", padding: "10px", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#94A3B8", fontSize: 12, cursor: "pointer", marginTop: 6, textAlign: "center" }}>← 인원 다시 선택</button>
        </div>}

        {phase === "night_card" && !loading && <div style={S.pnl}>
          <div style={{ fontSize: 12, color: "#8B5CF6", marginBottom: 6, textAlign: "center" }}>🌙 카드 선택 (남은 {availCards.length}장){human?.chained ? " ⛓️전투불가" : ""}{round === 1 ? " 🔒R1제한(칼날/방패/사슬/망자)" : ""}</div>
          {!selCard ? <div>{availCards.map(c => <button key={c.id} onClick={() => { if (c.target === "self") submitNight(c.id, [HID]); else if (c.target === "none") submitNight(c.id, []); else { setSelCard(c); setSelTgt([]); } }} style={S.btn(c.cat === "info" ? "#3B82F6" : "#EF4444")}>{c.emoji} {c.name} <span style={{ color: "#64748B", fontWeight: 400, marginLeft: 6 }}>{c.desc}</span></button>)}</div>
          : <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{selCard.emoji} {selCard.name} — 대상 ({selTgt.length}/{selCard.target === "two" ? 2 : 1})</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>{(selCard.target === "any" ? alive : aliveOth).map(p => { const s = selTgt.includes(p.id); return <button key={p.id} onClick={() => { const need = selCard.target === "two" ? 2 : 1; let nx = s ? selTgt.filter(x => x !== p.id) : [...selTgt, p.id]; if (nx.length === need) submitNight(selCard.id, nx); else setSelTgt(nx); }} style={S.tBtn(s)}>{p.name}</button>; })}</div>
            <button onClick={() => { setSelCard(null); setSelTgt([]); }} style={{ fontSize: 11, color: "#94A3B8", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>← 다시</button>
          </div>}
        </div>}


        {phase === "night_predict" && !loading && <div style={S.pnl}>
          <div style={{ fontSize: 12, color: "#F59E0B", marginBottom: 6, textAlign: "center" }}>🔮 이번 밤 누가 죽을까?</div>
          <div style={{ fontSize: 10, color: "#64748B", textAlign: "center", marginBottom: 6 }}>맞히면 죽은 사람의 진영을 확인할 수 있다</div>
          {aliveOth.map(p => <button key={p.id} onClick={() => submitPrediction(p.id)} style={S.btnSm("#F59E0B")}>{p.name}</button>)}
          <button onClick={() => submitPrediction(-1)} style={S.btnSm("#6B7280")}>아무도 안 죽는다</button>
        </div>}

        {phase === "night_result" && <div style={S.pnl}>
          <div style={{ fontSize: 12, color: "#A78BFA", marginBottom: 8, textAlign: "center" }}>🌙 밤 결과를 확인하세요</div>
          <div style={{ fontSize: 11, color: "#64748B", textAlign: "center", marginBottom: 8, lineHeight: 1.6 }}>위 로그에서 제거/보호/사슬/조사 결과를 확인한 후 토론으로 넘어가세요.</div>
          {!loading && <button onClick={() => { setLoading(true); setPhase("night_resolving"); proceedToDiscussion(players, allChoicesRef, pubLogs, round); }} style={{ ...S.btn("#F59E0B"), textAlign: "center" }}>☀️ 토론으로 →</button>}
          {loading && <div style={{ textAlign: "center", color: "#94A3B8", fontSize: 12, padding: 8 }}>💭 토론 준비 중...</div>}
        </div>}

        {phase === "discuss" && !loading && <div style={S.pnl}>
          <div style={{ fontSize: 12, color: "#F59E0B", marginBottom: 4, textAlign: "center" }}>☀️ 토론 ({dc}/3)</div>
          {recentSecrets.length > 0 && dc < 3 && <div><div style={S.sub}>📋 조사 결과 공유</div>
            {recentSecrets.map((s, i) => <button key={`s${i}`} onClick={() => myDecl("info_share", s.targets?.[0] || s.target || HID, s.msg)} style={S.btnSm("#8B5CF6")}>R{s.round}: {s.msg}</button>)}</div>}
          {dc < 3 && <div><div style={S.sub}>🎯 발언</div>
            {aliveOth.map(p => <div key={p.id} style={{ display: "flex", gap: 3, marginBottom: 3 }}>
              <button onClick={() => myDecl("suspect", p.id)} style={{ ...S.btnSm("#EF4444"), flex: 1, textAlign: "center" }}>🔴 {p.name} 의심</button>
              <button onClick={() => myDecl("trust", p.id)} style={{ ...S.btnSm("#10B981"), flex: 1, textAlign: "center" }}>🟢 {p.name} 신뢰</button>
              <button onClick={() => myDecl("faction", p.id, "void")} style={{ ...S.btnSm("#F59E0B"), flex: 1, textAlign: "center" }}>⚠️ 공허 지목</button>
            </div>)}</div>}
          {dc >= 3 && <div style={{ textAlign: "center", color: "#64748B", fontSize: 12, margin: "8px 0" }}>발언 완료</div>}
          <button onClick={() => setPhase("vote")} style={{ ...S.btn("#EF4444"), textAlign: "center", marginTop: 8 }}>🗳️ 투표로</button>
        </div>}

        {phase === "vote" && !loading && <div style={S.pnl}>
          <div style={{ fontSize: 12, color: "#EF4444", marginBottom: 6, textAlign: "center" }}>🗳️ 추방 대상</div>
          {aliveOth.map(p => <button key={p.id} onClick={() => submitVote(p.id)} style={S.btn("#EF4444")}>{p.name} 추방</button>)}
          <button onClick={() => submitVote(-1)} style={S.btn("#6B7280")}>기권</button>
        </div>}

        {phase === "revote" && !loading && <div style={S.pnl}>
          <div style={{ fontSize: 12, color: "#F59E0B", marginBottom: 6, textAlign: "center" }}>⚖️ 재투표 — 동점 후보 중 선택</div>
          {revoteCandidates.map(id => { const p = players.find(x => x.id === id); return p ? <button key={id} onClick={() => submitRevote(id)} style={S.btn("#F59E0B")}>{p.name} 추방</button> : null; })}
          <button onClick={() => submitRevote(-1)} style={S.btn("#6B7280")}>기권</button>
        </div>}

        {phase === "gameover" && victory && <div style={S.pnl}>
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>{victory.w === "guardian" ? "🛡️" : "🌑"}</div>
            <h2 style={{ fontSize: 20, fontWeight: 900, margin: "0 0 4px", color: victory.w === "guardian" ? "#93C5FD" : "#FCA5A5" }}>{victory.w === "guardian" ? "수호자 승리" : "공허 승리"}</h2>
            <p style={{ color: "#94A3B8", fontSize: 13, margin: "0 0 10px" }}>{victory.r}</p>
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 10, marginBottom: 12, textAlign: "left" }}>{players.map(p => <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 13 }}><span>{p.name}{p.id === HID ? " ★" : ""}</span><span style={{ color: p.faction === "guardian" ? "#60A5FA" : "#F87171" }}>{p.faction === "guardian" ? "수호자" : "공허"} {p.alive ? "✓" : "💀"}</span></div>)}</div>
            <button onClick={() => { setPhase("setup"); setPlayers([]); setLog([]); setSecrets([]); setGameHistory([]); setConvLog(""); }} style={{ ...S.btn("#3B82F6"), textAlign: "center" }}>새 게임</button>
          </div>
        </div>}
      </div>
    </div>
  );
}
