// ── EL PROFETA ─────────────────────────────────────────────────────────────
// Reading comprehension overlay. Three content sources: real Spanish news via
// rss2json.com (El País), culture articles (NatGeo RSS fallback to LLM), and
// LLM-generated Harry Potter lore. User reads an article then takes a quiz or
// writes a recap verified by one LLM call.
import { S, saveS } from './state.js';
import { esc, showToast, extractJSON } from './helpers.js';
import { callLLM } from './llm.js';
import { awardPoints } from './progress.js';

const RSS_FEEDS = {
  noticias: 'https://www.20minutos.es/rss',
  cultura: 'https://www.hipertextual.com/feed'
};
const RSS2JSON_URL = 'https://api.rss2json.com/v1/api.json';
const SOURCE_ICONS = { noticias:'📰', cultura:'🎭', magico:'⚡' };
const SOURCE_LABELS = { noticias:'20minutos · RSS', cultura:'Hipertextual · RSS', magico:'IA · Harry Potter' };
const SOURCE_LABELS_LLM = { cultura:'IA · Cultura' };

let currentArticleId = null;
let readingMode = null;   // 'quiz' | 'recap' | null
let quizIdx = 0;
let quizScore = 0;
let quizAnswered = false;
let readingReqId = 0;
let readingDifficulty = 'medium';

const DIFF_CONFIG = {
  easy:   { count:5, words:'500-700', vocab:'vocabulario básico, frases cortas, presente e indefinido', tokens:3000, quizInstr:'preguntas de comprensión literal, opciones con vocabulario básico', icon:'📗', label:'Fácil' },
  medium: { count:4, words:'1000-1200', vocab:'vocabulario intermedio, subjuntivo ocasional, estructuras variadas', tokens:5000, quizInstr:'preguntas de comprensión literal e inferencia simple, opciones con vocabulario intermedio', icon:'📙', label:'Medio' },
  hard:   { count:3, words:'1500-1700', vocab:'vocabulario avanzado, subjuntivo, condicional, modismos', tokens:7000, quizInstr:'preguntas de inferencia, tono del autor y matices, opciones con vocabulario avanzado', icon:'📕', label:'Difícil' }
};

export function setReadingDiff(diff) {
  readingDifficulty = diff;
  document.querySelectorAll('.reading-diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === diff));
}

// ── overlay open/close ──────────────────────────────────────────────────────
export function openReading() {
  document.getElementById('readingOv').style.display = 'flex';
  renderReadingLobby();
}

export function closeReading() {
  window.speechSynthesis.cancel();
  document.getElementById('readingOv').style.display = 'none';
}

// ── lobby ───────────────────────────────────────────────────────────────────
export function renderReadingLobby() {
  currentArticleId = null;
  readingMode = null;
  quizIdx = 0; quizScore = 0; quizAnswered = false;
  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="reading-lobby">
    <div class="reading-lobby-title">📰 EL PROFETA</div>
    <div class="reading-lobby-sub">Lee artículos en español y demuestra tu comprensión</div>
    <div class="reading-diff-row">
      <button class="reading-diff-btn ${readingDifficulty==='easy'?'active':''}" data-diff="easy" onclick="setReadingDiff('easy')">📗 Fácil</button>
      <button class="reading-diff-btn ${readingDifficulty==='medium'?'active':''}" data-diff="medium" onclick="setReadingDiff('medium')">📙 Medio</button>
      <button class="reading-diff-btn ${readingDifficulty==='hard'?'active':''}" data-diff="hard" onclick="setReadingDiff('hard')">📕 Difícil</button>
    </div>
    <div class="reading-source-row">
      <button class="reading-source-btn" onclick="selectReadingSource('noticias')">
        <span class="src-icon">📰</span>Noticias<span class="src-label">20minutos · RSS</span>
      </button>
      <button class="reading-source-btn" onclick="selectReadingSource('cultura')">
        <span class="src-icon">🎭</span>Cultura y vida<span class="src-label">Hipertextual · RSS</span>
      </button>
      <button class="reading-source-btn" onclick="selectReadingSource('magico')">
        <span class="src-icon">⚡</span>Mundo mágico<span class="src-label">IA · Harry Potter</span>
      </button>
    </div>
  </div>`;
}

// ── source selection ────────────────────────────────────────────────────────
export async function selectReadingSource(source) {
  const reqId = ++readingReqId;
  const el = document.getElementById('readingCard');
  el.innerHTML = '<div class="mem-loading" style="text-align:center;padding:40px;">Cargando artículos…</div>';

  try {
    let headlines;
    if (source === 'magico') {
      headlines = await generateLLMArticles('magico');
    } else {
      headlines = await fetchRSSHeadlines(RSS_FEEDS[source], source, reqId);
      if (reqId !== readingReqId) return;
      if (!headlines || !headlines.length) {
        if (source === 'cultura') {
          headlines = await generateLLMArticles('cultura');
          headlines.forEach(h => h.rssFallback = true);
        } else {
          el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--ink);">
            <div style="font-size:14px;margin-bottom:8px;">No se pudieron cargar las noticias</div>
            <div style="font-size:11px;color:#7a5520;margin-bottom:12px;">El servicio RSS no está disponible ahora.</div>
            <button class="reading-back-btn" onclick="returnToLobby()">← Volver al menú</button>
          </div>`;
          return;
        }
      }
    }
    if (reqId !== readingReqId) return;

    // Cache stubs in state
    S.readingArticles = S.readingArticles || [];
    headlines.forEach(h => {
      if (!S.readingArticles.find(a => a.id === h.id)) {
        S.readingArticles.push(h);
      }
    });
    S.readingArticles = S.readingArticles.slice(-10);
    saveS();

    const isFallback = headlines.length > 0 && headlines[0].rssFallback;
    renderHeadlines(headlines, isFallback);
  } catch (e) {
    if (reqId !== readingReqId) return;
    el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--ink);">
      <div style="font-size:14px;margin-bottom:8px;">Error al cargar artículos</div>
      <div style="font-size:11px;color:#7a5520;margin-bottom:12px;">${esc(e.message)}</div>
      <button class="reading-back-btn" onclick="returnToLobby()">← Volver al menú</button>
    </div>`;
  }
}

// ── RSS fetching ────────────────────────────────────────────────────────────
async function fetchRSSHeadlines(rssUrl, source, reqId) {
  const url = `${RSS2JSON_URL}?rss_url=${encodeURIComponent(rssUrl)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 'ok' || !data.items) return null;
  return data.items.slice(0, 8).map(item => {
    const text = (item.content || item.description || '').replace(/<[^>]*>/g, '').trim();
    return {
      id: 'r_' + source + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      source,
      title: (item.title || '').replace(/<[^>]*>/g, '').trim(),
      text,
      quiz: null,
      ts: Date.now(),
      completed: false,
      difficulty: readingDifficulty
    };
  });
}

// ── LLM article generation ──────────────────────────────────────────────────
async function generateLLMArticles(source) {
  const dc = DIFF_CONFIG[readingDifficulty];
  const topicPrompt = source === 'magico'
    ? `sobre diferentes temas del mundo mágico de Harry Potter (personajes, hechizos, criaturas, lugares, eventos históricos, clases de Hogwarts)`
    : `sobre cultura, naturaleza, ciencia, arquitectura, diseño, vida cotidiana en España y Latinoamérica`;

  const sys = `Eres un redactor del periódico "El Profeta" del mundo mágico. Escribes artículos atractivos en español auténtico. ${dc.vocab}`;
  const user = `Escribe ${dc.count} artículos (${dc.words} palabras cada uno) ${topicPrompt}. Para cada artículo, incluye 4 preguntas de comprensión con 4 opciones cada una. Responde SOLO con JSON: {"articles":[{"title":"...","text":"...","quiz":[{"q":"...","options":["A","B","C","D"],"correct":0}]}]}. Varía los temas.`;

  const raw = await callLLM(sys, [{ role: 'user', content: user }], dc.tokens);
  const parsed = extractJSON(raw);
  return (parsed.articles || []).map(a => ({
    id: 'r_' + source + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    source,
    title: a.title || '',
    text: a.text || '',
    quiz: a.quiz || null,
    ts: Date.now(),
    completed: false,
    difficulty: readingDifficulty
  }));
}

// ── headline list ───────────────────────────────────────────────────────────
function renderHeadlines(headlines, isFallback) {
  const el = document.getElementById('readingCard');
  const banner = isFallback
    ? `<div style="text-align:center;padding:6px 10px;font-size:10px;color:#7a5520;background:rgba(201,168,76,.06);border-bottom:1px solid var(--bdg);">⚠️ RSS de Hipertextual no disponible. Mostrando artículos generados por IA.</div>`
    : '';
  el.innerHTML = banner + `<div class="reading-headlines">
    ${headlines.map(h => `<div class="reading-headline-item" onclick="selectArticle('${esc(h.id)}')">
      <span class="hl-icon">${SOURCE_ICONS[h.source]||''}</span>
      <span>${esc(h.title)}</span>
    </div>`).join('')}
  </div>
  <button class="reading-back-btn" onclick="returnToLobby()">← Elegir otra fuente</button>`;
}

// ── article selection ───────────────────────────────────────────────────────
export async function selectArticle(articleId) {
  const reqId = ++readingReqId;
  currentArticleId = articleId;
  readingMode = null;
  quizIdx = 0; quizScore = 0; quizAnswered = false;

  const article = S.readingArticles.find(a => a.id === articleId);
  if (!article) { renderReadingLobby(); return; }

  // If no quiz yet, generate one
  if (!article.quiz || !article.quiz.length) {
    const el = document.getElementById('readingCard');
    el.innerHTML = '<div class="mem-loading" style="text-align:center;padding:40px;">Generando preguntas…</div>';
    try {
      await generateQuizForArticle(article);
      if (reqId !== readingReqId) return;
      saveS();
    } catch (e) {
      if (reqId !== readingReqId) return;
      article.quiz = null;
    }
  }

  renderArticleView(article);
}

// ── quiz generation ─────────────────────────────────────────────────────────
async function generateQuizForArticle(article) {
  const dc = DIFF_CONFIG[article.difficulty || readingDifficulty];
  const sys = `Eres un profesor de español. Generas preguntas de comprensión lectora. ${dc.quizInstr}.`;
  const user = `Basado en este artículo en español, genera 4 preguntas de opción múltiple con 4 opciones cada una. La opción correcta debe estar claramente basada en el texto. Responde SOLO con JSON: {"quiz":[{"q":"pregunta","options":["A","B","C","D"],"correct":0}]}. Artículo:\n\n${article.text.substring(0, 2500)}`;
  const raw = await callLLM(sys, [{ role: 'user', content: user }], 1500);
  const parsed = extractJSON(raw);
  if (parsed.quiz && parsed.quiz.length) {
    article.quiz = parsed.quiz;
  }
}

// ── article view ────────────────────────────────────────────────────────────
function renderArticleView(article) {
  const isCompleted = S.readingCompletedIds[article.id];
  const el = document.getElementById('readingCard');
  const hasQuiz = article.quiz && article.quiz.length;
  const escText = esc(article.text);
  const sourceLabel = article.rssFallback
    ? (SOURCE_LABELS_LLM[article.source] || 'IA · ' + article.source)
    : (SOURCE_LABELS[article.source] || article.source);
  // Escape text for data-txt attribute (no double quotes that break attribute)
  const txtAttr = article.text.substring(0, 300).replace(/"/g, '&quot;').replace(/\n/g, ' ');
  el.innerHTML = `<div class="reading-article-wrap">
    <div class="reading-article-title">${esc(article.title)}</div>
    <div class="reading-article-meta">
      <span>${SOURCE_ICONS[article.source]||''} ${sourceLabel}</span>
      ${isCompleted ? '<span style="color:#2a8018;">✓ Completado</span>' : '<span>Nuevo</span>'}
      ${article.ts ? '<span>'+new Date(article.ts).toLocaleDateString('es-ES')+'</span>' : ''}
      <button class="reading-listen-btn" data-txt="${txtAttr}" data-rate="0.75" onclick="speakFromBtn(this)"><i class="ti ti-volume"></i> Leer en voz alta</button>
    </div>
    <div class="reading-article-text">${escText}</div>
  </div>
  ${isCompleted ? '<div style="text-align:center;font-size:10px;color:#7a5520;margin-bottom:4px;">Ya completado — puedes repetir sin puntos extra</div>' : ''}
  <div class="reading-actions">
    <button onclick="startQuiz()" ${!hasQuiz ? 'disabled style="opacity:.4;"' : ''}>📝 Cuestionario</button>
    <button onclick="startRecap()">✍️ Resumen</button>
  </div>
  <button class="reading-back-btn" onclick="selectReadingSource('${esc(article.source)}')">← Más artículos</button>`;
}

// ── quiz ────────────────────────────────────────────────────────────────────
export function startQuiz() {
  const article = S.readingArticles.find(a => a.id === currentArticleId);
  if (!article || !article.quiz || !article.quiz.length) return;
  readingMode = 'quiz';
  quizIdx = 0;
  quizScore = 0;
  renderQuizQuestion(article);
}

function renderQuizQuestion(article) {
  quizAnswered = false;
  const q = article.quiz[quizIdx];
  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="reading-quiz-wrap">
    <div class="reading-quiz-prog">Pregunta ${quizIdx + 1} de ${article.quiz.length}</div>
    <div class="reading-quiz-q">${esc(q.q)}</div>
    <div class="reading-quiz-opts">
      ${q.options.map((opt, i) => `<button class="reading-quiz-opt" data-idx="${i}" onclick="answerQuiz(${i})">${esc(opt)}</button>`).join('')}
    </div>
  </div>
  <button class="reading-back-btn" onclick="selectArticle('${esc(article.id)}')">← Volver al artículo</button>`;
}

export function answerQuiz(optIdx) {
  if (quizAnswered) return;
  quizAnswered = true;
  const article = S.readingArticles.find(a => a.id === currentArticleId);
  if (!article) return;

  const correct = article.quiz[quizIdx].correct;
  const opts = document.querySelectorAll('.reading-quiz-opt');
  opts.forEach((btn, i) => {
    btn.disabled = true;
    if (i === correct) btn.classList.add('correct');
    if (i === optIdx && i !== correct) btn.classList.add('wrong');
  });
  if (optIdx === correct) quizScore++;

  setTimeout(() => {
    quizIdx++;
    if (quizIdx < article.quiz.length) {
      renderQuizQuestion(article);
    } else {
      renderQuizResults(article);
    }
  }, 1500);
}

function renderQuizResults(article) {
  const total = article.quiz.length;
  const ratio = quizScore / total;
  const pct = Math.round(ratio * 100);

  let pointsAwarded = 0;
  if (!S.readingCompletedIds[article.id]) {
    pointsAwarded = Math.round(3 + ratio * 5);
    awardPoints(pointsAwarded);
    S.readingCompletedIds[article.id] = true;
    S.readingCompleted = (S.readingCompleted || 0) + 1;
    article.completed = true;
    saveS();
  }

  readingMode = null;
  const el = document.getElementById('readingCard');
  let feedback = '';
  if (ratio >= 1) feedback = '¡Excelente! Has comprendido todo el artículo.';
  else if (ratio >= 0.75) feedback = 'Muy bien, has entendido la mayor parte.';
  else if (ratio >= 0.5) feedback = 'Bien, aunque algunos detalles se te escaparon.';
  else feedback = 'Sigue practicando — relee el artículo e inténtalo de nuevo.';

  el.innerHTML = `<div class="reading-result-wrap">
    <div class="reading-result-score">${quizScore}/${total}</div>
    <div class="reading-result-label">${pct}% correcto</div>
    <div style="font-size:12px;color:var(--ink);font-style:italic;line-height:1.6;margin-bottom:8px;">${feedback}</div>
    ${pointsAwarded > 0 ? `<div class="reading-result-label" style="color:#2a8018;">+${pointsAwarded} puntos</div>` : `<div class="reading-result-label" style="color:#7a5520;">Ya completado — sin puntos extra</div>`}
    <div class="reading-actions">
      <button onclick="startQuiz()">🔄 Reintentar</button>
      <button onclick="selectArticle('${esc(article.id)}')">← Volver al artículo</button>
    </div>
    <button class="reading-back-btn" onclick="returnToLobby()">📰 Menú</button>
  </div>`;
}

// ── recap ───────────────────────────────────────────────────────────────────
export function startRecap() {
  readingMode = 'recap';
  const article = S.readingArticles.find(a => a.id === currentArticleId);
  if (!article) return;
  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="reading-recap-wrap">
    <div style="font-size:11px;color:#7a5520;margin-bottom:6px;">Escribe un resumen en español (3-5 frases) de lo que has leído:</div>
    <textarea class="reading-recap-ta" id="recapTa" placeholder="El artículo trata sobre..."></textarea>
    <div class="reading-actions" style="margin-top:10px;">
      <button onclick="submitRecap()">✉️ Enviar</button>
    </div>
    <button class="reading-back-btn" onclick="selectArticle('${esc(article.id)}')">← Volver al artículo</button>
  </div>`;
}

export async function submitRecap() {
  if (readingMode !== 'recap') return;
  const reqId = ++readingReqId;
  const ta = document.getElementById('recapTa');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text || text.length < 20) {
    showToast('Escribe al menos 20 caracteres');
    return;
  }

  const article = S.readingArticles.find(a => a.id === currentArticleId);
  if (!article) return;

  const el = document.getElementById('readingCard');
  el.innerHTML = '<div class="mem-loading" style="text-align:center;padding:40px;">Evaluando tu resumen…</div>';

  try {
    const sys = 'Eres un profesor de español. Evalúas la comprensión lectora de un estudiante basándote en su resumen. Sé justo pero exigente. Responde SOLO con JSON.';
    const user = `Artículo:\n${article.text.substring(0, 2000)}\n\nResumen del estudiante:\n${text}\n\nEvalúa el resumen. Responde SOLO con JSON: {"score":0-1,"feedback":"breve comentario en español (2-3 frases)","missedKeyPoints":["punto clave no mencionado"]}`;
    const raw = await callLLM(sys, [{ role: 'user', content: user }], 1000);
    if (reqId !== readingReqId) return;
    const parsed = extractJSON(raw);
    const score = Math.max(0, Math.min(1, parsed.score || 0));

    let pointsAwarded = 0;
    if (!S.readingCompletedIds[article.id]) {
      pointsAwarded = Math.round(3 + score * 5);
      awardPoints(pointsAwarded);
      S.readingCompletedIds[article.id] = true;
      S.readingCompleted = (S.readingCompleted || 0) + 1;
      article.completed = true;
      saveS();
    }

    renderRecapResults(article, score, parsed.feedback || '', parsed.missedKeyPoints || [], pointsAwarded);
  } catch (e) {
    if (reqId !== readingReqId) return;
    el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--ink);">
      <div style="font-size:14px;margin-bottom:8px;">Error al evaluar</div>
      <div style="font-size:11px;color:#7a5520;margin-bottom:12px;">${esc(e.message)}</div>
      <button class="reading-back-btn" onclick="selectArticle('${esc(article.id)}')">← Volver al artículo</button>
    </div>`;
  }
}

function renderRecapResults(article, score, feedback, missedPoints, pointsAwarded) {
  readingMode = null;
  const el = document.getElementById('readingCard');
  el.innerHTML = `<div class="reading-result-wrap">
    <div class="reading-result-score">${Math.round(score * 100)}%</div>
    <div class="reading-result-label">Comprensión evaluada</div>
    ${feedback ? `<div class="reading-recap-fb">${esc(feedback)}</div>` : ''}
    ${missedPoints.length ? `<div class="reading-recap-fb"><strong>Puntos clave no mencionados:</strong><br>${missedPoints.map(p => '• ' + esc(p)).join('<br>')}</div>` : ''}
    ${pointsAwarded > 0 ? `<div class="reading-result-label" style="color:#2a8018;">+${pointsAwarded} puntos</div>` : `<div class="reading-result-label" style="color:#7a5520;">Ya completado — sin puntos extra</div>`}
    <div class="reading-actions">
      <button onclick="startRecap()">🔄 Reintentar</button>
      <button onclick="selectArticle('${esc(article.id)}')">← Volver al artículo</button>
    </div>
    <button class="reading-back-btn" onclick="returnToLobby()">📰 Menú</button>
  </div>`;
}

// ── back to lobby ───────────────────────────────────────────────────────────
export function returnToLobby() {
  renderReadingLobby();
}
