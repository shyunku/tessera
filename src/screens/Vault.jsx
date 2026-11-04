import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, Mark } from "../icons.jsx";
import { api, ago, buildTree, byName, errMsg, splitChars, tintFor, ymd } from "../util.js";
import Settings from "./Settings.jsx";
import {
  ItemDialog,
  FolderNameDialog,
  FolderMenuDialog,
  MoveDialog,
  DeleteItemDialog,
  DeleteFolderDialog,
  DuplicateDialog,
} from "./dialogs.jsx";
import { AccountDialogs } from "./account-dialogs.jsx";

const STAR_FILLED = { fill: "currentColor", width: 14, height: 14 };

function Glyph({ item }) {
  return (
    <span className="glyph" style={{ background: tintFor(item.id) }}>
      {item.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Value({ text }) {
  return (
    <div className="fv">
      {splitChars(text).map((p, i) => (p.kind ? <span key={i} className={p.kind}>{p.text}</span> : p.text))}
    </div>
  );
}

// ---------- clipboard countdown ----------
function ClipboardToast({ clip, onClear, left }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!clip || clip.cleared) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [clip]);
  if (!clip) return null;
  const secs = Math.max(0, Math.ceil((clip.until - now) / 1000));
  const ratio = clip.cleared ? 0 : Math.max(0, (clip.until - now) / (clip.seconds * 1000));
  return (
    <div className="toast" style={{ left }} role="status">
      <div className="tr">
        <Icon name="copy" />
        <span>{clip.cleared ? "클립보드를 비웠습니다" : `‘${clip.label}’ 복사됨 · ${secs}초 후 클립보드에서 지워짐`}</span>
        {!clip.cleared && <button onClick={onClear}>지금 지우기</button>}
      </div>
      <div className="tb"><i style={{ width: `${ratio * 100}%` }} /></div>
    </div>
  );
}

export default function Vault({ status, setStatus }) {
  const settings = status.settings;
  const [snap, setSnap] = useState({ folders: [], items: [], history: {} });
  const [view, setView] = useState({ kind: "all", folderId: null });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({});
  const [selId, setSelId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [revealed, setRevealed] = useState({});
  const [modal, setModal] = useState(null);
  const [menu, setMenu] = useState(false);
  const [clip, setClip] = useState(null);
  const [note, setNote] = useState(null);
  const searchRef = useRef(null);

  const refresh = useCallback(async () => {
    const s = await api.vault.snapshot();
    setSnap(s);
    return s;
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const tree = useMemo(() => buildTree(snap.folders), [snap.folders]);
  const countIn = useCallback(
    (fid) => {
      const ids = new Set(tree.descendants(fid));
      return snap.items.filter((i) => ids.has(i.folderId)).length;
    },
    [tree, snap.items]
  );
  const pathOf = useCallback((fid) => (fid ? tree.chain(fid).map((f) => f.name).join(" › ") : "최상위"), [tree]);

  // ---------- list for the current view ----------
  const list = useMemo(() => {
    const items = snap.items;
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      return {
        title: `‘${q.trim()}’ 검색 결과`,
        folders: snap.folders.filter((f) => f.name.toLowerCase().includes(k)),
        items: items.filter((i) => i.name.toLowerCase().includes(k) || i.fieldNames.some((n) => n.toLowerCase().includes(k))).sort(byName),
        sub: "path",
        search: true,
      };
    }
    if (view.kind === "fav") return { title: "즐겨찾기", folders: [], items: items.filter((i) => i.favorite).sort(byName), sub: "path" };
    if (view.kind === "recent") {
      return {
        title: "최근 본 항목",
        folders: [],
        items: items.filter((i) => i.lastViewedAt).sort((a, b) => b.lastViewedAt - a.lastViewedAt).slice(0, 20),
        sub: "recent",
      };
    }
    if (view.kind === "folder" && tree.byId.has(view.folderId)) {
      const f = tree.byId.get(view.folderId);
      return { title: f.name, folder: f, folders: tree.children(f.id), items: items.filter((i) => i.folderId === f.id).sort(byName), sub: "keys" };
    }
    return { title: "모든 항목", folders: [], items: [...items].sort(byName), sub: "path" };
  }, [snap, q, view, tree]);

  // keep a selection that belongs to the list; auto-pick the first item (not counted as a view)
  useEffect(() => {
    if (view.kind === "settings") return;
    if (list.items.some((i) => i.id === selId)) return;
    setSelId(list.items[0]?.id ?? null);
  }, [list, selId, view.kind]);

  const loadDetail = useCallback(
    async (id, counted) => {
      if (!id) return setDetail(null);
      try {
        const it = counted ? await api.items.open(id) : await api.items.get(id);
        setDetail(it);
        if (!settings.maskValues) {
          const vals = {};
          for (const f of it.fields) vals[f.id] = await api.fields.reveal(f.id);
          setRevealed(vals);
        } else setRevealed({});
      } catch {
        setDetail(null);
      }
    },
    [settings.maskValues]
  );
  useEffect(() => {
    if (!selId) return setDetail(null);
    if (detail?.id !== selId) loadDetail(selId, false);
  }, [selId, detail?.id, loadDetail]);

  async function pick(id) {
    setSelId(id);
    setMenu(false);
    await loadDetail(id, true);
    refresh();
  }

  async function afterChange(selectId) {
    const s = await refresh();
    const keep = selectId ?? selId;
    if (keep && s.items.some((i) => i.id === keep)) {
      setSelId(keep);
      await loadDetail(keep, false);
    }
  }

  // ---------- notices ----------
  const showNote = useCallback((text, action) => {
    setNote({ text, action, at: Date.now() });
  }, []);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  useEffect(
    () =>
      api.on("clipboard:cleared", () =>
        setClip((c) => (c ? { ...c, cleared: true } : c))
      ),
    []
  );
  useEffect(() => {
    if (!clip?.cleared) return;
    const t = setTimeout(() => setClip(null), 1200);
    return () => clearTimeout(t);
  }, [clip]);

  async function copy(fieldId) {
    try {
      const r = await api.fields.copy(fieldId);
      setClip({ ...r, cleared: false });
    } catch (e) {
      showNote(errMsg(e));
    }
  }

  // ---------- undo / redo (moves only) ----------
  const undo = useCallback(async () => {
    const r = await api.history.undo();
    if (r.ok) {
      await refresh();
      showNote(`되돌렸습니다 · ${r.label}`, { label: "다시 실행", run: () => redoRef.current() });
    } else showNote(r.reason === "blocked" ? `‘${r.label}’ 이후라 그 전의 이동은 되돌릴 수 없습니다` : "되돌릴 이동이 없습니다");
  }, [refresh, showNote]);
  const redo = useCallback(async () => {
    const r = await api.history.redo();
    if (r.ok) {
      await refresh();
      showNote(`다시 실행했습니다 · ${r.label}`, { label: "실행 취소", run: () => undoRef.current() });
    } else showNote("다시 실행할 이동이 없습니다");
  }, [refresh, showNote]);
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  useEffect(() => {
    const onKey = (e) => {
      if (modal) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.ctrlKey && k === "l") {
        e.preventDefault();
        api.vault.lock();
        return;
      }
      if (e.target.closest("input, textarea")) return;
      if (e.ctrlKey && !e.shiftKey && k === "z") {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && (k === "y" || (e.shiftKey && k === "z"))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, undo, redo]);

  // ---------- drag & drop ----------
  const drag = useRef(null);
  const [mark, setMark] = useState(null); // { id|'root', ok } for "into" targets
  const [line, setLine] = useState(null); // { top, left } insertion line in the tree
  const treeRef = useRef(null);
  const hoverOpen = useRef(null);

  const canInto = (target) => {
    const d = drag.current;
    if (!d) return false;
    if (d.kind === "item") return (snap.items.find((i) => i.id === d.id)?.folderId ?? null) !== target;
    const f = tree.byId.get(d.id);
    if (target != null && tree.descendants(d.id).includes(target)) return false;
    return (f.parentId ?? null) !== target;
  };

  function computeDrop(e) {
    const d = drag.current;
    const root = e.target.closest("[data-drop-root]");
    if (root) return d.kind === "item" ? { mode: "into", id: null, key: "root" } : null;
    const row = e.target.closest("[data-folder]");
    if (!row) return null;
    const id = row.dataset.folder;
    const f = tree.byId.get(id);
    if (d.kind === "folder" && row.dataset.tree) {
      const r = row.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      const depth = Number(row.dataset.depth);
      if (y < 0.28) return { mode: "before", id, parent: f.parentId ?? null, depth, row };
      if (y > 0.72) {
        return open[id] && tree.children(id).length
          ? { mode: "first", id, parent: id, depth: depth + 1, row }
          : { mode: "after", id, parent: f.parentId ?? null, depth, row };
      }
    }
    return { mode: "into", id, key: id };
  }

  function valid(t) {
    if (!t) return false;
    if (t.mode === "into") return canInto(t.id);
    if (t.id === drag.current.id) return false;
    return !(t.parent != null && tree.descendants(drag.current.id).includes(t.parent));
  }

  const dnd = {
    onDragStart(e) {
      const src = e.target.closest("[data-drag]");
      if (!src) return;
      drag.current = { kind: src.dataset.drag, id: src.dataset.id };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
      src.classList.add("dragging-src");
    },
    onDragEnd(e) {
      e.target.closest?.("[data-drag]")?.classList.remove("dragging-src");
      drag.current = null;
      setMark(null);
      setLine(null);
      clearTimeout(hoverOpen.current);
    },
    onDragOver(e) {
      if (!drag.current) return;
      const t = computeDrop(e);
      if (!t) {
        setMark(null);
        setLine(null);
        return;
      }
      const ok = valid(t);
      if (t.mode === "into") {
        setLine(null);
        setMark({ key: t.key, ok });
      } else {
        setMark(null);
        if (ok && treeRef.current) {
          const tr = treeRef.current.getBoundingClientRect();
          const r = t.row.getBoundingClientRect();
          setLine({ top: (t.mode === "before" ? r.top : r.bottom) - tr.top - 1, left: t.depth * 16 + 24, width: tr.width - (t.depth * 16 + 24) - 4 });
        } else setLine(null);
      }
      if (ok) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
      if (t.mode === "into" && t.id && !open[t.id] && tree.children(t.id).length) {
        clearTimeout(hoverOpen.current);
        const id = t.id;
        hoverOpen.current = setTimeout(() => drag.current && setOpen((o) => ({ ...o, [id]: true })), 700);
      }
    },
    async onDrop(e) {
      const d = drag.current;
      if (!d) return;
      const t = computeDrop(e);
      if (!valid(t)) return;
      e.preventDefault();
      setMark(null);
      setLine(null);
      try {
        let r;
        if (d.kind === "item") {
          r = await api.items.move(d.id, t.id);
        } else {
          const parent = t.mode === "into" ? t.id : t.parent;
          const siblings = tree.children(parent).filter((x) => x.id !== d.id);
          const idx =
            t.mode === "into" ? siblings.length : t.mode === "first" ? 0 : siblings.findIndex((x) => x.id === t.id) + (t.mode === "after" ? 1 : 0);
          r = await api.folders.move(d.id, parent, idx);
          if (parent) {
            const anc = {};
            for (const f of tree.chain(parent)) anc[f.id] = true;
            setOpen((o) => ({ ...o, ...anc }));
          }
        }
        await refresh();
        showNote(`옮겼습니다 · ${r.label}`, { label: "실행 취소", run: () => undoRef.current() });
      } catch (err) {
        showNote(errMsg(err));
      }
    },
  };
  const markCls = (key) => (mark && mark.key === key ? (mark.ok ? " drop-ok" : " drop-no") : "");

  // ---------- modals ----------
  const close = () => setModal(null);
  const done = (selectId) => {
    setModal(null);
    afterChange(typeof selectId === "string" ? selectId : undefined);
  };
  const currentFolderId = view.kind === "folder" ? view.folderId : null;

  function renderModal() {
    if (!modal) return null;
    const m = modal;
    switch (m.kind) {
      case "item":
        return <ItemDialog tree={tree} folderId={m.folderId} itemId={m.itemId} onClose={close} onSaved={done} />;
      case "folderName":
        return <FolderNameDialog tree={tree} parentId={m.parentId} folder={m.folder} onClose={close} onSaved={done} />;
      case "folderMenu":
        return <FolderMenuDialog tree={tree} folder={m.folder} itemCount={countIn(m.folder.id)} onClose={close} open={setModal} />;
      case "move":
        return <MoveDialog tree={tree} item={m.item} folder={m.folder} onClose={close} onMoved={(r) => { done(); showNote(`옮겼습니다 · ${r.label}`, { label: "실행 취소", run: () => undoRef.current() }); }} />;
      case "deleteItem":
        return <DeleteItemDialog item={m.item} fieldCount={m.fieldCount} onClose={close} onDeleted={() => { setSelId(null); done(); }} />;
      case "deleteFolder":
        return (
          <DeleteFolderDialog
            tree={tree}
            folder={m.folder}
            itemCount={countIn(m.folder.id)}
            onClose={close}
            onDeleted={() => {
              if (view.kind === "folder" && tree.descendants(m.folder.id).includes(view.folderId)) setView({ kind: "all" });
              done();
            }}
          />
        );
      case "duplicate":
        return <DuplicateDialog item={m.item} onClose={close} onDone={(id) => done(id)} />;
      default:
        return <AccountDialogs modal={m} onClose={close} onDone={done} counts={counts} showNote={showNote} refreshStatus={() => api.app.status().then(setStatus)} />;
    }
  }

  const counts = {
    items: snap.items.length,
    folders: snap.folders.length,
    fields: snap.items.reduce((a, i) => a + i.fieldNames.length, 0),
  };

  // ---------- sidebar tree ----------
  const selFolder = view.kind === "folder" && !q ? view.folderId : null;
  const anc = selFolder ? tree.chain(selFolder).map((f) => f.id) : [];
  function treeRows(parentId, depth, guides) {
    return tree.children(parentId).flatMap((f) => {
      const kids = tree.children(f.id);
      const isOpen = !!open[f.id];
      const on = selFolder === f.id;
      const row = (
        <div
          key={f.id}
          className={`tn${on ? " on" : ""}${!on && anc.includes(f.id) ? " anc" : ""}${markCls(f.id)}`}
          data-folder={f.id}
          data-tree="1"
          data-depth={depth}
          data-drag="folder"
          data-id={f.id}
          draggable
          tabIndex={0}
          onClick={() => {
            setQ("");
            setView({ kind: "folder", folderId: f.id });
          }}
          onKeyDown={(e) => e.key === "Enter" && setView({ kind: "folder", folderId: f.id })}
        >
          <span className="ind">{guides.map((g, i) => <i key={i} className={`l${g ? " on" : ""}`} />)}</span>
          <button
            className={`tw${isOpen ? " open" : ""}`}
            tabIndex={-1}
            aria-label={isOpen ? "접기" : "펼치기"}
            style={{ visibility: kids.length ? "visible" : "hidden" }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => ({ ...o, [f.id]: !o[f.id] }));
            }}
          >
            <Icon name="chev" />
          </button>
          <span className="fi"><Icon name={isOpen && kids.length ? "folderOpen" : "folder"} /></span>
          <span className="lbl">{f.name}</span>
          <span className="c num">{countIn(f.id)}</span>
          <button
            className="more"
            title="폴더 메뉴"
            onClick={(e) => {
              e.stopPropagation();
              setModal({ kind: "folderMenu", folder: f });
            }}
          >
            <Icon name="dots" />
          </button>
        </div>
      );
      const guideOn = selFolder != null && selFolder !== f.id && tree.descendants(f.id).includes(selFolder);
      return isOpen ? [row, ...treeRows(f.id, depth + 1, [...guides, guideOn])] : [row];
    });
  }

  // ---------- render ----------
  const isSettings = view.kind === "settings";
  const fieldCount = detail?.fields.length ?? 0;
  const go = (kind) => {
    setQ("");
    setView({ kind, folderId: null });
  };
  const toastLeft = isSettings ? "50%" : "calc(320px + (100% - 320px) / 2)";

  return (
    <div className="shell" onDragStart={dnd.onDragStart} onDragEnd={dnd.onDragEnd} onDragOver={dnd.onDragOver} onDrop={dnd.onDrop} onClick={() => setMenu(false)}>
      <header className="top drag">
        <div className="brand"><Mark /><b>Tessera</b></div>
        <label className="search">
          <Icon name="search" />
          <input ref={searchRef} value={q} placeholder="항목·키 이름 검색" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")} />
          {q ? (
            <button className="clear" aria-label="검색 지우기" onClick={() => setQ("")}><Icon name="x" size={14} /></button>
          ) : (
            <kbd>Ctrl K</kbd>
          )}
        </label>
        <LockInfo minutes={settings.autoLockMinutes} />
      </header>

      <aside className="side">
        <div className={`nav${view.kind === "all" && !q ? " on" : ""}${markCls("root")}`} data-drop-root onClick={() => go("all")}>
          <Icon name="all" /><span className="lbl">모든 항목</span><span className="c num">{snap.items.length}</span>
        </div>
        <div className={`nav${view.kind === "fav" && !q ? " on" : ""}`} onClick={() => go("fav")}>
          <Icon name="star" /><span className="lbl">즐겨찾기</span><span className="c num">{snap.items.filter((i) => i.favorite).length}</span>
        </div>
        <div className={`nav${view.kind === "recent" && !q ? " on" : ""}`} onClick={() => go("recent")}>
          <Icon name="clock" /><span className="lbl">최근 본 항목</span>
        </div>
        <div className="grp">
          폴더
          <button title="새 폴더" onClick={() => setModal({ kind: "folderName", parentId: currentFolderId })}><Icon name="plus" /></button>
        </div>
        <div className="tree" ref={treeRef}>
          {treeRows(null, 0, [])}
          {snap.folders.length === 0 && <div className="empty" style={{ margin: "0 0 0 2px" }}>폴더가 없습니다.</div>}
          {line && <div className="insline" style={{ top: line.top, left: line.left, width: line.width }} />}
        </div>
        <div className="spacer" />
        <div className={`nav${isSettings ? " on" : ""}`} onClick={() => go("settings")}><Icon name="gear" /><span className="lbl">설정</span></div>
        <div className="nav" onClick={() => api.vault.lock()}><Icon name="lock" /><span className="lbl">잠그기</span></div>
      </aside>

      <main className="sheet">
        {isSettings ? (
          <Settings status={status} counts={counts} open={setModal} onLock={() => api.vault.lock()} />
        ) : (
          <>
            <div className="listpane">
              <div className="lp-head">
                <div className="row">
                  <div style={{ minWidth: 0 }}>
                    <h1>{list.title}</h1>
                    <p className="num">{list.folders.length ? `폴더 ${list.folders.length}개 · 항목 ${list.items.length}개` : `항목 ${list.items.length}개`}</p>
                  </div>
                  {!list.search && view.kind !== "fav" && view.kind !== "recent" && (
                    <button className="btn primary" onClick={() => setModal({ kind: "item", folderId: currentFolderId })}><Icon name="plus" /> 새 항목</button>
                  )}
                </div>
              </div>
              <div className="rows">
                {list.folders.map((f) => (
                  <div
                    key={f.id}
                    className={`it folder${markCls(f.id)}`}
                    data-folder={f.id}
                    data-drag="folder"
                    data-id={f.id}
                    draggable
                    onClick={() => {
                      setQ("");
                      setView({ kind: "folder", folderId: f.id });
                      const a = {};
                      for (const c of tree.chain(f.parentId)) a[c.id] = true;
                      setOpen((o) => ({ ...o, ...a }));
                    }}
                  >
                    <span className="glyph"><Icon name="folder" /></span>
                    <div className="t"><b>{f.name}</b><span className="num">{list.search ? pathOf(f.parentId) : `항목 ${countIn(f.id)}개`}</span></div>
                  </div>
                ))}
                {list.items.map((i) => (
                  <div key={i.id} className={`it${selId === i.id ? " sel" : ""}`} data-drag="item" data-id={i.id} draggable onClick={() => pick(i.id)}>
                    <Glyph item={i} />
                    <div className="t">
                      <b>{i.name}</b>
                      <span className="num">
                        {list.sub === "recent" ? `${ago(i.lastViewedAt)} 봄` : list.sub === "path" ? pathOf(i.folderId) : `키 ${i.fieldNames.length}개 · ${i.lastViewedAt ? `${ago(i.lastViewedAt)} 봄` : "아직 안 봄"}`}
                      </span>
                    </div>
                    {i.favorite && <span className="star"><Icon name="star" style={STAR_FILLED} /></span>}
                  </div>
                ))}
                {!list.items.length && !list.folders.length && (
                  <div className="empty">
                    {list.search ? (
                      `‘${q.trim()}’와 일치하는 항목이 없습니다. 항목 이름과 키 이름에서 찾습니다.`
                    ) : view.kind === "fav" ? (
                      "아직 즐겨찾기한 항목이 없습니다. 항목 오른쪽 위의 별을 누르면 여기에 모입니다."
                    ) : view.kind === "recent" ? (
                      "아직 열어 본 항목이 없습니다."
                    ) : (
                      <>
                        {view.kind === "folder" ? "이 폴더는 비어 있습니다." : "아직 항목이 없습니다."}{" "}
                        <button onClick={() => setModal({ kind: "item", folderId: currentFolderId })}>새 항목 만들기</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="detail">
              {!detail ? (
                <div className="nosel"><div><b>항목을 선택하세요</b>왼쪽 목록에서 고르면 키와 값이 여기에 보입니다.</div></div>
              ) : (
                <>
                  <div className="d-head">
                    <Glyph item={detail} />
                    <div className="tt">
                      <h2>{detail.name}</h2>
                      <p>{pathOf(detail.folderId)}</p>
                    </div>
                    <div className="d-actions">
                      <button
                        className={`btn ghost icon favbtn${detail.favorite ? " on" : ""}`}
                        title={detail.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
                        onClick={async () => {
                          await api.items.favorite(detail.id, !detail.favorite);
                          afterChange(detail.id);
                        }}
                      >
                        <Icon name="star" />
                      </button>
                      <button className="btn" onClick={() => setModal({ kind: "move", item: detail })}><Icon name="move" /> 이동</button>
                      <button className="btn" onClick={() => setModal({ kind: "item", itemId: detail.id })}><Icon name="edit" /> 수정</button>
                      <button
                        className="btn icon"
                        title="더 보기"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenu((m) => !m);
                        }}
                      >
                        <Icon name="dots" />
                      </button>
                      {menu && (
                        <div className="menu" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => { setMenu(false); setModal({ kind: "duplicate", item: detail }); }}><Icon name="copy" /> 복제</button>
                          <button className="neg" onClick={() => { setMenu(false); setModal({ kind: "deleteItem", item: detail, fieldCount }); }}><Icon name="trash" /> 삭제</button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="fields">
                    {detail.fields.map((f) => {
                      const shown = revealed[f.id] !== undefined;
                      return (
                        <div className="f" key={f.id}>
                          <div className="fk">
                            <small>{f.name}</small>
                            {shown ? <Value text={revealed[f.id]} /> : <div className="fv masked">••••••••••••</div>}
                          </div>
                          <div className="fa">
                            <button
                              className="btn ghost icon"
                              title={shown ? "숨기기" : "보기"}
                              onClick={async () => {
                                if (shown) setRevealed((r) => { const n = { ...r }; delete n[f.id]; return n; });
                                else {
                                  const v = await api.fields.reveal(f.id);
                                  setRevealed((r) => ({ ...r, [f.id]: v }));
                                }
                              }}
                            >
                              <Icon name={shown ? "eyeOff" : "eye"} />
                            </button>
                            <button className="btn ghost icon" title="복사" onClick={() => copy(f.id)}><Icon name="copy" /></button>
                          </div>
                        </div>
                      );
                    })}
                    <button className="addf" onClick={() => setModal({ kind: "item", itemId: detail.id })}><Icon name="plus" /> 키 추가</button>
                  </div>
                  <div className="meta num">
                    <div>만든 날<b>{ymd(detail.createdAt)}</b></div>
                    <div>마지막 수정<b>{ymd(detail.updatedAt)}</b></div>
                    <div>조회<b>{detail.viewCount}회 · {ago(detail.lastViewedAt)}</b></div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
        <ClipboardToast clip={clip} left={toastLeft} onClear={() => api.fields.clearClipboard()} />
        {note && (
          <div className="note" style={{ left: toastLeft }} role="status">
            <span>{note.text}</span>
            {note.action && <button onClick={() => { setNote(null); note.action.run(); }}>{note.action.label}</button>}
          </div>
        )}
      </main>
      {renderModal()}
    </div>
  );
}

// Countdown to auto-lock, reset by activity inside the window.
function LockInfo({ minutes }) {
  const [last, setLast] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let sent = 0;
    const bump = () => {
      const t = Date.now();
      setLast(t);
      if (t - sent > 5000) {
        sent = t;
        api.app.activity().catch(() => {});
      }
    };
    const evs = ["mousemove", "keydown", "mousedown", "wheel"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, []);
  const left = minutes ? Math.max(0, minutes * 60 - Math.floor((now - last) / 1000)) : null;
  return (
    <div className="lockinfo">
      {left != null && <span className="num">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} 후 자동 잠금</span>}
      <button className="btn ghost icon" title="지금 잠그기 (Ctrl+L)" onClick={() => api.vault.lock()}><Icon name="lock" /></button>
    </div>
  );
}
