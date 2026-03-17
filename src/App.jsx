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
// BotBrain — 전략 학습 시스템 (localStorage 기반)
// ═══════════════════════════════════════════
const BRAIN_KEY = "rift_bot_brain_v1";
const BotBrain = {
  _default: {
    // 수호자 전략 가중치
    g_info: 0.45, g_shield: 0.13, g_disrupt: 0.12, g_chain: 0.10, g_blade: 0.12, g_blade_confirmed: 0.50,
    // 공허 전략 가중치
    v_blade: 0.28, v_fog: 0.14, v_touch: 0.14, v_disrupt: 0.12, v_chain: 0.10, v_blade_finish: 0.90,
    // 토론 전략 (공허 거짓말 확률)
    v_fake_info: 0.60, v_frame: 0.40, v_cover: 0.70,
    // 투표 전략
    vote_susp_weight: 0.70, vote_info_weight: 0.30,
    // 게임 통계
    games: 0, g_wins: 0, v_wins: 0,
  },
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(BRAIN_KEY));
      return d ? { ...this._default, ...d } : { ...this._default };
    } catch { return { ...this._default }; }
  },
  save(w) { try { localStorage.setItem(BRAIN_KEY, JSON.stringify(w)); } catch {} },
  // 게임 결과로 가중치 조정
  learn(winner, botChoices) {
    const w = this.load();
    w.games++;
    if (winner === "guardian") w.g_wins++; else w.v_wins++;

    const lr = 0.02; // 학습률
    // 승리한 진영의 전략 가중치를 강화, 패배한 진영 약화
    if (winner === "guardian") {
      // 수호자가 많이 쓴 전략 강화
      const gChoices = botChoices.filter(c => c.faction === "guardian");
      const infoRate = gChoices.filter(c => c.cat === "info").length / Math.max(gChoices.length, 1);
      w.g_info = Math.min(0.70, w.g_info + lr * (infoRate - 0.5));
      w.g_blade = Math.max(0.05, w.g_blade - lr * 0.5);
      // 공허 전략 약화 (다음 판에서 공허가 다르게 행동하도록)
      w.v_fog = Math.min(0.30, w.v_fog + lr);
      w.v_fake_info = Math.min(0.85, w.v_fake_info + lr);
    } else {
      // 공허가 많이 쓴 전략 강화
      w.v_blade = Math.min(0.45, w.v_blade + lr * 0.3);
      w.v_touch = Math.min(0.30, w.v_touch + lr * 0.3);
      w.g_info = Math.max(0.25, w.g_info - lr * 0.3);
    }

    // 가중치 정규화 (합이 1에 가깝도록)
    const gSum = w.g_info + w.g_shield + w.g_disrupt + w.g_chain + w.g_blade;
    if (gSum > 0) { w.g_info /= gSum; w.g_shield /= gSum; w.g_disrupt /= gSum; w.g_chain /= gSum; w.g_blade /= gSum; }
    const vSum = w.v_blade + w.v_fog + w.v_touch + w.v_disrupt + w.v_chain;
    if (vSum > 0) { w.v_blade /= vSum; w.v_fog /= vSum; w.v_touch /= vSum; w.v_disrupt /= vSum; w.v_chain /= vSum; }

    this.save(w);
    return w;
  },
  reset() { localStorage.removeItem(BRAIN_KEY); }
};

// ═══════════════════════════════════════════
// 로컬 토론 시스템 (무료 모드) — v2
// ═══════════════════════════════════════════

// 카드 사용 내역을 자연어로 변환
function _describeMyAction(myChoice, players) {
  if (!myChoice) return null;
  const card = CARDS.find(c => c.id === myChoice.cid);
  if (!card) return null;
  const tgtNames = myChoice.tgt?.map(t => pn(players, t)).join(", ") || "";
  switch (myChoice.cid) {
    case "prophecy_shard": return `나는 예지의 파편으로 ${tgtNames}을 조사했다.`;
    case "sentinel_eye": return `나는 파수꾼의 눈으로 ${tgtNames}을 조사했다.`;
    case "tracker_eye": return `나는 추적자의 눈으로 ${tgtNames}을 조사했다.`;
    case "shadow_eye": return `나는 미행의 눈으로 ${tgtNames}을 추적했다.`;
    case "vigilant_eye": return `나는 경계의 눈으로 ${tgtNames}을 감시했다.`;
    case "dead_memory": return `나는 망자의 기억을 사용했다.`;
    case "abyssal_blade": return null; // 킬은 숨김
    case "ward_shield": return `나는 결계의 방패로 ${tgtNames}을 보호했다.`;
    case "fog_veil": return null; // 안개도 숨김
    case "disruption": return `나는 교란의 속삭임을 사용했다.`;
    case "specter_chain": return `나는 망령의 사슬을 사용했다.`;
    case "abyssal_touch": return null; // 손길도 숨김
    default: return null;
  }
}

// 정보 결과를 자연어로 변환
function _describeSecret(s, players) {
  if (!s || s.result === "unknown" || s.result === "disrupted" || s.result === "stolen") return null;
  switch (s.card) {
    case "prophecy_shard": {
      const names = (s.targets || []).map(t => pn(players, t)).join(", ");
      return s.result === "void_present"
        ? `예지의 파편 결과: ${names} 중에 공허가 있다.`
        : `예지의 파편 결과: ${names} 중에는 공허가 없었다.`;
    }
    case "sentinel_eye": {
      const names = (s.targets || []).map(t => pn(players, t)).join(", ");
      return s.result === "same"
        ? `파수꾼의 눈 결과: ${names}은 같은 진영이다.`
        : `파수꾼의 눈 결과: ${names}은 다른 진영이다.`;
    }
    case "tracker_eye":
      return `추적자의 눈으로 ${pn(players, s.target)}을 봤더니 ${cn(s.result)}을 썼다.`;
    case "shadow_eye":
      return typeof s.result === "number"
        ? `미행의 눈으로 보니 ${pn(players, s.target)}이 ${pn(players, s.result)}을 지목했다.`
        : `미행의 눈으로 보니 ${pn(players, s.target)}은 아무도 지목하지 않았다.`;
    case "vigilant_eye":
      return s.result === "targeted"
        ? `경계의 눈으로 보니 ${pn(players, s.target)}이 누군가에게 지목당했다.`
        : `경계의 눈으로 보니 ${pn(players, s.target)}은 아무에게도 지목당하지 않았다.`;
    case "dead_memory":
      return s.result !== "no_death"
        ? `망자의 기억: ${pn(players, s.target)}의 마지막 행동은 ${cn(s.result)}이었다.`
        : null;
    default: return null;
  }
}

// 봇이 보유한 정보로 발언 생성 — 반드시 무언가 말하도록
function localBotSpeak(bot, players, allChoices, round, publicLog, conversationSoFar) {
  const p = bot.p;
  const myChoice = allChoices.find(c => c.pid === p.id);
  const oth = players.filter(x => x.alive && x.id !== p.id);
  if (!oth.length) return null;

  const brain = BotBrain.load();

  if (p.faction === "guardian") {
    return _guardianSpeak(bot, players, myChoice, round, publicLog, conversationSoFar);
  } else {
    return _voidSpeak(bot, players, myChoice, round, publicLog, conversationSoFar, brain);
  }
}

function _guardianSpeak(bot, players, myChoice, round, publicLog, convSoFar) {
  const parts = []; // 여러 문장을 조합

  // 1. 이번 라운드 자기 행동 설명 (전투카드 아닌 경우)
  const actionDesc = _describeMyAction(myChoice, players);
  if (actionDesc) parts.push(actionDesc);

  // 2. 이번 라운드 새 정보 공유 (가장 중요!)
  const newSecrets = bot.secrets.filter(s => s.round === round && s.result !== "unknown" && s.result !== "disrupted" && s.result !== "stolen");
  newSecrets.forEach(s => {
    const desc = _describeSecret(s, players);
    if (desc) parts.push(desc);
  });

  // 3. 교란당했으면 공유
  const disrupted = bot.secrets.filter(s => s.round === round && s.result === "disrupted");
  if (disrupted.length) parts.push("이번에 교란당해서 결과를 못 받았다. 누가 교란했는지 모르겠다.");

  // 4. 확정 공허 강력 지목
  const confirmed = players.filter(p => p.alive && p.id !== bot.p.id && bot.kf[p.id] === "void");
  if (confirmed.length > 0) {
    parts.push(`${confirmed[0].name}은 공허가 확실하다. 이번에 반드시 추방해야 한다.`);
  }

  // 5. 의심 표현 (조사 결과 기반)
  const suspects = players.filter(p => p.alive && p.id !== bot.p.id && bot.gs(p.id) > 0.15)
    .sort((a, b) => bot.gs(b.id) - bot.gs(a.id));
  if (suspects.length > 0 && !confirmed.length) {
    const s = suspects[0];
    const suspLevel = bot.gs(s.id);
    if (suspLevel > 0.5) {
      parts.push(`${s.name}이 상당히 의심스럽다. 투표 때 고려하자.`);
    } else if (suspLevel > 0.2) {
      const reasons = [
        `${s.name}이 좀 수상하다. 행동 패턴이 공허 같다.`,
        `${s.name}의 발언을 주의 깊게 봐야 할 것 같다.`,
        `${s.name}에 대해 추가 조사가 필요하다.`,
      ];
      parts.push(pick(reasons));
    }
  }

  // 6. 이전 대화에서 모순 지적
  if (convSoFar) {
    const knownCards = {};
    bot.secrets.filter(s => s.card === "tracker_eye" && typeof s.result === "string").forEach(s => {
      knownCards[s.target] = s.result;
    });
    for (const [tid, realCard] of Object.entries(knownCards)) {
      const tName = pn(players, +tid);
      const realCardObj = CARDS.find(c => c.id === realCard);
      // 누가 정보 카드를 썼다고 주장하는데 실제로는 전투카드를 쓴 경우
      if (realCardObj?.cat === "combat") {
        const claimedInfo = convSoFar.match(new RegExp(`${tName}.*?(예지|파수꾼|추적자|미행|경계|망자)`));
        if (claimedInfo) {
          parts.push(`잠깐, ${tName}이 정보 카드를 썼다고 했는데 내 추적자의 눈으로 확인하니 ${cn(realCard)}을 썼다. 거짓말을 하고 있다!`);
          break;
        }
      }
    }
  }

  // 7. 확정 수호자 신뢰 표현
  const confirmedGuard = players.filter(p => p.alive && p.id !== bot.p.id && bot.kf[p.id] === "guardian");
  if (confirmedGuard.length > 0 && Math.random() < 0.3) {
    parts.push(`${confirmedGuard[0].name}은 수호자인 것 같다. 협력하자.`);
  }

  // 8. 아무 정보도 없으면 상황 판단 발언
  if (parts.length === 0) {
    const oth = players.filter(p => p.alive && p.id !== bot.p.id);
    const fillers = [
      "이번 라운드에는 특별한 정보를 못 얻었다. 다른 사람들 발언을 듣겠다.",
      `아직 확실한 단서가 없다. ${pick(oth).name}은 어떤 카드를 썼나?`,
      "조용한 사람이 더 의심스럽다. 정보가 있으면 공유해 달라.",
      "아직 공허를 특정하기 어렵다. 조사 결과를 더 모아야 한다.",
    ];
    parts.push(pick(fillers));
  }

  // 최대 2문장까지 조합
  return parts.slice(0, 2).join(" ");
}

function _voidSpeak(bot, players, myChoice, round, publicLog, convSoFar, brain) {
  const oth = players.filter(p => p.alive && p.id !== bot.p.id);
  const nonTeam = oth.filter(p => !bot.vt.includes(p.id));
  const team = oth.filter(p => bot.vt.includes(p.id) && p.alive);
  if (!nonTeam.length) return null;

  const parts = [];

  // 공허는 자기가 뭘 했는지 거짓으로 포장해야 함
  // 실제 행동을 숨기고 가짜 행동을 주장

  // 전략 1: 가짜 카드 사용 주장 + 가짜 결과 (핵심!)
  const realCid = myChoice?.cid;
  const usedCombat = realCid && CARDS.find(c => c.id === realCid)?.cat === "combat";

  if (usedCombat || Math.random() < brain.v_fake_info) {
    // 전투카드 썼으면 반드시 가짜 정보 주장
    const fakeCards = ["prophecy_shard", "sentinel_eye", "tracker_eye", "vigilant_eye"];
    const fc = pick(fakeCards);

    if (fc === "prophecy_shard" && nonTeam.length >= 2) {
      const targets = sample(nonTeam, 2);
      // 수호자를 안전하게 보이게 or 수호자를 의심스럽게
      if (Math.random() < 0.6) {
        // 팀원을 포함해서 "공허 없다" → 팀원 세탁
        if (team.length) {
          parts.push(`나는 예지의 파편으로 ${team[0].name}, ${targets[0].name}을 조사했다. 공허가 없었다.`);
        } else {
          parts.push(`나는 예지의 파편으로 ${targets.map(t => t.name).join(", ")}을 조사했다. 공허가 없었다.`);
        }
      } else {
        parts.push(`나는 예지의 파편으로 ${targets.map(t => t.name).join(", ")}을 조사했다. 공허가 있다!`);
      }
    } else if (fc === "sentinel_eye" && nonTeam.length >= 1) {
      if (team.length && Math.random() < 0.5) {
        // 팀원과 확정 수호자가 "같은 진영" → 팀원 세탁
        const confirmedG = nonTeam.find(p => bot.kf[p.id] === "guardian");
        if (confirmedG) {
          parts.push(`나는 파수꾼의 눈으로 ${team[0].name}, ${confirmedG.name}을 봤다. 같은 진영이다.`);
        } else {
          parts.push(`나는 파수꾼의 눈으로 ${pick(nonTeam).name}, ${team[0].name}을 봤다. 같은 진영이었다.`);
        }
      } else {
        const targets = sample(nonTeam, Math.min(2, nonTeam.length));
        parts.push(`나는 파수꾼의 눈으로 ${targets.map(t => t.name).join(", ")}을 봤다. 다른 진영이다.`);
      }
    } else if (fc === "tracker_eye") {
      const target = pick(nonTeam);
      const fakeSeen = pick(["abyssal_blade", "fog_veil", "disruption", "abyssal_touch"]);
      if (Math.random() < 0.5) {
        // 수호자를 공허처럼 보이게
        parts.push(`나는 추적자의 눈으로 ${target.name}을 봤더니 ${cn(fakeSeen)}을 썼다. 수상하다.`);
      } else {
        const infoCard = pick(["prophecy_shard", "sentinel_eye", "vigilant_eye"]);
        parts.push(`나는 추적자의 눈으로 ${target.name}을 봤더니 ${cn(infoCard)}을 썼다.`);
      }
    } else {
      const target = pick(nonTeam);
      parts.push(`나는 경계의 눈으로 ${target.name}을 봤더니 누군가에게 지목당했다.`);
    }
  } else {
    // 정보 카드 실제로 쓴 경우 → 선별적으로 진짜 결과 공유 (유리할 때만)
    const newSecrets = bot.secrets.filter(s => s.round === round && s.result !== "unknown" && s.result !== "disrupted" && s.result !== "stolen");
    const useful = newSecrets.find(s => {
      // 수호자를 공허로 보이게 하는 결과만 공유
      if (s.card === "prophecy_shard" && s.result === "void_present") return true;
      if (s.card === "sentinel_eye" && s.result === "different") return true;
      return false;
    });
    if (useful) {
      const desc = _describeSecret(useful, players);
      if (desc) parts.push("나는 " + desc.charAt(0).toLowerCase() + desc.slice(1));
    } else {
      // 가짜 행동 주장
      const actionDesc = `나는 ${pick(["예지의 파편", "파수꾼의 눈", "추적자의 눈"])}을 사용했다.`;
      parts.push(actionDesc);
    }
  }

  // 전략 2: 수호자 프레이밍 (대화 맥락 반영)
  if (Math.random() < brain.v_frame) {
    const target = pick(nonTeam);
    const frameLines = [
      `${target.name}이 계속 정보를 안 공유한다. 뭔가 숨기는 게 있는 것 같다.`,
      `${target.name}의 발언이 앞뒤가 안 맞는다. 공허 아닌가?`,
      `${target.name}을 주목해야 한다. 행동 패턴이 이상하다.`,
      `솔직히 ${target.name}이 제일 의심된다. 투표 때 잘 생각하자.`,
    ];
    parts.push(pick(frameLines));
  }

  // 전략 3: 팀원 엄호 (팀원이 대화에서 의심받는 경우)
  if (team.length > 0 && convSoFar) {
    const suspTeam = team.find(t => convSoFar.includes(t.name) && (convSoFar.includes("의심") || convSoFar.includes("수상") || convSoFar.includes("공허")));
    if (suspTeam && Math.random() < brain.v_cover) {
      const covers = [
        `${suspTeam.name}은 수호자다. 내 조사 결과로 확인했다.`,
        `${suspTeam.name}을 의심하는 건 잘못된 판단이다. 다른 곳을 봐야 한다.`,
        `${suspTeam.name}은 내가 보증한다. 다른 사람을 의심하자.`,
      ];
      parts.push(pick(covers));
    }
  }

  // 최소 1문장 보장
  if (parts.length === 0) {
    const target = pick(nonTeam);
    const fillers = [
      `${target.name}이 조용한데 의심스럽다. 뭔가 말해봐라.`,
      "이번 라운드에 정보를 좀 모았다. 의심가는 사람이 있다.",
      `아직 확신은 없지만 ${target.name} 쪽을 더 조사해봐야 할 것 같다.`,
    ];
    parts.push(pick(fillers));
  }

  // 최대 2문장
  return parts.slice(0, 2).join(" ");
}

// 로컬 반응 생성 — 더 다양하고 맥락에 맞게
function localBotReact(bot, players, playerMsg, allChoices, round, convSoFar) {
  const p = bot.p;
  const oth = players.filter(x => x.alive && x.id !== p.id);

  // 자기가 언급된 경우 높은 확률로 반응
  const mentioned = playerMsg.includes(p.name);
  if (!mentioned && Math.random() > 0.25) return null;

  if (mentioned) {
    const isAccused = playerMsg.includes("의심") || playerMsg.includes("수상") || playerMsg.includes("공허");
    const isTrusted = playerMsg.includes("신뢰") || playerMsg.includes("믿");

    if (isAccused) {
      if (p.faction === "guardian") {
        // 수호자: 구체적 증거로 방어
        const mySecrets = bot.secrets.filter(s => s.result !== "unknown" && s.result !== "disrupted" && s.result !== "stolen");
        if (mySecrets.length > 0) {
          const s = mySecrets[mySecrets.length - 1];
          const desc = _describeSecret(s, players);
          if (desc) return `나를 의심하지 마라. ${desc} 이게 내 증거다.`;
        }
        return pick([
          "나는 수호자다. 조사 결과로 증명할 수 있다.",
          "근거 없이 의심하는 건 공허의 전략에 놀아나는 거다.",
          "내 행동을 보면 수호자인 걸 알 수 있다. 정보를 공유하고 있지 않나.",
        ]);
      } else {
        // 공허: 적극 반박 + 역공
        const nonTeam = oth.filter(x => !bot.vt.includes(x.id));
        const redirect = nonTeam.length ? pick(nonTeam).name : "다른 사람";
        return pick([
          `나를 의심하기보다 ${redirect}을 잘 봐라. 그쪽이 더 수상하다.`,
          `근거도 없이 나를 모는 건 공허의 전략이다. 오히려 의심을 돌리려는 거 아닌가?`,
          `나는 정보 카드를 써서 팀에 기여하고 있다. ${redirect}은 뭘 했나?`,
          `나를 의심하면 수호자만 손해다. 진짜 공허를 찾아야 한다.`,
        ]);
      }
    }

    if (isTrusted) {
      return p.faction === "guardian"
        ? pick(["고맙다. 같이 공허를 잡자.", "나도 당신을 믿는다. 협력하자."])
        : pick(["고맙다. 같이 공허를 찾자.", "믿어줘서 고맙다. 의심스러운 사람이 있으면 말해달라."]);
    }
  }

  // 미언급이어도 맥락상 반응할 수 있는 경우
  if (!mentioned) {
    // 누군가를 의심하는 발언에 동조/반박
    const accusedName = oth.find(o => playerMsg.includes(o.name));
    if (accusedName && (playerMsg.includes("의심") || playerMsg.includes("수상"))) {
      if (p.faction === "void" && bot.vt.includes(accusedName.id)) {
        // 팀원이 의심당하면 엄호
        return pick([
          `${accusedName.name}은 아닌 것 같다. 다른 쪽을 보자.`,
          `${accusedName.name}을 의심하는 건 성급하다.`,
        ]);
      }
      if (p.faction === "guardian" && bot.kf[accusedName.id] === "void") {
        // 확정 공허면 동조
        return `동의한다. ${accusedName.name}이 공허일 가능성이 높다.`;
      }
      if (p.faction === "void" && !bot.vt.includes(accusedName.id) && Math.random() < 0.4) {
        // 수호자를 의심하는 발언에 동조 (수호자 제거 유도)
        return `나도 ${accusedName.name}이 의심된다.`;
      }
    }
  }

  return null;
}

// 로컬 투표 (토론 반영 강화)
function localBotVote(bot, players, convLog) {
  if (convLog) {
    const al = players.filter(p => p.alive && p.id !== bot.p.id);
    al.forEach(p => {
      // 토론에서 의심받은 횟수 → 의심도 가산
      const suspMentions = (convLog.match(new RegExp(p.name + ".*(의심|수상|공허|거짓)", "g")) || []).length;
      if (suspMentions > 0) bot.as(p.id, suspMentions * 0.12);
      // 신뢰받은 횟수 → 의심도 감산
      const trustMentions = (convLog.match(new RegExp(p.name + ".*(신뢰|믿|수호자|보증)", "g")) || []).length;
      if (trustMentions > 0) bot.as(p.id, -trustMentions * 0.08);
    });
  }
  return bot.vote(players);
}

// 로컬 모드용 래퍼 함수들
function generateLocalDiscussion(players, bots, allChoices, round, gameHistory, publicLog) {
  const aliveBots = players.filter(p => p.alive && p.id !== 0).map(p => bots[p.id]).filter(Boolean);
  const results = [];
  let conv = "";

  for (const bot of aliveBots) {
    const msg = localBotSpeak(bot, players, allChoices, round, publicLog, conv);
    if (msg && msg.length > 2) {
      results.push({ id: bot.p.id, msg });
      conv += `${bot.p.name}: "${msg}"\n`;
    }
  }
  return results;
}

function generateLocalReactions(players, bots, playerMsg, allChoices, round, convSoFar) {
  const aliveBots = Object.values(bots).filter(b => b.p.alive);
  const results = [];
  for (const bot of aliveBots) {
    const msg = localBotReact(bot, players, playerMsg, allChoices, round, convSoFar);
    if (msg) results.push({ id: bot.p.id, msg });
  }
  return results;
}

function generateLocalBotVotes(players, bots, allChoices, round, convLog) {
  const aliveBots = players.filter(p => p.alive && p.id !== 0).map(p => bots[p.id]).filter(Boolean);
  const tally = {};
  for (const bot of aliveBots) {
    const v = localBotVote(bot, players, convLog);
    tally[v] = (tally[v] || 0) + 1;
  }
  return tally;
}

// ═══════════════════════════════════════════
// Bot (행동/투표용)
// ═══════════════════════════════════════════
class Bot {
  constructor(p) { this.p = p; this.kf = {}; this.susp = {}; this.vt = []; this.sk = 0.7; this.secrets = []; this.myChoices = []; this.claimedCards = {}; this.otherClaims = []; }
  initV(ids) { this.vt = ids; ids.forEach(v => { if (v !== this.p.id) this.kf[v] = "void"; }); }
  gs(id) { return this.susp[id] || 0; }
  as(id, v) { this.susp[id] = Math.max(-1, Math.min(2, (this.susp[id] || 0) + v)); }
  recE(pid, f) { this.kf[pid] = f; }

  // ── 상황 분석 유틸 ──
  _ctx(ps) {
    const al = ps.filter(p => p.alive), oth = al.filter(p => p.id !== this.p.id);
    const nv = al.filter(p => p.faction === "void").length, ng = al.filter(p => p.faction === "guardian").length;
    const confirmed_void = oth.filter(p => this.kf[p.id] === "void");
    const confirmed_guard = oth.filter(p => this.kf[p.id] === "guardian");
    const unknown = oth.filter(p => this.kf[p.id] === undefined);
    const suspects = [...oth].sort((a, b) => this.gs(b.id) - this.gs(a.id));
    const topSusp = suspects.filter(p => this.gs(p.id) > 0.15);
    const infoHeavy = [...oth].sort((a, b) => (b.actionHistory?.filter(h => h.cat === "info").length || 0) - (a.actionHistory?.filter(h => h.cat === "info").length || 0));
    return { al, oth, nv, ng, confirmed_void, confirmed_guard, unknown, suspects, topSusp, infoHeavy };
  }

  // ── 투표 (토론 + 추론 기반) ──
  vote(ps) {
    const { oth, confirmed_void, topSusp, infoHeavy } = this._ctx(ps);
    if (!oth.length) return this.p.id;

    if (this.p.faction === "guardian") {
      // 1순위: 확정 공허
      if (confirmed_void.length) return pick(confirmed_void).id;

      // 2순위: 의심도 높은 사람 (가중 랜덤 — 더 집중적)
      if (topSusp.length) {
        // 의심도 제곱으로 가중 → 높은 의심자에게 표 집중
        const weights = topSusp.map(p => Math.pow(this.gs(p.id), 1.5));
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (let i = 0; i < topSusp.length; i++) { r -= weights[i]; if (r <= 0) return topSusp[i].id; }
        return topSusp[0].id;
      }

      // 3순위: 전투 카드 비중 높은 사람 (정보 안 쓰는 사람이 공허일 확률 높음)
      const combatHeavy = oth.filter(p => {
        const hist = p.actionHistory || [];
        if (hist.length === 0) return false;
        return hist.filter(h => h.cat === "combat").length > hist.filter(h => h.cat === "info").length;
      });
      if (combatHeavy.length) return pick(combatHeavy).id;

      // 4순위: 모르는 사람 중 랜덤
      const unk = oth.filter(p => this.kf[p.id] === undefined);
      return pick(unk.length ? unk : oth).id;
    }

    // 공허: 팀원 절대 보호 + 전략적 추방
    const nonTeam = oth.filter(p => !this.vt.includes(p.id));
    if (!nonTeam.length) return pick(oth).id;

    // 1순위: 정보 많이 모은 수호자 (가장 위험)
    const dangerous = nonTeam.filter(p => (p.actionHistory?.filter(h => h.cat === "info").length || 0) >= 2);
    if (dangerous.length) return pick(dangerous).id;

    // 2순위: 나/팀원 의심하는 사람 (susp가 마이너스 = 나를 수호자로 보는 사람 → 살려둠)
    const threatToMe = nonTeam.filter(p => this.gs(p.id) < -0.1); // 나를 의심하는 = 나에 대해 정보 있는
    if (threatToMe.length && Math.random() < 0.4) return pick(threatToMe).id;

    return pick(nonTeam).id;
  }

  // ── 카드 선택 (전략적) ──
  act(ps, taken, round) {
    this._round = round;
    const ctx = this._ctx(ps);
    if (!ctx.oth.length) return { c: "fog_veil", t: [this.p.id] };
    let av = CARDS.filter(c => !taken.has(c.id));
    if (this.p.chained) av = av.filter(c => c.cat === "info");
    if (round === 1) av = av.filter(c => !["abyssal_blade", "dead_memory", "ward_shield", "specter_chain"].includes(c.id));
    if (!av.length) av = CARDS.filter(c => !taken.has(c.id));
    if (!av.length) av = [...CARDS];
    return this.p.faction === "guardian" ? this._ga(ctx, av, round) : this._va(ctx, av, round);
  }

  // ── 수호자 전략 ──
  _ga(ctx, av, round) {
    const { oth, al, confirmed_void, unknown, topSusp } = ctx;

    // 확정 공허가 있고 칼날 가능 → 높은 확률로 제거
    if (confirmed_void.length && av.find(c => c.id === "abyssal_blade")) {
      if (Math.random() < 0.75) return { c: "abyssal_blade", t: [pick(confirmed_void).id] };
    }

    // 라운드별 전략 분기
    if (round <= 2) {
      // 초반: 정보 수집 우선 (80%)
      if (Math.random() < 0.80) return this._smartInfo(ctx, av, round);
      // 방패로 의심자 보호 (정보원 보호)
      if (av.find(c => c.id === "ward_shield")) return { c: "ward_shield", t: [pick(al).id] };
      return this._smartInfo(ctx, av, round);
    }

    // 중반 이후: 정보/전투 밸런스
    const infoRatio = unknown.length / Math.max(oth.length, 1);

    // 아직 모르는 사람이 많으면 정보 우선
    if (infoRatio > 0.6 && Math.random() < 0.60) return this._smartInfo(ctx, av, round);

    // 의심자가 있으면 전투 고려
    if (topSusp.length > 0) {
      const target = topSusp[0];
      const r = Math.random();
      if (r < 0.30 && av.find(c => c.id === "abyssal_blade")) return { c: "abyssal_blade", t: [target.id] };
      if (r < 0.45 && av.find(c => c.id === "disruption")) return { c: "disruption", t: [target.id] };
      if (r < 0.55 && av.find(c => c.id === "specter_chain")) return { c: "specter_chain", t: [target.id] };
    }

    // 방패: 자기가 정보 많이 가지고 있으면 자기 보호
    if (av.find(c => c.id === "ward_shield") && this.secrets.length >= 3 && Math.random() < 0.25) {
      return { c: "ward_shield", t: [this.p.id] };
    }

    // 기본: 정보 수집
    return this._smartInfo(ctx, av, round);
  }

  // ── 공허 전략 (Opus 분석 기반 v2) ──
  _va(ctx, av, round) {
    const { oth, al, nv, ng, infoHeavy } = ctx;
    const nonTeam = oth.filter(p => !this.vt.includes(p.id));
    const guards = nonTeam.length ? nonTeam : oth;

    // 정보통 수호자 식별 (2회 이상 정보 카드 사용)
    const infoHunters = guards.filter(p => (p.actionHistory?.filter(h => h.cat === "info").length || 0) >= 2);
    // 가장 위험한 수호자 (정보 + 나/팀원 의심)
    const priorityTarget = infoHunters.length ? infoHunters[0] : (guards.length ? guards[0] : null);

    // ★ 마무리 조건: 공허 수 >= 수호자 수 - 1 → 적극 킬
    if (nv >= ng - 1 && av.find(c => c.id === "abyssal_blade") && guards.length) {
      return { c: "abyssal_blade", t: [priorityTarget?.id || pick(guards).id] };
    }

    // 라운드별 전략
    if (round === 1) {
      // R1: 정보 차단이 핵심 — 교란/안개/손길 비중 대폭 UP
      const r = Math.random();
      if (r < 0.30 && av.find(c => c.id === "disruption") && guards.length) {
        // 정보 수집하려는 수호자 방해 (최우선)
        return { c: "disruption", t: [pick(guards).id] };
      }
      if (r < 0.50 && av.find(c => c.id === "abyssal_touch") && guards.length) {
        return { c: "abyssal_touch", t: [pick(guards).id] };
      }
      if (r < 0.65 && av.find(c => c.id === "fog_veil")) {
        return { c: "fog_veil", t: [this.p.id] };
      }
      // 나머지: 위장용 정보 수집
      return this._smartInfo(ctx, av, round);
    }

    // R2 이후: 상황에 따라 킬/차단/위장 분기
    // 의심받는 정도 파악
    const amSuspected = oth.some(p => this.p.actionHistory?.filter(h => h.cat === "combat").length >= 2);

    const r = Math.random();

    // 킬: 정보통 수호자 우선 (30%)
    if (r < 0.30 && av.find(c => c.id === "abyssal_blade") && guards.length) {
      const target = priorityTarget || pick(guards);
      return { c: "abyssal_blade", t: [target.id] };
    }

    // 정보 차단 (교란+손길): 수호자 정보 수집 방해 (25%)
    if (r < 0.55) {
      if (av.find(c => c.id === "abyssal_touch") && guards.length && Math.random() < 0.5) {
        const target = infoHeavy.find(p => !this.vt.includes(p.id)) || guards[0];
        return { c: "abyssal_touch", t: [target.id] };
      }
      if (av.find(c => c.id === "disruption") && guards.length) {
        const target = infoHeavy.find(p => !this.vt.includes(p.id)) || guards[0];
        return { c: "disruption", t: [target.id] };
      }
    }

    // 안개: 의심받을수록 확률 UP
    if (r < 0.65 && av.find(c => c.id === "fog_veil")) {
      if (amSuspected || round >= 3) return { c: "fog_veil", t: [this.p.id] };
    }

    // 사슬: 킬 가능성 있는 수호자 봉쇄
    if (r < 0.75 && av.find(c => c.id === "specter_chain") && guards.length) {
      // 전투카드 많이 쓴 수호자 사슬
      const combatUsers = guards.filter(p => (p.actionHistory?.filter(h => h.cat === "combat").length || 0) >= 1);
      const target = combatUsers.length ? pick(combatUsers) : pick(guards);
      return { c: "specter_chain", t: [target.id] };
    }

    // 방패: 팀원 보호 (팀원이 의심받는 경우)
    if (av.find(c => c.id === "ward_shield")) {
      const suspTeam = al.filter(p => this.vt.includes(p.id) && p.alive && p.id !== this.p.id);
      if (suspTeam.length && Math.random() < 0.35) return { c: "ward_shield", t: [pick(suspTeam).id] };
    }

    // 기본: 정보 수집 (위장 — 수호자처럼 보이기)
    return this._smartInfo(ctx, av, round);
  }

  // ── 스마트 정보 수집 (타겟 최적화) ──
  _smartInfo(ctx, av, round) {
    const { oth, unknown } = ctx;
    const pool = unknown.length ? unknown : oth;
    let ia = av.filter(c => c.cat === "info");
    if (round === 1) ia = ia.filter(c => c.id !== "dead_memory");
    if (!ia.length) { const a = av[0]; return { c: a.id, t: a.target === "self" ? [this.p.id] : a.target === "none" ? [] : [pick(pool).id] }; }

    // 우선순위: 모르는 사람에 대한 정보 수집
    // 예지의 파편: 의심자 2명 묶어서 확인
    if (ia.find(c => c.id === "prophecy_shard") && pool.length >= 2) {
      // 의심도 높은 사람 포함
      const sorted = [...pool].sort((a, b) => this.gs(b.id) - this.gs(a.id));
      const targets = sorted.slice(0, 2);
      if (Math.random() < 0.35) return { c: "prophecy_shard", t: targets.map(p => p.id) };
    }

    // 파수꾼의 눈: 확정 수호자 + 모르는 사람 → 같으면 수호자 확정
    if (ia.find(c => c.id === "sentinel_eye") && pool.length >= 2) {
      const confirmed_g = oth.filter(p => this.kf[p.id] === "guardian" && p.alive);
      if (confirmed_g.length && unknown.length) {
        // 확정 수호자 + 모르는 사람 → 전략적 조합
        if (Math.random() < 0.40) return { c: "sentinel_eye", t: [confirmed_g[0].id, pick(unknown).id] };
      }
      if (Math.random() < 0.30) return { c: "sentinel_eye", t: sample(pool, 2).map(p => p.id) };
    }

    // 추적자의 눈: 의심자의 행동 확인
    if (ia.find(c => c.id === "tracker_eye")) {
      const target = ctx.topSusp.length ? ctx.topSusp[0] : pick(pool);
      if (Math.random() < 0.25) return { c: "tracker_eye", t: [target.id] };
    }

    // 망자의 기억: 죽은 사람이 있을 때만
    if (ia.find(c => c.id === "dead_memory") && round >= 2) {
      if (Math.random() < 0.15) return { c: "dead_memory", t: [] };
    }

    // 미행의 눈: 의심자가 누구를 노리는지
    if (ia.find(c => c.id === "shadow_eye") && ctx.topSusp.length) {
      if (Math.random() < 0.20) return { c: "shadow_eye", t: [ctx.topSusp[0].id] };
    }

    // 경계의 눈
    if (ia.find(c => c.id === "vigilant_eye")) {
      if (Math.random() < 0.20) return { c: "vigilant_eye", t: [pick(pool).id] };
    }

    // 폴백: 랜덤 정보 카드
    const card = pick(ia);
    return { c: card.id, t: card.target === "two" && pool.length >= 2 ? sample(pool, 2).map(p => p.id) : card.target === "none" ? [] : card.target === "self" ? [this.p.id] : [pick(pool).id] };
  }

  _ms(o) { const s = [...o].sort((a, b) => this.gs(b.id) - this.gs(a.id)); return s.length && this.gs(s[0].id) > 0 ? s[0] : pick(o); }

  // ── 정보 학습 (기존 + 강화) ──
  learn(infos) {
    (infos || []).forEach(i => {
      this.secrets.push(i);
      if (i.result === "unknown" || i.result === "stolen" || i.result === "disrupted") return;

      if (i.card === "prophecy_shard") {
        if (i.result === "void_absent") {
          (i.targets || []).forEach(t => { this.kf[t] = "guardian"; this.as(t, -0.4); });
        } else if (i.result === "void_present") {
          // 2명 중 공허가 있다 → 이미 한 명이 수호자 확정이면 나머지가 공허
          const targets = i.targets || [];
          const knownGuard = targets.find(t => this.kf[t] === "guardian");
          if (knownGuard !== undefined) {
            const other = targets.find(t => t !== knownGuard);
            if (other !== undefined) { this.kf[other] = "void"; this.as(other, 0.6); }
          } else {
            targets.forEach(t => this.as(t, 0.25));
          }
        }
      }
      else if (i.card === "sentinel_eye" && i.targets?.length === 2) {
        if (i.result === "different") {
          i.targets.forEach(t => this.as(t, 0.15));
          // 한 명이 확정 수호자면 나머지는 공허
          const knownG = i.targets.find(t => this.kf[t] === "guardian");
          if (knownG !== undefined) { const other = i.targets.find(t => t !== knownG); if (other !== undefined) { this.kf[other] = "void"; this.as(other, 0.5); } }
          const knownV = i.targets.find(t => this.kf[t] === "void");
          if (knownV !== undefined) { const other = i.targets.find(t => t !== knownV); if (other !== undefined) { this.kf[other] = "guardian"; this.as(other, -0.3); } }
        } else if (i.result === "same") {
          // 한 명 진영 알면 나머지도 동일
          i.targets.forEach(t => { if (this.kf[t] !== undefined) { const other = i.targets.find(x => x !== t); if (other !== undefined) { this.kf[other] = this.kf[t]; this.as(other, this.kf[t] === "void" ? 0.4 : -0.3); } } });
        }
      }
      else if (i.card === "tracker_eye") {
        if (["abyssal_blade", "fog_veil", "abyssal_touch"].includes(i.result)) this.as(i.target, 0.35);
        else if (["specter_chain", "disruption"].includes(i.result)) this.as(i.target, 0.15);
        else if (["prophecy_shard", "sentinel_eye", "tracker_eye", "vigilant_eye"].includes(i.result)) this.as(i.target, -0.1);
      }
      else if (i.card === "shadow_eye" && typeof i.result === "number") {
        // 누구를 지목했는지 → 팀원을 지목 안 하면 정보 없음, 하면 팀일 수도
      }
      else if (i.card === "vigilant_eye") {
        if (i.result === "targeted") this.as(i.target, 0.1); // 지목당함 → 약간 의심
      }
      else if (i.card === "dead_memory" && i.result && i.result !== "no_death") {
        if (["abyssal_blade", "fog_veil", "abyssal_touch"].includes(i.result)) this.as(i.target, 0.3);
      }
    });
  }

  // ── 예측 (전략적) ──
  predict(ps) {
    const myChoice = this.myChoices[this.myChoices.length - 1];
    const oth = ps.filter(p => p.alive && p.id !== this.p.id);
    if (!oth.length) return -1;

    if (this.p.faction === "void" && myChoice?.cid === "abyssal_blade") {
      // 공허가 칼날 쓴 경우: 방패 없으면 거의 확정 예측
      if (Math.random() < 0.35) return myChoice.tgt[0];
      return Math.random() < 0.5 ? -1 : pick(oth).id;
    }

    // 수호자: 의심 높은 사람이 칼날 들었을 가능성 분석
    const ctx = this._ctx(ps);
    if (ctx.topSusp.length > 0 && this._round >= 2) {
      // 의심자가 칼날을 썼을 확률이 높으면 그 타겟을 예측
      const likelySusp = ctx.topSusp[0];
      // 의심자가 정보카드를 거의 안 쓴 사람이면 → 전투카드 쓸 확률 높음
      const combatRate = (likelySusp.actionHistory?.filter(h => h.cat === "combat").length || 0) / Math.max((likelySusp.actionHistory?.length || 1), 1);
      if (combatRate > 0.4 && Math.random() < 0.4) {
        // 의심자가 누구를 노렸을까? → 정보 많은 수호자
        const targets = oth.filter(p => p.id !== likelySusp.id);
        if (targets.length) return pick(targets).id;
      }
    }

    if (Math.random() < 0.35) return -1;
    return pick(oth).id;
  }
}

// ═══════════════════════════════════════════
// Claude API — 프롬프트 전면 재설계
// ═══════════════════════════════════════════
let _currentModel = "claude-sonnet-4-5-20250929";

async function callAPI(system, user) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: _currentModel, max_tokens: 1000, system, messages: [{ role: "user", content: user }] })
    });
    const data = await res.json();
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
- 다른 플레이어의 발언이 이전 라운드 발언과 모순되면 반드시 지적하라 (예: "R1에서 추적자의 눈을 썼다고 했는데 지금은 예지의 파편을 썼다고?").
- 규칙상 불가능한 주장(예: 자기 자신을 예지의 파편 대상에 포함)을 하는 사람이 있으면 반드시 지적하라.
- 의심되는 사람이 있으면 근거를 들어 지목하라.`
    : `[공허 행동 규칙 — 중요!]
너의 목표: 수호자들을 속이고 수호자를 추방시키는 것이다. 팀원(${bot.vt.filter(v => v !== p.id).map(id => pn(players, id)).join(", ")})은 절대 공격하지 마라.

★ 거짓말 전략 — 적극적으로 사용하라:
1. **가짜 조사 결과 주장**: 실제로는 전투 카드를 썼더라도, 정보 카드를 쓴 것처럼 거짓 결과를 만들어 발표하라. 예: 실제로 안개를 썼지만 "예지의 파편으로 PX, PY를 조사했는데 공허가 없었다"고 주장 → 수호자에게 면죄부를 주거나 다른 수호자를 의심하게 만듦.
2. **수호자 프레이밍**: 수호자를 공허로 몰아라. "내 조사 결과 PX가 의심된다"는 식으로 거짓 근거를 만들어라.
3. **팀원 엄호**: 팀원이 의심받으면 거짓 정보로 방어하라. "내 파수꾼의 눈으로 PX(팀원)와 PY를 조사했는데 같은 진영이었다" → PY가 확인된 수호자라면 팀원도 수호자로 보이게 함.
4. **의심 분산**: 한 사람에게 의심이 몰리면 다른 쪽으로 돌리는 발언을 하라.

거짓말 제약 (들통나지 않기 위해):
- 다른 사람이 이미 주장한 카드를 네가 같은 라운드에 썼다고 하면 안 된다 (중복 불가 규칙).
- 규칙상 불가능한 행동을 주장하면 안 된다 (예: 자기 자신을 예지의 파편 대상에 포함).
- 네가 이전 라운드에 한 발언과 모순되면 안 된다 — 위 "네가 매 라운드 사용한 카드 기록"과 "이전 발언"을 확인하고 일관성을 유지하라.
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
3. 초반 라운드에 조사당하는 것은 정상이다. "왜 나를 조사했냐"는 식의 반응을 하지 마라.
4. 교란당해서 결과를 못 받은 경우, 그 사실 자체를 공유해도 된다.
5. 이번 라운드(R${round})의 새 정보를 우선 공유하라. 이전 라운드에서 이미 공유한 내용을 반복하지 마라.`;
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
P1이 방금 위와 같이 발언했다. 너(${bot.p.name})는 이 발언에 반응할 필요가 있나?
- 네가 직접 언급되었거나, 관련 정보가 있거나, 반박할 게 있으면 1문장으로 반응해라.
- 관련 없으면 "패스"라고만 해라.
따옴표나 이름 태그 없이 말만.`;
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
  const [gameMode, setGameMode] = useState("free"); // "free" or "premium"
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
      const stmts = gameMode === "free"
        ? generateLocalDiscussion(ps || players, bots, allDraft || allChoicesRef, rnd || round, gameHistory, pubLogsArr || pubLogs)
        : await generateDiscussion(ps || players, bots, allDraft || allChoicesRef, rnd || round, gameHistory, pubLogsArr || pubLogs);
      stmts.forEach(s => { const sp = (ps || players).find(p => p.id === s.id); if (sp?.alive) { const line = `${sp.name}: "${s.msg}"`; addL(`💬 ${line}`); conv += line + "\n"; } });
      if (!stmts.length) addL("💬 아무도 발언하지 않았다.");
    } catch { addL("💬 (토론 생성 실패)"); }
    setConvLog(conv);
    setLoading(false);
    setDc(0);

    if ((ps || players).find(p => p.id === HID)?.alive) { setPhase("discuss"); }
    else {
      // 인간 사망 → 봇끼리 투표
      if (gameMode === "free") {
        const tally = generateLocalBotVotes(ps || players, bots, allDraft || allChoicesRef, rnd || round, conv);
        doVoteResult(ps || players, tally, rnd || round);
      } else {
        try {
          const tally = await generateBotVotes(ps || players, bots, allDraft || allChoicesRef, rnd || round, conv);
          doVoteResult(ps || players, tally, rnd || round);
        } catch {
          const tally = {};
          (ps || players).filter(p => p.alive).forEach(p => { const b = bots[p.id]; if (b) { const v = b.vote(ps || players); tally[v] = (tally[v] || 0) + 1; } });
          doVoteResult(ps || players, tally, rnd || round);
        }
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
      const rx = gameMode === "free"
        ? generateLocalReactions(players, bots, msg, allChoicesRef, round, currentConv)
        : await generateReactions(players, bots, msg, allChoicesRef, round, currentConv);
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
    if (gameMode === "free") {
      const tally = generateLocalBotVotes(players, bots, allChoicesRef, round, convLog);
      if (tid >= 0) tally[tid] = (tally[tid] || 0) + 1;
      setLoading(false);
      doVoteResult([...players], tally, round);
    } else {
      try {
        const tally = await generateBotVotes(players, bots, allChoicesRef, round, convLog);
        if (tid >= 0) tally[tid] = (tally[tid] || 0) + 1;
        setLoading(false);
        doVoteResult([...players], tally, round);
      } catch {
        const ps = [...players];
        const tally = {};
        if (tid >= 0) tally[tid] = 1;
        ps.filter(p => p.alive && p.id !== HID).forEach(p => { const b = bots[p.id]; if (b) { const v = b.vote(ps); tally[v] = (tally[v] || 0) + 1; } });
        setLoading(false);
        doVoteResult(ps, tally, round);
      }
    }
  };

  const submitRevote = async (tid) => {
    setLoading(true);
    addL("⚖️ 재투표 집계 중...");
    if (gameMode === "free") {
      const allTally = generateLocalBotVotes(players, bots, allChoicesRef, round, convLog);
      const revoteTally = {};
      Object.entries(allTally).forEach(([id, v]) => { if (revoteCandidates.includes(+id)) revoteTally[+id] = v; });
      if (tid >= 0 && revoteCandidates.includes(tid)) revoteTally[tid] = (revoteTally[tid] || 0) + 1;
      setLoading(false);
      doVoteResult([...players], Object.keys(revoteTally).length ? revoteTally : {}, round, true);
    } else {
      try {
        const allTally = await generateBotVotes(players, bots, allChoicesRef, round, convLog);
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
      {phase !== "setup" && phase !== "rules" && <div style={S.hdr}><span>R{round} {human?.faction === "guardian" ? "🛡️" : "🌑"}{!humanAlive ? " 💀" : ""}</span><span style={{ fontWeight: 700, letterSpacing: 1 }}>성역의 균열</span><span style={{ display: "flex", alignItems: "center", gap: 8 }}><button onClick={() => setShowHelp(h => !h)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, color: "#94A3B8", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>📖 규칙</button>{gameMode === "free" ? "🎮" : (pendingModel === "opus" ? "🧠" : "⚡")} 생존{alive.length}</span></div>}
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
          <p style={{ color: "#475569", margin: "0 0 24px", fontSize: 13 }}>1인 vs AI · 프로토타입</p>

          {/* 모드 선택 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setGameMode("free")} style={{ padding: "10px 18px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, background: gameMode === "free" ? "rgba(34,197,94,0.20)" : "rgba(255,255,255,0.05)", border: gameMode === "free" ? "1px solid #22C55E" : "1px solid rgba(255,255,255,0.1)", color: "#E2E8F0" }}>🎮 무료 모드<br/><span style={{ fontSize: 10, fontWeight: 400, color: "#94A3B8" }}>로컬 AI · 즉시 플레이</span></button>
            <button onClick={() => setGameMode("premium")} style={{ padding: "10px 18px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, background: gameMode === "premium" ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.05)", border: gameMode === "premium" ? "1px solid #8B5CF6" : "1px solid rgba(255,255,255,0.1)", color: "#E2E8F0" }}>✨ 프리미엄<br/><span style={{ fontSize: 10, fontWeight: 400, color: "#94A3B8" }}>Claude API · 자연어 대화</span></button>
          </div>

          {/* 프리미엄일 때만 모델 선택 */}
          {gameMode === "premium" && <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setPendingModel("sonnet")} style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, background: pendingModel === "sonnet" ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.05)", border: pendingModel === "sonnet" ? "1px solid #3B82F6" : "1px solid rgba(255,255,255,0.1)", color: "#E2E8F0" }}>⚡ Sonnet<br/><span style={{ fontSize: 10, fontWeight: 400, color: "#94A3B8" }}>빠름 · 일반</span></button>
            <button onClick={() => setPendingModel("opus")} style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, background: pendingModel === "opus" ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.05)", border: pendingModel === "opus" ? "1px solid #8B5CF6" : "1px solid rgba(255,255,255,0.1)", color: "#E2E8F0" }}>🧠 Opus<br/><span style={{ fontSize: 10, fontWeight: 400, color: "#94A3B8" }}>깊은 추론 · 느림</span></button>
          </div>}

          {/* 무료 모드: 봇 학습 통계 표시 */}
          {gameMode === "free" && (() => { const b = BotBrain.load(); return b.games > 0 ? <div style={{ background: "rgba(34,197,94,0.08)", borderRadius: 8, padding: "8px 16px", marginBottom: 16, fontSize: 11, color: "#6EE7B7", textAlign: "center" }}>🧠 봇 학습 데이터: {b.games}판 · 수호자 {b.g_wins}승 / 공허 {b.v_wins}승<br/><button onClick={() => { BotBrain.reset(); setGameMode("free"); }} style={{ background: "none", border: "none", color: "#64748B", fontSize: 10, cursor: "pointer", marginTop: 4 }}>초기화</button></div> : <div style={{ color: "#64748B", fontSize: 11, marginBottom: 16, textAlign: "center" }}>🧠 게임을 할수록 봇이 똑똑해집니다</div>; })()}

          <div style={{ display: "flex", gap: 12 }}>{[5, 8].map(n => <button key={n} onClick={() => { setPendingN(n); setPhase("rules"); }} style={{ padding: "14px 28px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,255,0.3)", borderRadius: 8, color: "#E2E8F0", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>{n}인</button>)}</div>
        </div>}

        {phase === "rules" && <div style={{ flex: 1, overflowY: "auto", padding: "16px 4px", WebkitOverflowScrolling: "touch", minHeight: 0 }}>
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
            {gameMode === "free" && (() => { const b = BotBrain.load(); return b.games > 0 ? <div style={{ background: "rgba(139,92,246,0.08)", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 11, color: "#A78BFA" }}>🧠 봇 학습: {b.games}판 완료 · 수호자 {b.g_wins}승 · 공허 {b.v_wins}승</div> : null; })()}
            <button onClick={() => {
              // 학습 데이터 저장 (무료 모드)
              if (gameMode === "free") {
                const botChoices = players.filter(p => p.id !== HID).map(p => ({
                  faction: p.faction,
                  cat: (p.actionHistory || []).length > 0 ? p.actionHistory[p.actionHistory.length - 1].cat : "info"
                }));
                BotBrain.learn(victory.w, botChoices);
              }
              setPhase("setup"); setPlayers([]); setLog([]); setSecrets([]); setGameHistory([]); setConvLog("");
            }} style={{ ...S.btn("#3B82F6"), textAlign: "center" }}>새 게임</button>
          </div>
        </div>}
      </div>
    </div>
  );
}
