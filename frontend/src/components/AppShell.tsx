import { type ReactNode } from "react";
import { Download, FolderClock, Home, MoreVertical, Scissors, Settings } from "lucide-react";
import { useI18n, type TranslationKey } from "@/i18n";

export type Destination = "home" | "projects" | "downloads" | "settings";

const destinations = [
  ["home", "home", Home], ["projects", "projects", FolderClock],
  ["downloads", "downloads", Download], ["settings", "settings", Settings],
] as const;

export function AppShell({ destination, onNavigate, title, children, immersive = false }: { destination: Destination; onNavigate(value: Destination): void; title: string; children: ReactNode; immersive?: boolean }) {
  const { t } = useI18n();
  return <div className="app-shell min-h-[100dvh]">
    <header className="top-bar">
      <div className="flex min-w-0 items-center gap-3"><span className="brand-mark" aria-hidden="true"><Scissors size={18}/></span><div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="text-[11px] text-muted-foreground">{t("workspace")}</p></div></div>
      <button className="icon-button" aria-label={t("moreOptions")}><MoreVertical size={20}/></button>
    </header>
    <main className={`page-content ${immersive ? "pb-safe" : "with-bottom-nav"}`}>{children}</main>
    {!immersive && <nav className="bottom-nav" aria-label={t("primaryNavigation")}>{destinations.map(([value, label, Icon]) => <button key={value} aria-current={destination === value ? "page" : undefined} onClick={() => onNavigate(value)}><Icon size={20}/><span>{t(label as TranslationKey)}</span></button>)}</nav>}
  </div>;
}

export function StatusBadge({ tone = "neutral", children }: { tone?: "neutral" | "success" | "warning" | "error" | "accent"; children: ReactNode }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><FolderClock size={22}/><div><h3 className="font-medium">{title}</h3><p>{detail}</p></div></div>;
}

export function SegmentedControl<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange(value: T): void }) {
  const { t } = useI18n();
  return <fieldset><legend className="setting-label">{label}</legend><div className="segmented">{options.map(([key, text]) => <button type="button" key={key} aria-pressed={value === key} onClick={() => onChange(key)}>{text}{(key === "auto" || key === "balanced") && <small>{t("recommended")}</small>}</button>)}</div></fieldset>;
}
