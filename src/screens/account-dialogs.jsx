import { useState } from "react";
import { api, errMsg } from "../util.js";
import { Modal } from "./dialogs.jsx";

function Pw({ label, value, onChange, placeholder, autoFocus, onEnter }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" type="password" value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onEnter?.()} />
    </label>
  );
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (fn) => {
    setBusy(true);
    setErr("");
    try {
      return await fn();
    } catch (e) {
      setErr(errMsg(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, setErr, run };
}

function ChangePassword({ onClose, showNote }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const { busy, err, setErr, run } = useRun();
  const go = async () => {
    if (next.length < 8) return setErr("새 비밀번호는 8자 이상이어야 합니다.");
    if (next !== next2) return setErr("새 비밀번호 두 개가 다릅니다.");
    const ok = await run(() => api.password.change(cur, next).then(() => true));
    if (ok) {
      onClose();
      showNote("비밀번호를 바꿨습니다");
    }
  };
  return (
    <Modal onClose={onClose}>
      <h3>비밀번호 변경</h3>
      <p>바꿔도 저장된 항목은 그대로 유지됩니다. 새 비밀번호는 복구할 수 없습니다.</p>
      <Pw label="현재 비밀번호" value={cur} onChange={setCur} autoFocus />
      <Pw label="새 비밀번호" value={next} onChange={setNext} placeholder="8자 이상" />
      <Pw label="새 비밀번호 확인" value={next2} onChange={setNext2} onEnter={go} />
      {err && <div className="err">{err}</div>}
      <div className="acts">
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={busy} onClick={go}>{busy ? "바꾸는 중…" : "변경"}</button>
      </div>
    </Modal>
  );
}

function Reset({ counts, onClose }) {
  const [confirm, setConfirm] = useState("");
  const [pw, setPw] = useState("");
  const { busy, err, run } = useRun();
  return (
    <Modal onClose={onClose}>
      <h3>데이터 초기화</h3>
      <p className="num">항목 {counts.items}개와 키 {counts.fields}개가 이 PC에서 영구 삭제됩니다. 백업 파일이 없으면 되돌릴 수 없습니다.</p>
      <label className="field">
        <span>확인을 위해 ‘초기화’를 입력하세요</span>
        <input className="input" value={confirm} placeholder="초기화" autoFocus onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <Pw label="비밀번호" value={pw} onChange={setPw} />
      {err && <div className="err">{err}</div>}
      <div className="acts">
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn danger fill" disabled={busy || confirm !== "초기화" || !pw} onClick={() => run(() => api.vault.reset(pw, confirm))}>초기화</button>
      </div>
    </Modal>
  );
}

function Export({ counts, onClose, showNote, refreshStatus }) {
  const [pw, setPw] = useState("");
  const { busy, err, run } = useRun();
  const go = async () => {
    const r = await run(() => api.backup.exportTo(pw));
    if (r && r.saved) {
      refreshStatus();
      onClose();
      showNote(`백업을 저장했습니다 · ${r.fileName}`);
    }
  };
  return (
    <Modal onClose={onClose}>
      <h3>백업 내보내기</h3>
      <p className="num">항목 {counts.items}개, 폴더 {counts.folders}개를 .tessera 파일 하나로 저장합니다. 파일은 마스터 비밀번호로 암호화됩니다.</p>
      <Pw label="비밀번호 확인" value={pw} onChange={setPw} placeholder="마스터 비밀번호" autoFocus onEnter={go} />
      {err && <div className="err">{err}</div>}
      <div className="acts">
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={busy || !pw} onClick={go}>저장 위치 선택…</button>
      </div>
    </Modal>
  );
}

function Import({ onClose, onDone, showNote }) {
  const [file, setFile] = useState(null);
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState("add");
  const { busy, err, run } = useRun();
  const pick = async () => {
    const f = await run(() => api.backup.pick());
    if (f) setFile(f);
  };
  const go = async () => {
    const r = await run(() => api.backup.importFrom(file.token, pw, mode));
    if (r) {
      onDone();
      showNote(r.mode === "add" ? `가져왔습니다 · ‘${r.folderName}’ 폴더에 항목 ${r.items}개` : `모든 데이터를 백업 내용으로 바꿨습니다 · 항목 ${r.items}개 (이전 데이터는 ${r.safetyCopy}로 보관)`);
    }
  };
  return (
    <Modal onClose={onClose}>
      <h3>백업 가져오기</h3>
      {!file ? (
        <>
          <p>가져올 .tessera 파일을 고르세요.</p>
          {err && <div className="err">{err}</div>}
          <div className="acts">
            <button className="btn" onClick={onClose}>취소</button>
            <button className="btn primary" disabled={busy} onClick={pick}>파일 선택…</button>
          </div>
        </>
      ) : (
        <>
          <p className="num">{file.fileName}{file.createdAt ? ` · ${new Date(file.createdAt).toLocaleDateString("ko-KR")} 백업` : ""}</p>
          <Pw label="백업 파일 비밀번호" value={pw} onChange={setPw} placeholder="백업을 만들 때의 마스터 비밀번호" autoFocus />
          <button className={`radio${mode === "add" ? " on" : ""}`} onClick={() => setMode("add")}>
            <i /><div><b>새 폴더에 추가</b><span>‘가져옴 날짜’ 폴더를 만들고 그 안에 넣습니다. 지금 있는 항목은 그대로 둡니다.</span></div>
          </button>
          <button className={`radio${mode === "replace" ? " on" : ""}`} onClick={() => setMode("replace")}>
            <i /><div><b>모든 데이터 교체</b><span>지금 데이터를 모두 지우고 백업 내용으로 바꿉니다. 바꾸기 전에 지금 상태를 자동으로 백업해 둡니다.</span></div>
          </button>
          {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
          <div className="acts" style={{ marginTop: 16 }}>
            <button className="btn" onClick={onClose}>취소</button>
            <button className="btn primary" disabled={busy || !pw} onClick={go}>{busy ? "가져오는 중…" : "가져오기"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function AccountDialogs({ modal, onClose, onDone, counts, showNote, refreshStatus }) {
  switch (modal.kind) {
    case "password":
      return <ChangePassword onClose={onClose} showNote={showNote} />;
    case "reset":
      return <Reset counts={counts} onClose={onClose} />;
    case "export":
      return <Export counts={counts} onClose={onClose} showNote={showNote} refreshStatus={refreshStatus} />;
    case "import":
      return <Import onClose={onClose} onDone={onDone} showNote={showNote} />;
    default:
      return null;
  }
}
