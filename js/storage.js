// ── STORAGE ────────────────────────────────────────────────────────────────
// localStorage wrapper

export async function kvGet(key){
  try{ return localStorage.getItem(key); }
  catch(e){ return null; }
}

export async function kvSet(key,val){
  localStorage.setItem(key,val);
}
