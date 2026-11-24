// api/_gemini.js — 제미니 호출 공용 함수 (chat.js·vision.js가 같이 씀)
// 파일 이름이 _로 시작하면 Vercel이 주소(/api/_gemini)로 공개하지 않는다.
//
// 키 여러 개 돌려쓰기: Vercel 환경 변수 GEMINI_API_KEYS에 키를 쉼표(또는 줄바꿈)로 이어서 넣는다.
// 무료 키는 분당 한도가 작아서, 한 키가 한도 초과(429)거나 막히면 다음 키로 넘어간다.

const MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-latest";
const API = "https://generativelanguage.googleapis.com/v1beta/models";

// 제미니 키 모양(AIza + 35글자)인 것만 쓴다. 잘린 키나 끝에 붙은 깨진 글자는 걸러낸다.
const keys = () =>
  (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
    .split(/[\s,]+/)
    .map(t => (t.match(/^(AIza[0-9A-Za-z_-]{35})[^0-9A-Za-z_-]*$/) || [])[1])
    .filter(Boolean);

async function callGemini(key, model, body, signal) {
  try {
    const r = await fetch(`${API}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal,
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  } catch (e) {
    if (e.name === "AbortError") throw e; // 시간 초과는 전체 중단
    return { status: 0, j: { error: { message: e.message } } }; // 키 하나 문제면 다음 키로
  }
}

// system: 지시문, parts: [{ text }] 또는 [{ inlineData: { mimeType, data } }, { text }]
async function askGemini(system, parts, maxTokens = 4096) {
  const ks = keys();
  if (!ks.length) {
    throw new Error("GEMINI_API_KEYS 환경 변수가 없어요. Vercel 설정 후 Redeploy 하세요.");
  }

  const base = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens },
  };

  // 무작위 키에서 시작해서 기본 모델로 최대 4번, 마지막 1번은 예비 모델로
  const start = Math.floor(Math.random() * ks.length);
  const attempts = [];
  for (let i = 0; i < Math.min(4, ks.length); i++) {
    attempts.push({ key: ks[(start + i) % ks.length], model: MODEL, thinking: true });
  }
  attempts.push({ key: ks[(start + 4) % ks.length], model: FALLBACK_MODEL, thinking: false });
  attempts.push({ key: ks[(start + 5) % ks.length], model: FALLBACK_MODEL, thinking: false });
  const busy = new Set(); // 503(모델 혼잡)이 난 모델은 키를 바꿔도 소용없으니 건너뛴다

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45e3);
  let lastStatus = 0;
  let lastMessage = "";
  try {
    for (const a of attempts) {
      if (busy.has(a.model)) continue;
      // 생각(thinking)은 짧게: 답이 빨리 오고, 출력 한도를 생각에 다 쓰지 않게
      const gen = { ...base.generationConfig, ...(a.thinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}) };
      let { status, j } = await callGemini(a.key, a.model, { ...base, generationConfig: gen }, ctrl.signal);
      if (status === 400 && a.thinking) ({ status, j } = await callGemini(a.key, a.model, base, ctrl.signal));
      lastStatus = status;
      lastMessage = j.error?.message || "";
      if (status === 503) busy.add(a.model);
      if (status !== 200) continue; // 한도 초과(429)·키 문제면 다음 키로

      const text = (j.candidates?.[0]?.content?.parts || [])
        .filter(p => !p.thought)
        .map(p => p.text || "")
        .join("")
        .trim();
      if (text) return text;
    }
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "AI 응답 지연 · 다시 시도해 주세요." : "AI 서버 연결 실패: " + e.message);
  } finally {
    clearTimeout(timer);
  }
  throw new Error(
    lastStatus === 429 || lastStatus === 503
      ? "AI 사용량 초과 · 잠시 후 다시 시도해 주세요."
      : `AI 요청 실패 (${lastStatus}) ${lastMessage.slice(0, 120)}`
  );
}

module.exports = { askGemini, hasKeys: () => keys().length > 0 };
