// ── MINIGAMES ENGINE ────────────────────────────────────────────────────────────
// Overlay routing, tab switching, and difficulty dispatch.
// Engine primitives live in game-core.js to avoid circular imports.
import { S, saveS } from './state.js';
import { round } from './game-core.js';

import { genDictation, renderDictationRound, hintDictation, checkDictation, skipDictation } from './game-dictation.js';
import { genTranslation, renderTranslationRound, hintTranslation, checkTranslation, skipTranslation } from './game-translation.js';
import { genOrderGame, renderOrderRound, checkOrder, hintOrder, skipOrder } from './game-order.js';

export { genDictation, hintDictation, checkDictation, skipDictation };
export { genTranslation, hintTranslation, checkTranslation, skipTranslation };
export { genOrderGame, checkOrder, hintOrder, skipOrder };

let gameTab='dictation';

export function openGames(){renderGames();document.getElementById('gamesOv').style.display='flex';}
export function closeGames(){document.getElementById('gamesOv').style.display='none';window.speechSynthesis.cancel();}
export function setGameTab(t){
  gameTab=t;
  document.querySelectorAll('#gamesOv .settings-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));
  renderGames();
}
export function setGameDifficulty(d){
  S.gameDifficulty=d;saveS();
  if(gameTab==='dictation')genDictation();
  else if(gameTab==='translation')genTranslation();
  else genOrderGame();
}

export function renderGames(){
  if(gameTab==='dictation'){if(!round.sentence||round.checked)genDictation();else renderDictationRound();}
  else if(gameTab==='translation'){if(!round.phrase||round.checked)genTranslation();else renderTranslationRound();}
  else{if(!round.orderWords.length||round.checked)genOrderGame();else renderOrderRound();}
}
