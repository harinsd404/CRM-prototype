import type { ProductProfile } from "./types";

/** 프로필을 '항목 → 글' 목록으로 펼친다. 버전끼리 무엇이 바뀌었는지 보여 줄 때 쓴다. */
export function flattenProfile(profile: ProductProfile): Record<string, string> {
  const out: Record<string, string> = {
    device_noun: profile.device_noun,
    device_rules: profile.device_rules,
    screen_rules: profile.screen_rules,
    usage: profile.usage ?? "",
    person_rules: profile.person_rules ?? "",
    check: profile.check,
    edit_rules: profile.edit_rules,
    reference_color: profile.reference_color,
    color_slot: profile.color_slot ?? "",
    copy_terms: profile.copy_terms,
    pod_guide: profile.pod_guide,
    copy_guide: profile.copy_guide,
    visual_guide: profile.visual_guide,
  };
  for (const slot of profile.photo_slots) {
    out[`photo_slots.${slot.key}.label`] = slot.label;
    out[`photo_slots.${slot.key}.caption`] = slot.caption;
    out[`photo_slots.${slot.key}.required`] = String(slot.required);
  }
  for (const state of profile.states) {
    out[`states.${state.key}.label`] = state.label;
    out[`states.${state.key}.brief_hint`] = state.brief_hint;
    out[`states.${state.key}.rules`] = state.rules;
    out[`states.${state.key}.shows_screen`] = String(state.shows_screen);
    out[`states.${state.key}.orientation`] = state.orientation;
    out[`states.${state.key}.photos`] = state.photos.join(", ");
  }
  return out;
}

export interface FieldChange {
  field: string;
  before: string | null; // null = 새로 생김
  after: string | null; // null = 지워짐
}

export function diffProfiles(before: ProductProfile, after: ProductProfile): FieldChange[] {
  const a = flattenProfile(before);
  const b = flattenProfile(after);
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return fields
    .filter((field) => a[field] !== b[field])
    .map((field) => ({ field, before: a[field] ?? null, after: b[field] ?? null }));
}
