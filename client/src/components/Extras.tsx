import { useState } from "react";
import { Info, ChevronLeft, ChevronRight } from "lucide-react";
import type { TermCount } from "@/lib/textmine";

/* ------------------------------------------------------------------ */
/* 指标说明气泡：hover / 点击显示「定义 + 计算方式」                    */
/* ------------------------------------------------------------------ */
export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="指标说明"
        data-testid="info-tip"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="grid size-4 place-items-center rounded-full text-muted-foreground/70 transition-colors hover:text-primary"
      >
        <Info className="size-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-6 z-50 w-60 -translate-x-1/2 rounded-lg border border-popover-border bg-popover px-3 py-2 text-[11px] font-normal leading-relaxed text-popover-foreground shadow-lg"
          style={{ boxShadow: "0 8px 24px -12px hsl(var(--foreground) / 0.35)" }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* 词云：按词频映射字号 + 颜色深浅                                      */
/* ------------------------------------------------------------------ */
export function WordCloud({ terms }: { terms: TermCount[] }) {
  if (!terms.length)
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        暂无足够文本生成词云
      </div>
    );
  const max = terms[0].count;
  const min = terms[terms.length - 1].count;
  const range = Math.max(1, max - min);

  return (
    <div className="flex h-full flex-wrap content-center items-center justify-center gap-x-3 gap-y-1.5 overflow-hidden p-2">
      {terms.map((t, i) => {
        const w = (t.count - min) / range; // 0..1
        const size = 0.72 + w * 1.5; // rem
        const weight = w > 0.6 ? 700 : w > 0.3 ? 600 : 500;
        const opacity = 0.55 + w * 0.45;
        const chartVar = `--chart-${(i % 6) + 1}`;
        return (
          <span
            key={t.text}
            title={`${t.text}：出现 ${t.count} 次（加权）`}
            className="num inline-block leading-none transition-transform hover:scale-110"
            style={{
              fontSize: `${size}rem`,
              fontWeight: weight,
              color: `hsl(var(${chartVar}) / ${opacity})`,
            }}
          >
            {t.text}
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 通用横向排行条（媒体 / 实体）                                        */
/* ------------------------------------------------------------------ */
export function HBarRank({
  items,
  unit = "篇",
}: {
  items: { label: string; count: number; sub?: string }[];
  unit?: string;
}) {
  if (!items.length)
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        暂无数据
      </div>
    );
  const max = Math.max(...items.map((i) => i.count));
  return (
    <div className="flex flex-col gap-2 overflow-y-auto pr-1">
      {items.map((it, i) => (
        <div key={it.label + i} className="flex items-center gap-2.5 text-xs">
          <span className="w-4 shrink-0 text-right num font-semibold text-muted-foreground">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate font-medium" title={it.label}>
                {it.label}
              </span>
              <span className="num shrink-0 text-muted-foreground">
                {it.count} {unit}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(it.count / max) * 100}%`,
                  background: `hsl(var(--chart-${(i % 6) + 1}))`,
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 分页控件                                                            */
/* ------------------------------------------------------------------ */
export function Pager({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  // 生成可见页码窗口
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const end = Math.min(pageCount, start + 4);
  for (let p = start; p <= end; p++) pages.push(p);

  const btn =
    "grid size-8 place-items-center rounded-lg border border-border bg-card text-sm hover-elevate disabled:opacity-40 disabled:hover:bg-card";

  return (
    <div className="flex items-center justify-center gap-1.5 pt-4">
      <button
        className={btn}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        data-testid="pager-prev"
        aria-label="上一页"
      >
        <ChevronLeft className="size-4" />
      </button>
      {start > 1 && (
        <>
          <PageBtn p={1} page={page} onChange={onChange} />
          {start > 2 && <span className="px-1 text-muted-foreground">…</span>}
        </>
      )}
      {pages.map((p) => (
        <PageBtn key={p} p={p} page={page} onChange={onChange} />
      ))}
      {end < pageCount && (
        <>
          {end < pageCount - 1 && (
            <span className="px-1 text-muted-foreground">…</span>
          )}
          <PageBtn p={pageCount} page={page} onChange={onChange} />
        </>
      )}
      <button
        className={btn}
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
        data-testid="pager-next"
        aria-label="下一页"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

function PageBtn({
  p,
  page,
  onChange,
}: {
  p: number;
  page: number;
  onChange: (p: number) => void;
}) {
  const active = p === page;
  return (
    <button
      onClick={() => onChange(p)}
      data-testid={`pager-page-${p}`}
      className={`grid size-8 place-items-center rounded-lg border text-sm num transition-all ${
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-card hover-elevate"
      }`}
    >
      {p}
    </button>
  );
}
