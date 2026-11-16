import { useEffect, useState } from "react";
import { api } from "../api";
import { diffProfiles } from "../profileDiff";
import type { ProductProfile, ProfileVersion, Template, TemplateSummary } from "../types";
import { Spinner } from "./icons";
import ProfileDiff from "./ProfileDiff";
import ProfileEditor from "./ProfileEditor";

const STATUS_LABELS: Record<ProfileVersion["status"], string> = {
  active: "사용 중",
  archived: "예전 버전",
  proposed: "개선안 (승인 전)",
  rejected: "거절함",
};
const SOURCE_LABELS: Record<ProfileVersion["source"], string> = {
  seed: "기본값",
  ai: "AI가 사진으로 만듦",
  manual: "직접 고침",
  feedback: "피드백 개선안",
  run: "실행에서 저장",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 고급 모드: 템플릿의 제품 프로필(프롬프트의 제품별 블록)을 항목 단위로 고치고, 버전을 되돌리고,
 * 쌓인 피드백으로 AI가 낸 개선안을 승인·거절한다. 템플릿은 모두가 함께 쓰므로 저장하면 모든 사용자에게 바로 쓰인다. */
export default function TemplatesPage() {
  const [list, setList] = useState<TemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [fold, setFold] = useState<ProductProfile | null>(null);
  const [versions, setVersions] = useState<ProfileVersion[]>([]);
  const [openFeedback, setOpenFeedback] = useState(0);
  const [draft, setDraft] = useState<ProductProfile | null>(null);
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listTemplates(), api.defaultProfile()]).then(([templates, defaults]) => {
      setList(templates);
      setFold(defaults);
      setTemplateId((current) => current ?? templates[0]?.id ?? null);
    }, (e: Error) => setError(e.message));
  }, []);

  const load = async (id: number) => {
    const [loaded, history, feedback] = await Promise.all([
      api.getTemplate(id),
      api.profileVersions(id),
      api.listFeedback({ template: id, status: "open", source: null }),
    ]);
    setTemplate(loaded);
    setVersions(history);
    setOpenFeedback(feedback.length);
    setDraft(loaded.profile ?? fold);
  };

  useEffect(() => {
    if (templateId == null || !fold) return;
    setMessage(null);
    setError(null);
    setExpanded(null);
    load(templateId).catch((e: Error) => setError(e.message));
  }, [templateId, fold]);

  const active = template?.profile ?? fold;
  const proposal = versions.find((v) => v.status === "proposed");
  const changed = active && draft ? diffProfiles(active, draft).length : 0;

  const run = async (label: string, action: () => Promise<string>) => {
    if (templateId == null) return;
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      const done = await action();
      await load(templateId);
      setMessage(done);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run("save", async () => {
      if (!window.confirm("이 템플릿의 제품 규칙을 새 버전으로 저장합니다. 모든 사용자의 다음 생성부터 바로 쓰입니다. 계속할까요?"))
        return "저장하지 않았습니다.";
      await api.saveProfile(templateId!, draft!, note);
      setNote("");
      return "새 버전으로 저장했습니다.";
    });

  const activate = (version: ProfileVersion) =>
    run(`activate-${version.version}`, async () => {
      const verb = version.status === "proposed" ? "승인" : "되돌리기";
      if (!window.confirm(`v${version.version}을(를) ${verb}합니다. 모든 사용자의 다음 생성부터 바로 쓰입니다. 계속할까요?`))
        return "바꾸지 않았습니다.";
      await api.activateProfile(templateId!, version.version);
      return version.status === "proposed"
        ? `개선안 v${version.version}을 승인했습니다. 반영한 피드백은 '반영함'으로 바꿨습니다.`
        : `v${version.version}으로 되돌렸습니다.`;
    });

  if (error && !template) return <p className="text-sm text-danger">{error}</p>;

  return (
    <section className="space-y-5 rounded-xl border bg-white p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">템플릿 제품 규칙 (고급 모드)</h2>
          <p className="mt-1 text-sm text-gray-500">
            프롬프트의 제품별 블록을 항목 단위로 고칩니다. 공통 골격(역할·레이아웃·안전 규칙)은 코드에 있어 여기서 고치지
            않습니다. 저장하면 모든 사용자에게 바로 쓰이고, 예전 버전으로 언제든 되돌릴 수 있습니다.
          </p>
        </div>
        <select
          value={templateId ?? ""}
          onChange={(e) => setTemplateId(Number(e.target.value))}
          aria-label="템플릿"
          className="rounded-lg border bg-white p-2 text-sm"
        >
          {list.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {message && <p className="rounded-lg bg-success-soft px-4 py-2.5 text-sm text-success">{message}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!template || !draft || !active ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5 text-gray-400" />
        </div>
      ) : (
        <>
          {/* 피드백 개선안 */}
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">피드백으로 개선안 만들기</p>
                <p className="text-xs text-gray-500">
                  이 템플릿의 확인 전 피드백 {openFeedback}건을 AI가 읽고 제품 규칙을 고친 개선안을 냅니다. 승인해야 쓰입니다.
                  규칙으로 고칠 수 없는 피드백은 개발자 확인용으로 따로 적어 둡니다.
                </p>
              </div>
              <button
                onClick={() => run("propose", async () => {
                  await api.proposeProfile(templateId!);
                  return "개선안을 만들었습니다. 아래에서 바뀐 점을 확인하고 승인하거나 거절하세요.";
                })}
                disabled={busy !== null || openFeedback === 0}
                className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
              >
                {busy === "propose" ? "만드는 중…" : proposal ? "개선안 다시 만들기" : "개선안 만들기"}
              </button>
            </div>

            {proposal && (
              <div className="space-y-3 rounded-lg bg-primary-soft/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    개선안 v{proposal.version}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {proposal.created_by} · {formatDate(proposal.created_at)} · 피드백 {proposal.feedback_ids.length}건 반영
                    </span>
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => run("reject", async () => {
                        await api.rejectProfile(templateId!, proposal.version);
                        return `개선안 v${proposal.version}을 거절했습니다.`;
                      })}
                      disabled={busy !== null}
                      className="rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                    >
                      거절
                    </button>
                    <button
                      onClick={() => activate(proposal)}
                      disabled={busy !== null}
                      className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
                    >
                      승인
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap text-xs text-gray-700">{proposal.note}</pre>
                <ProfileDiff before={active} after={proposal.profile} />
              </div>
            )}
          </div>

          {/* 직접 고치기 */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                직접 고치기 <span className="text-xs font-normal text-gray-500">바뀐 항목 {changed}개</span>
              </p>
              <button
                onClick={() => setDraft(active)}
                disabled={changed === 0}
                className="text-sm text-gray-500 underline hover:text-gray-900 disabled:opacity-40"
              >
                고친 내용 버리기
              </button>
            </div>
            <ProfileEditor value={draft} onChange={setDraft} lockSlots />
            {changed > 0 && (
              <details className="rounded-lg border">
                <summary className="cursor-pointer px-3 py-2 text-sm">바뀐 점 미리 보기</summary>
                <div className="border-t p-3">
                  <ProfileDiff before={active} after={draft} />
                </div>
              </details>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="무엇을 왜 바꿨는지 (버전 기록에 남음)"
                maxLength={1000}
                className="min-w-64 flex-1 rounded-lg border bg-white p-2 text-sm"
              />
              <button
                onClick={save}
                disabled={busy !== null || changed === 0}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
              >
                {busy === "save" ? "저장 중…" : "새 버전으로 저장"}
              </button>
            </div>
          </div>

          {/* 버전 기록 */}
          <div>
            <p className="text-sm font-medium">버전 기록</p>
            {versions.length === 0 && <p className="mt-2 text-xs text-gray-500">아직 저장된 버전이 없습니다 (기본 Fold 규칙 사용 중).</p>}
            <ul className="mt-2 divide-y border-y">
              {versions.map((v) => (
                <li key={v.version} className="space-y-2 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="font-medium">v{v.version}</span>
                    <span className={v.status === "active" ? "font-medium text-success" : "text-gray-500"}>
                      {STATUS_LABELS[v.status]}
                    </span>
                    <span className="text-gray-500">{SOURCE_LABELS[v.source]}</span>
                    <span className="text-gray-400">
                      {v.created_by ?? "시스템"} · {formatDate(v.created_at)}
                    </span>
                    <span className="ml-auto flex gap-3">
                      {v.status !== "active" && (
                        <button onClick={() => setExpanded(expanded === v.version ? null : v.version)} className="text-gray-500 hover:text-gray-900">
                          {expanded === v.version ? "접기" : "지금과 차이 보기"}
                        </button>
                      )}
                      {v.status === "archived" && (
                        <button onClick={() => activate(v)} disabled={busy !== null} className="text-primary hover:underline disabled:opacity-40">
                          이 버전으로 되돌리기
                        </button>
                      )}
                    </span>
                  </div>
                  {v.note && <pre className="whitespace-pre-wrap text-xs text-gray-600">{v.note}</pre>}
                  {expanded === v.version && <ProfileDiff before={active} after={v.profile} />}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
