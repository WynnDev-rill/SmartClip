import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, LANGUAGE_PREFERENCE_KEY, readLanguageMode, resolveLocale, translate, useI18n } from "./i18n";
import { AppShell } from "./components/AppShell";
import { SettingsScreen } from "./components/LibraryScreens";

beforeEach(() => localStorage.clear());
const Probe = () => { const { t } = useI18n(); return <span>{t("home")}</span>; };
describe("lightweight localization", () => {
  it("defaults to Bahasa Indonesia", () => { expect(readLanguageMode()).toBe("id"); expect(translate("id", "home")).toBe("Beranda"); });
  it("follows Indonesian and non-Indonesian system locales", () => { expect(resolveLocale("system", "id-ID")).toBe("id"); expect(resolveLocale("system", "en-US")).toBe("en"); expect(resolveLocale("system", "fr-FR")).toBe("en"); });
  it("persists English and updates immediately", async () => { render(<I18nProvider><SettingsScreen/><Probe/></I18nProvider>); expect(screen.getByText("Beranda")).toBeInTheDocument(); await userEvent.click(screen.getByRole("button", { name: "English" })); expect(screen.getByText("Home")).toBeInTheDocument(); expect(localStorage.getItem(LANGUAGE_PREFERENCE_KEY)).toBe("en"); });
  it("localizes navigation and accessible labels", () => { render(<I18nProvider><AppShell destination="home" onNavigate={() => undefined} title="SmartClip"><div/></AppShell></I18nProvider>); expect(screen.getByRole("navigation", { name: "Navigasi utama" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Opsi lainnya" })).toBeInTheDocument(); expect(screen.getByText("Unduhan")).toBeInTheDocument(); });
  it("interpolates and handles plurals without token leakage", () => { expect(translate("en", "candidateCount", { count: 1 }, 1)).toBe("1 clip found"); expect(translate("en", "candidateCount", { count: 3 }, 3)).toBe("3 clips found"); expect(translate("id", "processingCandidate", { current: 2, total: 5 })).toBe("Memproses kandidat 2 dari 5"); expect(JSON.stringify([translate("id", "settingsDetail"), translate("en", "backendUnavailable")])).not.toContain("secret-token"); });
});
