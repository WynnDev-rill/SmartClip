import { type ReactNode, useRef, useState } from "react";
import { Download, FolderClock, Home, MoreVertical, Scissors, Settings } from "lucide-react";
import { useI18n, type TranslationKey } from "@/i18n";
import { checkPublicHealth } from "@/lib/url-backend";

export type Destination = "home" | "projects" | "downloads" | "settings";

const destinations = [
  ["home", "home", Home], ["projects", "projects", FolderClock],
  ["downloads", "downloads", Download], ["settings", "settings", Settings],
] as const;

export function AppShell({ destination, onNavigate, title, children, immersive = false }: { destination: Destination; onNavigate(value: Destination): void; title: string; children: ReactNode; immersive?: boolean }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false); const [dialog, setDialog] = useState<"about"|"privacy"|"health">(); const [health, setHealth] = useState(""); const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenu = () => { setMenu(false); menuButton.current?.focus(); };
  const runHealth = async () => { closeMenu(); setDialog("health"); setHealth(t("checking")); const result = await checkPublicHealth(); setHealth(t(result.state)); };
  return <div className="app-shell min-h-[100dvh]">
    <header className="top-bar">
      <div className="flex min-w-0 items-center gap-3"><span className="brand-mark" aria-hidden="true"><Scissors size={18}/></span><div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="text-[11px] text-muted-foreground">{t("workspace")}</p></div></div>
      <div className="relative"><button ref={menuButton} className="icon-button" aria-label={t("moreOptions")} aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(value => !value)}><MoreVertical size={20}/></button>{menu && <div role="menu" className="overflow-menu"><button role="menuitem" onClick={() => { closeMenu(); onNavigate("settings"); }}>{t("settings")}</button><button role="menuitem" onClick={() => { closeMenu(); setDialog("about"); }}>{t("aboutSmartClip")}</button><button role="menuitem" onClick={() => void runHealth()}>{t("checkServer")}</button><button role="menuitem" onClick={() => { closeMenu(); setDialog("privacy"); }}>{t("privacyInformation")}</button></div>}</div>
    </header>
    <main className={`page-content ${immersive ? "pb-safe" : "with-bottom-nav"}`}>{children}</main>
    {!immersive && <nav className="bottom-nav" aria-label={t("primaryNavigation")}>{destinations.map(([value, label, Icon]) => <button key={value} aria-current={destination === value ? "page" : undefined} onClick={() => onNavigate(value)}><Icon size={20}/><span>{t(label as TranslationKey)}</span></button>)}</nav>}
    {dialog && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(undefined); }}><section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title"><h2 id="app-dialog-title">{dialog === "about" ? t("aboutSmartClip") : dialog === "privacy" ? t("privacyInformation") : t("checkServer")}</h2><p>{dialog === "about" ? `SmartClip · ${t("aboutDetail")}` : dialog === "privacy" ? t("privacyInfoDetail") : health}</p><button className="mt-5 w-full rounded-xl bg-violet-500 px-4" onClick={() => setDialog(undefined)}>{t("close")}</button></section></div>}
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
