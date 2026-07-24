import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as picker from "@/lib/video-picker";
import * as trim from "@/lib/trim";

vi.mock("@/lib/video-picker", async (original) => ({
  ...await original<typeof import("@/lib/video-picker")>(),
  isNativeAndroid: vi.fn(() => false), chooseNativeVideo: vi.fn(), readBrowserVideo: vi.fn(), releaseBrowserVideo: vi.fn(),
}));
vi.mock("@/lib/trim", async (original) => ({
  ...await original<typeof import("@/lib/trim")>(), exportNativeClip: vi.fn(), NativeEditor: { addListener: vi.fn(async () => ({ remove: vi.fn() })), exportComposition: vi.fn(), cancelExport: vi.fn(), openMedia: vi.fn(), shareMedia: vi.fn() },
}));

const metadata: picker.LocalVideoMetadata = { filename: "holiday.mp4", fileSize: 1048576, duration: 65, width: 1920, height: 1080, resolution: "Full HD (1080p)", mimeType: "video/mp4", uri: "content://media/42", orientation: "Landscape", source: "Android native" };

describe("local video selection", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(picker.isNativeAndroid).mockReturnValue(false); });

  it("selects a browser file and displays all metadata", async () => {
    vi.mocked(picker.readBrowserVideo).mockResolvedValue(metadata);
    render(<App />);
    await userEvent.upload(screen.getByLabelText("Choose a video file"), new File(["x"], "holiday.mp4", { type: "video/mp4" }));
    expect(await screen.findByText("holiday.mp4")).toBeInTheDocument();
    const expectMetadata = (label: string, value: string) => {
      const term = screen.getByText(label, { selector: "dt" });
      expect(within(term.parentElement!).getByText(value, { selector: "dd" })).toBeInTheDocument();
    };
    expectMetadata("Duration", "1:05");
    expectMetadata("Width", "1920 px");
    expectMetadata("Height", "1080 px");
    expectMetadata("Resolution", "Full HD (1080p)");
    expectMetadata("Orientation", "Landscape");
    expectMetadata("MIME type", "video/mp4");
    expectMetadata("Local URI", "content://media/42");
  });

  it("shows an unsupported file error", async () => {
    vi.mocked(picker.readBrowserVideo).mockRejectedValue(new Error("Unsupported format. Choose an MP4, MOV, MKV, or WEBM video."));
    render(<App />); fireEvent.change(screen.getByLabelText("Choose a video file"), { target: { files: [new File(["x"], "notes.txt")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported format");
  });

  it("quietly treats an empty browser selection as cancellation", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Choose a video file"), { target: { files: [] } });
    expect(picker.readBrowserVideo).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Video" })).toBeEnabled();
  });

  it("removes the selected video and releases browser resources", async () => {
    vi.mocked(picker.readBrowserVideo).mockResolvedValue({ ...metadata, source: "Browser preview", uri: "blob:test" });
    render(<App />); await userEvent.upload(screen.getByLabelText("Choose a video file"), new File(["x"], "holiday.mp4"));
    await userEvent.click(await screen.findByRole("button", { name: /remove video/i }));
    expect(picker.releaseBrowserVideo).toHaveBeenCalled(); expect(screen.getByText("Select one local video")).toBeInTheDocument();
  });

  it("uses the native Android picker instead of the file input", async () => {
    vi.mocked(picker.isNativeAndroid).mockReturnValue(true); vi.mocked(picker.chooseNativeVideo).mockResolvedValue(metadata);
    render(<App />); await userEvent.click(screen.getByRole("button", { name: "Choose Video" }));
    expect(picker.chooseNativeVideo).toHaveBeenCalledOnce();
    expect(picker.readBrowserVideo).not.toHaveBeenCalled();
    expect(await screen.findByText(/^Metadata ready.*Android native$/i)).toBeInTheDocument();
  });

  it("clearly labels browser fallback limitations", () => {
    render(<App />); expect(screen.getByText(/trim UI testing only/i)).toBeInTheDocument(); expect(screen.getByText("Browser fallback")).toBeInTheDocument();
  });

  it("does not fake export in the browser fallback", async () => {
    vi.mocked(picker.readBrowserVideo).mockResolvedValue({ ...metadata, source: "Browser preview" }); render(<App />);
    await userEvent.upload(screen.getByLabelText("Choose a video file"), new File(["x"], "holiday.mp4")); await userEvent.click(await screen.findByRole("button", { name: /export clip/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Android-only"); expect(trim.exportNativeClip).not.toHaveBeenCalled();
  });

  it("allows browser layout testing but never fakes vertical export", async () => {
    vi.mocked(picker.readBrowserVideo).mockResolvedValue({ ...metadata, source: "Browser preview" }); render(<App />);
    await userEvent.upload(screen.getByLabelText("Choose a video file"), new File(["x"], "holiday.mp4"));
    expect(await screen.findByLabelText("9:16 composition preview")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /export vertical mp4/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no backend was called");
    expect(trim.NativeEditor.exportComposition).not.toHaveBeenCalled();
  });

  it("uses the Android native export path and displays success", async () => {
    vi.mocked(picker.isNativeAndroid).mockReturnValue(true); vi.mocked(picker.chooseNativeVideo).mockResolvedValue(metadata);
    vi.mocked(trim.exportNativeClip).mockResolvedValue({ filename: "SmartClip_20260724_211500.mp4", duration: 65, fileSize: 2048, uri: "content://output", location: "Movies/SmartClip" });
    render(<App />); await userEvent.click(screen.getByRole("button", { name: "Choose Video" })); await userEvent.click(await screen.findByRole("button", { name: /export clip/i }));
    expect(await screen.findByText("Export completed")).toBeInTheDocument(); expect(trim.exportNativeClip).toHaveBeenCalledWith(metadata.uri, { start: 0, end: 65 });
  });

  it("shows native export failure", async () => {
    vi.mocked(picker.isNativeAndroid).mockReturnValue(true); vi.mocked(picker.chooseNativeVideo).mockResolvedValue(metadata); vi.mocked(trim.exportNativeClip).mockRejectedValue(new Error("Insufficient storage"));
    render(<App />); await userEvent.click(screen.getByRole("button", { name: "Choose Video" })); await userEvent.click(await screen.findByRole("button", { name: /export clip/i })); expect(await screen.findByRole("alert")).toHaveTextContent("Insufficient storage");
  });

  it("reports cancellation", async () => {
    vi.mocked(picker.isNativeAndroid).mockReturnValue(true); vi.mocked(picker.chooseNativeVideo).mockResolvedValue(metadata); vi.mocked(trim.exportNativeClip).mockRejectedValue(new Error("Export cancelled"));
    render(<App />); await userEvent.click(screen.getByRole("button", { name: "Choose Video" })); await userEvent.click(await screen.findByRole("button", { name: /export clip/i })); expect(await screen.findByRole("alert")).toHaveTextContent("Export cancelled");
  });
});
