import { api, errMsg, ymd } from "../util.js";
import { useState } from "react";

function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={String(v)} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return <button className={`toggle${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export default function Settings({ status, counts, open, onLock }) {
  const s = status.settings;
  const [err, setErr] = useState("");
  const set = (key, value) => api.settings.set(key, value).then(() => setErr(""), (e) => setErr(errMsg(e)));

  return (
    <div className="settings">
      <h1>설정</h1>
      <p>바꾸면 바로 저장됩니다.</p>
      {err && <div className="err" style={{ margin: "8px 0 0" }}>{err}</div>}

      <div className="sec">
        <div className="sl"><b>화면</b><span>창 테마</span></div>
        <div className="panel">
          <div className="sw">
            <div className="st"><b>테마</b><span>시스템을 고르면 Windows 설정을 따라갑니다.</span></div>
            <Seg value={s.theme} onChange={(v) => set("theme", v)} options={[["system", "시스템"], ["light", "라이트"], ["dark", "다크"]]} />
          </div>
        </div>
      </div>

      <div className="sec">
        <div className="sl"><b>보안</b><span>자리를 비웠을 때와 값을 복사했을 때의 동작</span></div>
        <div className="panel">
          <div className="sw">
            <div className="st"><b>자동 잠금</b><span>마우스·키보드 입력이 없으면 이 시간 뒤에 잠급니다.</span></div>
            <Seg value={s.autoLockMinutes} onChange={(v) => set("autoLockMinutes", v)} options={[[1, "1분"], [5, "5분"], [15, "15분"], [30, "30분"], [0, "안 함"]]} />
          </div>
          <div className="sw">
            <div className="st"><b>클립보드 자동 삭제</b><span>복사한 값이 클립보드에 남아 있는 시간</span></div>
            <Seg value={s.clipboardSeconds} onChange={(v) => set("clipboardSeconds", v)} options={[[15, "15초"], [30, "30초"], [60, "60초"]]} />
          </div>
          <div className="sw">
            <div className="st"><b>값 가려서 보여 주기</b><span>끄면 항목을 열 때 값이 바로 보입니다.</span></div>
            <Toggle on={s.maskValues} label="값 가려서 보여 주기" onChange={(v) => set("maskValues", v)} />
          </div>
          <div className="sw">
            <div className="st"><b>최소화하면 잠그기</b><span>창을 내리면 바로 잠급니다.</span></div>
            <Toggle on={s.lockOnMinimize} label="최소화하면 잠그기" onChange={(v) => set("lockOnMinimize", v)} />
          </div>
        </div>
      </div>

      <div className="sec">
        <div className="sl">
          <b>마스터 비밀번호</b>
          <span className="num">{status.createdAt ? `${ymd(status.createdAt)} 생성 · ` : ""}항목 {counts.items}개, 키 {counts.fields}개</span>
        </div>
        <div className="panel">
          <div className="sw">
            <div className="st"><b>비밀번호 변경</b><span>바꿔도 저장된 항목은 그대로 유지됩니다.</span></div>
            <button className="btn" onClick={() => open({ kind: "password" })}>변경</button>
          </div>
          <div className="sw">
            <div className="st"><b>지금 잠그기</b><span>단축키 Ctrl+L</span></div>
            <button className="btn" onClick={onLock}>잠그기</button>
          </div>
        </div>
      </div>

      <div className="sec">
        <div className="sl"><b>백업</b><span>백업 파일은 마스터 비밀번호로 암호화됩니다.</span></div>
        <div className="panel">
          <div className="sw">
            <div className="st">
              <b>백업 내보내기</b>
              <span className="num">마지막 백업: {status.lastBackupAt ? ymd(status.lastBackupAt) : "없음"} · 항목 {counts.items}개, 폴더 {counts.folders}개</span>
            </div>
            <button className="btn" onClick={() => open({ kind: "export" })}>내보내기</button>
          </div>
          <div className="sw">
            <div className="st"><b>백업 가져오기</b><span>.tessera 파일의 항목을 새 폴더에 추가하거나, 모든 데이터를 통째로 바꿉니다.</span></div>
            <button className="btn" onClick={() => open({ kind: "import" })}>가져오기</button>
          </div>
        </div>
      </div>

      <div className="sec dangerz">
        <div className="sl"><b>데이터 초기화</b><span>되돌릴 수 없습니다.</span></div>
        <div className="panel">
          <div className="sw">
            <div className="st"><b>모든 데이터 삭제</b><span className="num">항목 {counts.items}개와 키 {counts.fields}개를 지우고 처음 시작하기 화면으로 돌아갑니다.</span></div>
            <button className="btn danger" onClick={() => open({ kind: "reset" })}>초기화</button>
          </div>
        </div>
      </div>
    </div>
  );
}
