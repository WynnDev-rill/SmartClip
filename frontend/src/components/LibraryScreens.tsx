/* Shared persisted-state helpers intentionally live beside their small screens. */
/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { CircleCheck, Database, Download, HeartHandshake, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { EmptyState, SegmentedControl, StatusBadge } from "./AppShell";
import { appVersion, getPlatform } from "@/lib/platform";
import { isBackendConfigured } from "@/lib/url-backend";
import { useI18n, type LanguageMode } from "@/i18n";

export type HistoryItem = { id: string; title: string; source: "Device" | "URL"; status: "completed" | "failed" | "cancelled" | "expired"; date: string; candidateCount?: number };
export type DownloadItem = { id: string; filename: string; date: string; size: string; resolution?: string; source: "Device" | "URL"; uri?: string };
export const readStored = <T,>(key: string): T[] => { try { return JSON.parse(localStorage.getItem(key) || "[]") as T[]; } catch { return []; } };

export function ProjectsScreen({ items, onClear }: { items: HistoryItem[]; onClear(): void }) {
  const { t, locale } = useI18n();
  return <section className="screen"><PageTitle eyebrow={t("yourWorkspace")} title={t("projects")} detail={t("projectsDetail")}/>{items.length === 0 ? <EmptyState title={t("noProjects")} detail={t("noProjectsDetail")}/> : <div className="card-list">{items.map(item => <article className="library-card" key={item.id}><div className="min-w-0"><h3 className="truncate font-medium">{item.title}</h3><p>{item.source} · {new Date(item.date).toLocaleDateString(locale)} · {item.candidateCount ?? 0} {t("candidates")}</p></div><StatusBadge tone={item.status === "completed" ? "success" : item.status === "failed" ? "error" : "warning"}>{item.status}</StatusBadge></article>)}</div>}{items.length > 0 && <Button className="mt-5" variant="outline" onClick={onClear}><Trash2 size={16}/>{t("clearHistory")}</Button>}</section>;
}

export function DownloadsScreen({ items, onDelete }: { items: DownloadItem[]; onDelete(id: string): void }) {
  const { t, locale } = useI18n();
  return <section className="screen"><PageTitle eyebrow="Movies / SmartClip" title={t("downloads")} detail={t("downloadsDetail")}/><div className="notice"><Database size={18}/><p>{t("storageNotice")}</p></div>{items.length === 0 ? <EmptyState title={t("nothingSaved")} detail={t("nothingSavedDetail")}/> : <div className="card-list">{items.map(item => <article className="library-card" key={item.id}><span className="file-icon"><Download size={18}/></span><div className="min-w-0 flex-1"><h3 className="truncate font-medium">{item.filename}</h3><p>{item.source} · {item.size}{item.resolution ? ` · ${item.resolution}` : ""} · {new Date(item.date).toLocaleDateString(locale)}</p></div><StatusBadge tone="success"><CircleCheck size={12}/>{t("saved")}</StatusBadge><button className="icon-button" aria-label={t("deleteRecord", { name: item.filename })} onClick={() => onDelete(item.id)}><Trash2 size={17}/></button></article>)}</div>}</section>;
}

type Prefs = { duration: "30-plus" | "60-plus" | "auto"; detection: "conservative" | "balanced" | "aggressive"; quality: "auto" | "720p" | "1080p"; layout: "smart-crop" | "fit-background" };
export const defaultPreferences: Prefs = { duration: "auto", detection: "balanced", quality: "auto", layout: "smart-crop" };
export function SettingsScreen() {
  const { t, mode, setMode } = useI18n();
  const [prefs, setPrefs] = useState<Prefs>(() => { try { return { ...defaultPreferences, ...JSON.parse(localStorage.getItem("smartclip.preferences") || "{}") }; } catch { return defaultPreferences; } });
  const update = <K extends keyof Prefs>(key: K, value: Prefs[K]) => { const next = { ...prefs, [key]: value }; setPrefs(next); localStorage.setItem("smartclip.preferences", JSON.stringify(next)); };
  return <section className="screen"><PageTitle eyebrow={t("personalize")} title={t("settings")} detail={t("settingsDetail")}/><div className="settings-card"><SegmentedControl<LanguageMode> label={t("language")} value={mode} onChange={setMode} options={[["id",t("indonesian")],["en",t("english")],["system",t("followSystem")]]}/><SegmentedControl label={t("defaultDuration")} value={prefs.duration} onChange={v => update("duration", v)} options={[["30-plus","30+ sec"],["60-plus","60+ sec"],["auto","Auto"]]}/><p className="setting-help">Auto adapts clip length to natural highlight boundaries.</p><SegmentedControl label={t("defaultDetection")} value={prefs.detection} onChange={v => update("detection", v)} options={[["conservative","Conservative"],["balanced","Balanced"],["aggressive","Aggressive"]]}/><p className="setting-help">Balanced is recommended for most gameplay and talking videos.</p><SegmentedControl label={t("defaultQuality")} value={prefs.quality} onChange={v => update("quality", v)} options={[["auto","Auto"],["720p","720p"],["1080p","1080p"]]}/></div><div className="settings-card"><Setting icon={<RefreshCw/>} title="Private server" detail={isBackendConfigured() ? "Configured · HTTPS health check available" : "Not configured for this build"} badge={isBackendConfigured() ? "Configured" : "Not configured"}/><Setting icon={<ShieldCheck/>} title="Privacy" detail="Device videos stay local. URL jobs use private temporary storage."/><Setting icon={<Database/>} title="Storage" detail="Exports use scoped MediaStore; no broad storage permission."/><Setting icon={<HeartHandshake/>} title="About" detail={`SmartClip ${appVersion} · ${getPlatform()} · local-first private hobby project`}/></div></section>;
}
function Setting({ icon, title, detail, badge }: { icon: React.ReactNode; title: string; detail: string; badge?: string }) { return <div className="setting-row"><span>{icon}</span><div><h3>{title}</h3><p>{detail}</p></div>{badge && <StatusBadge tone={badge === "Configured" ? "success" : "warning"}>{badge}</StatusBadge>}</div>; }
export function PageTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) { return <header className="page-title"><p>{eyebrow}</p><h1>{title}</h1><span>{detail}</span></header>; }
