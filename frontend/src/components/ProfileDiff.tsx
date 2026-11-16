import { diffProfiles } from "../profileDiff";
import type { ProductProfile } from "../types";

/** 두 프로필에서 바뀐 항목만 전/후로 보여 준다. */
export default function ProfileDiff({ before, after }: { before: ProductProfile; after: ProductProfile }) {
  const changes = diffProfiles(before, after);
  if (changes.length === 0) return <p className="text-xs text-gray-500">지금 쓰는 버전과 같습니다.</p>;
  return (
    <div className="space-y-2">
      {changes.map((change) => (
        <div key={change.field} className="rounded-lg border text-xs">
          <p className="border-b bg-gray-50 px-2.5 py-1.5 font-mono font-medium">{change.field}</p>
          <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <pre className="whitespace-pre-wrap bg-danger/5 p-2.5 text-gray-600">{change.before ?? "(없음)"}</pre>
            <pre className="whitespace-pre-wrap bg-success-soft/60 p-2.5">{change.after ?? "(지움)"}</pre>
          </div>
        </div>
      ))}
    </div>
  );
}
