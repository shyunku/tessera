import { useEffect, useState } from "react";
import { Icon } from "../icons.jsx";
import { api, errMsg } from "../util.js";

export function Modal({ children, wide, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dlg${wide ? " wide" : ""}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

// Runs an async action, shows its error inline, closes on success.
function useAction(onDone) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (fn) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fn();
      onDone(r);
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };
  return { busy, err, setErr, run };
}

const pathLabel = (tree, folderId) => (folderId ? tree.chain(folderId).map((f) => f.name).join(" › ") : "최상위");

export function ItemDialog({ tree, folderId, itemId, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [rows, setRows] = useState(itemId ? null : [{ name: "아이디", value: "" }, { name: "비밀번호", value: "" }]);
  const [loc, setLoc] = useState(folderId ?? null);
  const { busy, err, setErr, run } = useAction(onSaved);

  useEffect(() => {
    if (!itemId) return;
    api.items.forEdit(itemId).then((it) => {
      setName(it.name);
      setLoc(it.folderId);
      setRows(it.fields.map((f) => ({ name: f.name, value: f.value })));
    }, (e) => setErr(errMsg(e)));
  }, [itemId, setErr]);

  const set = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = () => {
    const fields = rows.filter((r) => r.name.trim() || r.value);
    if (!name.trim()) return setErr("항목 이름을 입력하세요.");
    if (fields.some((f) => !f.name.trim())) return setErr("키 이름을 입력하세요.");
    run(() => (itemId ? api.items.update(itemId, name, fields).then(() => itemId) : api.items.create(loc, name, fields)));
  };

  return (
    <Modal wide onClose={onClose}>
      <h3>{itemId ? "항목 수정" : "새 항목"}</h3>
      <p>{itemId ? pathLabel(tree, loc) : `위치: ${pathLabel(tree, loc)}`}</p>
      {rows && (
        <>
          <label className="field">
            <span>항목 이름</span>
            <input className="input" value={name} autoFocus placeholder="예: GitHub" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="kvh"><span>키 이름</span><span>값</span><span /></div>
          {rows.map((r, i) => (
            <div className="kv" key={i} style={{ gridTemplateColumns: "150px 1fr 32px" }}>
              <input className="input" value={r.name} onChange={(e) => set(i, "name", e.target.value)} aria-label="키 이름" />
              <input className="input mono" type="password" value={r.value} placeholder="값 입력" onChange={(e) => set(i, "value", e.target.value)} aria-label="값" />
              <button className="btn ghost icon" title="이 키 삭제" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Icon name="x" /></button>
            </div>
          ))}
          <button className="btn ghost" style={{ margin: "4px 0 16px" }} onClick={() => setRows((x) => [...x, { name: "", value: "" }])}>
            <Icon name="plus" /> 키 추가
          </button>
        </>
      )}
      {err && <div className="err" style={{ marginTop: 0 }}>{err}</div>}
      <div className="acts">
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={busy || !rows} onClick={save}>저장</button>
      </div>
    </Modal>
  );
}

export function FolderNameDialog({ tree, parentId, folder, onClose, onSaved }) {
  const [name, setName] = useState(folder?.name || "");
  const { busy, err, run } = useAction(onSaved);
  const save = () => run(() => (folder ? api.folders.rename(folder.id, name) : api.folders.create(parentId ?? null, name)));
  return (
    <Modal onClose={onClose}>
      <h3>{folder ? "폴더 이름 바꾸기" : "새 폴더"}</h3>
      <p>위치: {pathLabel(tree, folder ? folder.parentId : parentId)}</p>
      <label className="field">
        <span>폴더 이름</span>
        <input className="input" value={name} autoFocus placeholder="예: 쇼핑" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      </label>
      {err && <div className="err">{err}</div>}
      <div className="acts">
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={busy} onClick={save}>{folder ? "바꾸기" : "만들기"}</button>
      </div>
    </Modal>
  );
}

export function FolderMenuDialog({ tree, folder, itemCount, onClose, open }) {
  return (
    <Modal onClose={onClose}>
      <h3>{folder.name} 폴더</h3>
      <p className="num">항목 {itemCount}개 · 하위 폴더 {tree.descendants(folder.id).length - 1}개</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="btn" onClick={() => open({ kind: "folderName", folder })}><Icon name="edit" /> 이름 바꾸기</button>
        <button className="btn" onClick={() => open({ kind: "move", folder })}><Icon name="move" /> 다른 폴더로 이동</button>
        <button className="btn danger" onClick={() => open({ kind: "deleteFolder", folder })}><Icon name="trash" /> 폴더 삭제</button>
      </div>
      <div className="acts" style={{ marginTop: 20 }}>
        <button className="btn" onClick={onClose}>닫기</button>
      </div>
    </Modal>
  );
}

export function MoveDialog({ tree, item, folder, onClose, onMoved }) {
  const banned = folder ? tree.descendants(folder.id) : [];
  const current = folder ? folder.parentId ?? null : item.folderId ?? null;
  const [target, setTarget] = useState(undefined);
  const { busy, err, run } = useAction(onMoved);
  const row = (f, depth) => {
    const dis = banned.includes(f.id);
    const here = f.id === current;
    return [
      <button key={f.id} className={`pk${target === f.id ? " on" : ""}`} style={{ paddingLeft: 8 + depth * 16 }} disabled={dis || here} onClick={() => setTarget(f.id)}>
        <Icon name="folder" />{f.name}
        {here ? <small>지금 위치</small> : dis ? <small>자기 자신 또는 하위 폴더</small> : null}
      </button>,
      ...tree.children(f.id).flatMap((c) => row(c, depth + 1)),
    ];
  };
  const go = () =>
    run(() => (folder ? api.folders.move(folder.id, target, tree.children(target).length) : api.items.move(item.id, target)));
  return (
    <Modal onClose={onClose}>
      <h3>‘{folder ? folder.name : item.name}’ 이동</h3>
      <p>옮길 폴더를 고르세요.</p>
      <div className="picker">
        <button className={`pk${target === null ? " on" : ""}`} disabled={current === null} onClick={() => setTarget(null)}>
          <Icon name="folder" />최상위{current === null && <small>지금 위치</small>}
        </button>
        {tree.children(null).flatMap((f) => row(f, 1))}
      </div>
      {err && <div className="err">{err}</div>}
      <div className="acts">
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={busy || target === undefined} onClick={go}>이동</button>
      </div>
    </Modal>
  );
}

export function DeleteItemDialog({ item, fieldCount, onClose, onDeleted }) {
  const { busy, err, run } = useAction(onDeleted);
  return (
    <Modal onClose={onClose}>
      <h3>‘{item.name}’ 삭제</h3>
      <p>이 항목과 키 {fieldCount}개가 영구 삭제됩니다. 되돌릴 수 없습니다.</p>
      {err && <div className="err">{err}</div>}
      <div className="acts">
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn danger fill" disabled={busy} onClick={() => run(() => api.items.remove(item.id))}>삭제</button>
      </div>
    </Modal>
  );
}

export function DeleteFolderDialog({ tree, folder, itemCount, onClose, onDeleted }) {
  const [mode, setMode] = useState("keep");
  const { busy, err, run } = useAction(onDeleted);
  return (
    <Modal onClose={onClose}>
      <h3>‘{folder.name}’ 폴더 삭제</h3>
      <p className="num">이 폴더에 항목 {itemCount}개, 하위 폴더 {tree.descendants(folder.id).length - 1}개가 있습니다.</p>
      <button className={`radio${mode === "keep" ? " on" : ""}`} onClick={() => setMode("keep")}>
        <i /><div><b>폴더만 삭제</b><span>안에 있던 항목과 폴더는 ‘{pathLabel(tree, folder.parentId)}’로 옮깁니다.</span></div>
      </button>
      <button className={`radio${mode === "all" ? " on" : ""}`} onClick={() => setMode("all")}>
        <i /><div><b>안의 내용까지 모두 삭제</b><span className="num">항목 {itemCount}개와 그 안의 키가 영구 삭제됩니다.</span></div>
      </button>
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      <div className="acts" style={{ marginTop: 16 }}>
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn danger fill" disabled={busy} onClick={() => run(() => api.folders.remove(folder.id, mode))}>삭제</button>
      </div>
    </Modal>
  );
}

export function DuplicateDialog({ item, onClose, onDone }) {
  const { busy, err, run } = useAction(onDone);
  return (
    <Modal onClose={onClose}>
      <h3>‘{item.name}’ 복제</h3>
      <p>같은 폴더에 ‘{item.name} 사본’을 만듭니다.</p>
      {err && <div className="err">{err}</div>}
      <div className="acts">
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={busy} onClick={() => run(() => api.items.duplicate(item.id))}>복제</button>
      </div>
    </Modal>
  );
}
