export const api = window.tessera;

// Errors from the preload arrive as plain { code, message } objects.
export function errMsg(e) {
  return (e && e.message) || "처리 중 오류가 발생했습니다.";
}

const TINTS = ["var(--tint-a)", "var(--tint-b)", "var(--tint-c)"];
export function tintFor(id = "") {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

export const byName = (a, b) => a.name.localeCompare(b.name, "ko");

export function ago(ts) {
  if (!ts) return "—";
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d < 1) return "오늘";
  if (d < 7) return `${d}일 전`;
  if (d < 30) return `${Math.floor(d / 7)}주 전`;
  if (d < 365) return `${Math.floor(d / 30)}달 전`;
  return `${Math.floor(d / 365)}년 전`;
}

export function ymd(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Folder helpers over the snapshot's flat list.
export function buildTree(folders) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const kids = new Map();
  for (const f of folders) {
    const k = f.parentId ?? null;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(f);
  }
  for (const list of kids.values()) list.sort((a, b) => a.position - b.position);
  const children = (id) => kids.get(id ?? null) || [];
  const chain = (id) => {
    const out = [];
    let f = byId.get(id);
    while (f) {
      out.unshift(f);
      f = byId.get(f.parentId);
    }
    return out;
  };
  const descendants = (id) => {
    const out = [id];
    for (const c of children(id)) out.push(...descendants(c.id));
    return out;
  };
  return { byId, children, chain, descendants };
}

// Korean object particle for a name: 을/를.
export function eulReul(word) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return "을(를)";
  return (c - 0xac00) % 28 ? "을" : "를";
}

// Colours digits and symbols in a revealed value so 0/O and 1/l/I are easy to tell apart.
export function splitChars(value) {
  const out = [];
  for (const ch of value) {
    const kind = /\d/.test(ch) ? "d" : /[\p{L}\s]/u.test(ch) ? "" : "s";
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += ch;
    else out.push({ kind, text: ch });
  }
  return out;
}
