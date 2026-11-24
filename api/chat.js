// api/chat.js — AI 챗봇 서버 (Vercel 서버리스 함수, 제미니 API 키는 서버에서만 사용)
const { askGemini, hasKeys } = require("./_gemini");

// 다른 사이트에서 이 주소로 질문을 보내 키를 공짜로 쓰는 걸 막기
function sameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 주소창에서 직접 여는 경우 등
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// 페이지별 AI 지시문 (mode 값으로 골라 씀)
const PROMPTS = {
  meal:
    "너는 고등학생을 돕는 급식 데이터 분석 도우미야. " +
    "아래 [데이터]에 있는 내용만 근거로 친근한 존댓말로 3~4문장 이내로 답해. " +
    "데이터에 없는 내용은 모른다고 말해.",
  drug:
    "너는 고등학생을 돕는 의약품 공공데이터 설명 도우미야. " +
    "아래 [데이터]에 있는 내용만 근거로 3~4문장 이내로 친근한 존댓말로 답해. " +
    "특정 약을 먹으라고 권하거나 복용량, 진단 같은 의학적 조언은 절대 하지 마. " +
    "데이터에 없는 내용은 모른다고 말해. " +
    "답변 끝에는 항상 '실제 복용은 약사·의사와 상담하세요.'를 붙여.",
  custom:
    "너는 고등학생이 만든 공공데이터 웹사이트의 분석 도우미야. " +
    "아래 [데이터]에 있는 내용만 근거로 친근한 존댓말로 3~4문장 이내로 답해. " +
    "숫자를 비교하거나 특징을 찾아 설명하고, 데이터에 없는 내용은 모른다고 말해.",
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 받아요." });
  }
  if (!sameSite(req)) {
    return res.status(403).json({ error: "이 사이트에서 보낸 질문만 받아요." });
  }
  if (!hasKeys()) {
    return res.status(500).json({ error: "GEMINI_API_KEYS 환경 변수가 없어요. Vercel 설정 후 Redeploy 하세요." });
  }

  const { mode, question, data } = req.body || {};
  if (!question) {
    return res.status(400).json({ error: "질문이 비어 있어요." });
  }

  const system = PROMPTS[mode] || PROMPTS.custom;
  const q = String(question).slice(0, 300);                     // 질문 길이 제한
  const context = JSON.stringify(data || {}).slice(0, 6000);    // 데이터 길이 제한

  try {
    // 제미니에게 질문 (키 돌려쓰기는 _gemini.js가 알아서)
    const text = await askGemini(system, [{ text: `[데이터]\n${context}\n\n[질문]\n${q}` }]);
    return res.status(200).json({ answer: text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
