import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as picker from "@/lib/video-picker";

vi.mock("@/lib/video-picker", async (original) => ({
  ...await original<typeof import("@/lib/video-picker")>(),
  isNativeAndroid: vi.fn(() => false), chooseNativeVideo: vi.fn(), readBrowserVideo: vi.fn(), releaseBrowserVideo: vi.fn(),
}));

const metadata: picker.LocalVideoMetadata = { filename: "holiday.mp4", fileSize: 1048576, duration: 65, width: 1920, height: 1080, resolution: "Full HD (1080p)", mimeType: "video/mp4", uri: "content://media/42", orientation: "Landscape", source: "Android native" };

describe("local video selection", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(picker.isNativeAndroid).mockReturnValue(false); });

  it("selects a browser file and displays all metadata", async () => {
    vi.mocked(picker.readBrowserVideo).mockResolvedValue(metadata);
    render(<App />);
    await userEvent.upload(screen.getByLabelText("Choose a video file"), new File(["x"], "holiday.mp4", { type: "video/mp4" }));
    expect(await screen.findByText("holiday.mp4")).toBeInTheDocument();
    for (const value of ["1:05", "1920 px", "1080 px", "Full HD (1080p)", "Landscape", "video/mp4", "content://media/42"]) expect(screen.getByText(value)).toBeInTheDocument();
  });

  it("shows an unsupported file error", async () => {
    vi.mocked(picker.readBrowserVideo).mockRejectedValue(new Error("Unsupported format. Choose an MP4, MOV, MKV, or WEBM video."));
    render(<App />); fireEvent.change(screen.getByLabelText("Choose a video file"), { target: { files: [new File(["x"], "notes.txt")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported format");
  });

  it("reports a cancelled browser picker", () => {
    render(<App />); fireEvent(screen.getByLabelText("Choose a video file"), new Event("cancel"));
    expect(screen.getByRole("alert")).toHaveTextContent("cancelled");
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
    expect(picker.chooseNativeVideo).toHaveBeenCalledOnce(); expect(picker.readBrowserVideo).not.toHaveBeenCalled(); expect(await screen.findByText("Android native")).toBeInTheDocument();
  });

  it("clearly labels browser fallback limitations", () => {
    render(<App />); expect(screen.getByText(/not equivalent to Android native metadata/i)).toBeInTheDocument(); expect(screen.getByText("Browser fallback")).toBeInTheDocument();
  });
});
