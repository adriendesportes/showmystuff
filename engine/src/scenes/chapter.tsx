/** Chapter interstitial (dark), with an optional step strip. */
import { ChapterCard } from "../ds/chapter";

export function Chapter({ number, title, subtitle, steps, step, total, label }: { number: number; title: string; subtitle?: string; steps?: string[]; step?: number; total?: number; label?: string }) {
  const from = step === undefined ? undefined : Math.max(0, step - 1);
  return <ChapterCard number={number} total={total} title={title} subtitle={subtitle} steps={steps} step={step} previousStep={from} label={label} />;
}
