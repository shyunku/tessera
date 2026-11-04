import { useEffect, useRef, useState } from "react";
import { Brand, Icon } from "../icons.jsx";
import { api, errMsg } from "../util.js";

function Frame({ children }) {
  return (
    <>
      <div className="caption-strip drag" />
      <div className="center">
        <div className="col">
          <Brand />
          {children}
        </div>
      </div>
    </>
  );
}

function PasswordField({ label, value, onChange, placeholder, autoFocus, onEnter }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        type="password"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter && onEnter()}
      />
    </label>
  );
}

const STEPS = [
  ["verify", "비밀번호 확인"],
  ["read", "이전 데이터 읽기"],
  ["write", "새 암호화로 저장"],
  ["check", "원본과 대조해 검증"],
];

export function ImportScreen({ onDone, onSkip }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ step: null, done: 0, total: 0 });
  const [result, setResult] = useState(null);

  useEffect(() => api.on("legacy:progress", (p) => setProgress((old) => ({ ...old, ...p }))), []);

  async function start() {
    if (!pw) return setErr("비밀번호를 입력하세요.");
    setErr("");
    setRunning(true);
    try {
      setResult(await api.legacy.migrate(pw));
    } catch (e) {
      setRunning(false);
      setErr(errMsg(e));
    }
  }

  if (running) {
    const idx = result ? STEPS.length : Math.max(0, STEPS.findIndex(([k]) => k === progress.step));
    const pct = result ? 100 : Math.round(((idx + (progress.total ? progress.done / progress.total : 0)) / STEPS.length) * 100);
    return (
      <Frame>
        <h1>가져오는 중</h1>
        <p className="sub">처음 한 번만 진행합니다. 창을 닫지 마세요.</p>
        <ul className="steps">
          {STEPS.map(([k, label], i) => (
            <li key={k} className={i < idx ? "done" : i === idx ? "now" : ""}>
              <span className="dot"><Icon name="check" size={12} style={{ strokeWidth: 2.5 }} /></span>
              {label}
              {k === "read" && progress.total > 0 && <span className="cnt num">키 {progress.total}개</span>}
            </li>
          ))}
        </ul>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        <div className="bar-cap num">
          <span>{progress.total ? `키 ${result ? progress.total : progress.done} / ${progress.total}` : "준비 중"}</span>
          <span>{pct}%</span>
        </div>
        <button className="btn primary block" disabled={!result} onClick={() => onDone(result.status)}>시작하기</button>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1>이전 버전 데이터 가져오기</h1>
      <p className="sub">
        Keyhub 0.5에서 쓰던 <b>shyunku</b> 계정을 새 형식으로 옮깁니다. 비밀번호는 그대로 쓰며, 나중에 설정에서 바꿀 수 있습니다.
      </p>
      <PasswordField label="shyunku 계정 비밀번호" value={pw} onChange={setPw} placeholder="이전 버전에서 쓰던 비밀번호" autoFocus onEnter={start} />
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" onClick={start}>가져오기</button>
      <div className="hint">원본 파일은 지우지 않고 그대로 둡니다.</div>
      <div className="hint">
        <button className="btn ghost" style={{ height: 28, fontWeight: 400, color: "var(--muted)" }} onClick={onSkip}>
          가져오지 않고 새로 시작하기
        </button>
      </div>
    </Frame>
  );
}

export function CreateScreen({ onDone }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (pw.length < 8) return setErr("비밀번호는 8자 이상이어야 합니다.");
    if (pw !== pw2) return setErr("두 비밀번호가 다릅니다.");
    setBusy(true);
    try {
      onDone(await api.vault.create(pw));
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  }

  return (
    <Frame>
      <h1>처음 시작하기</h1>
      <p className="sub">Tessera를 열 때 쓸 마스터 비밀번호를 정하세요.</p>
      <PasswordField label="비밀번호" value={pw} onChange={setPw} placeholder="8자 이상" autoFocus />
      <PasswordField label="비밀번호 확인" value={pw2} onChange={setPw2} placeholder="한 번 더 입력" onEnter={create} />
      {err && <div className="err">{err}</div>}
      <div className="notice">비밀번호는 복구할 수 없습니다. 잊어버리면 저장한 데이터를 열 방법이 없으니 따로 적어 두세요.</div>
      <button className="btn primary block" disabled={busy} onClick={create}>시작하기</button>
    </Frame>
  );
}

const REASONS = {
  startup: "비밀번호를 입력하세요.",
  manual: "직접 잠갔습니다.",
  minimize: "창을 내려서 잠겼습니다.",
  system: "컴퓨터가 잠기거나 절전 모드로 들어가서 잠겼습니다.",
};

export function UnlockScreen({ reason, lockedUntil, onDone }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState(lockedUntil || 0);
  const [, tick] = useState(0);
  const input = useRef(null);

  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setInterval(() => (Date.now() >= until ? (setUntil(0), setErr("")) : tick((n) => n + 1)), 500);
    return () => clearInterval(t);
  }, [until]);

  const wait = until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;

  async function unlock() {
    if (!pw) return setErr("비밀번호를 입력하세요.");
    setBusy(true);
    try {
      onDone(await api.vault.unlock(pw));
    } catch (e) {
      setErr(errMsg(e));
      setPw("");
      if (e.code === "throttled") setUntil(Date.now() + 30000);
      setBusy(false);
      setTimeout(() => input.current?.focus(), 0);
    }
  }

  const sub = reason?.startsWith("idle") ? reason.replace("idle:", "") + "분 동안 사용하지 않아 자동으로 잠겼습니다." : REASONS[reason] || REASONS.startup;

  return (
    <Frame>
      <h1>Tessera 잠금 해제</h1>
      <p className="sub">{sub}</p>
      <label className="field">
        <span>비밀번호</span>
        <input
          ref={input}
          className="input"
          type="password"
          value={pw}
          autoFocus
          disabled={wait > 0}
          placeholder="비밀번호 입력"
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && unlock()}
        />
      </label>
      {(err || wait > 0) && <div className="err">{wait > 0 ? `비밀번호를 5번 틀려서 ${wait}초 동안 입력할 수 없습니다.` : err}</div>}
      <button className="btn primary block" disabled={busy || wait > 0} onClick={unlock}>
        {busy ? "확인 중…" : "잠금 해제"}
      </button>
      <div className="hint">비밀번호를 5번 틀리면 30초 동안 입력할 수 없습니다.</div>
    </Frame>
  );
}
