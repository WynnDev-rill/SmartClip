import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell, SegmentedControl } from "./AppShell";
import { DownloadsScreen, ProjectsScreen, SettingsScreen } from "./LibraryScreens";

describe("mobile application shell", () => {
  it("exposes all destinations and identifies the active page", async () => {
    const navigate = vi.fn();
    render(<AppShell destination="home" onNavigate={navigate} title="Home"><p>Dashboard</p></AppShell>);
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "Downloads" }));
    expect(navigate).toHaveBeenCalledWith("downloads");
  });

  it("opens a functional overflow menu", async () => {
    const navigate = vi.fn();
    render(<AppShell destination="home" onNavigate={navigate} title="Home"><p>Dashboard</p></AppShell>);
    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(navigate).toHaveBeenCalledWith("settings");
  });

  it("supports keyboard-friendly segmented settings", async () => {
    const change = vi.fn();
    render(<SegmentedControl label="Duration" value="auto" options={[["auto", "Auto"], ["30", "30 sec"]] as const} onChange={change}/>);
    expect(screen.getByRole("button", { name: /Auto/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "30 sec" }));
    expect(change).toHaveBeenCalledWith("30");
  });
});

describe("library screens", () => {
  it("renders compact project and download empty states", () => {
    const { rerender } = render(<ProjectsScreen items={[]} onClear={vi.fn()}/>);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    rerender(<DownloadsScreen items={[]} onDelete={vi.fn()}/>);
    expect(screen.getByText("Nothing saved yet")).toBeInTheDocument();
  });

  it("never displays a configured backend token", () => {
    localStorage.setItem("SMARTCLIP_API_TOKEN", "super-secret-token");
    render(<SettingsScreen/>);
    expect(screen.queryByText("super-secret-token")).not.toBeInTheDocument();
    expect(screen.getByText("Privacy")).toBeInTheDocument();
  });

  it("opens the tappable private server details without secrets", async () => {
    render(<SettingsScreen/>);
    await userEvent.click(screen.getByRole("button", { name: /Private server/i }));
    expect(screen.getByRole("dialog", { name: "Server details" })).toHaveTextContent("https://smartclip-url-service.onrender.com");
    expect(screen.getByRole("button", { name: "Check connection" })).toBeEnabled();
  });
});
