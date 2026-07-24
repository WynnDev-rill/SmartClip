import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoUpload } from "./VideoUpload";
const metadata={video_id:"abc",original_filename:"clip.mp4",file_size_bytes:1048576,duration_seconds:65,width:1920,height:1080,resolution:"1080p",frame_rate:60,video_codec:"h264",audio_codec:"aac",container:"mp4",status:"uploaded" as const};
const mocks=vi.hoisted(()=>({uploadVideo:vi.fn(),deleteVideo:vi.fn()})); vi.mock("@/lib/api",()=>mocks);
beforeEach(()=>{vi.clearAllMocks();mocks.uploadVideo.mockReturnValue({promise:Promise.resolve(metadata),cancel:vi.fn()});mocks.deleteVideo.mockResolvedValue(undefined)});
describe("VideoUpload",()=>{
it("shows upload success and metadata",async()=>{render(<VideoUpload/>);await userEvent.upload(screen.getByLabelText(/choose a video/i),new File(["video"],"clip.mp4",{type:"video/mp4"}));expect(await screen.findByText("Upload complete")).toBeInTheDocument();expect(screen.getByText("1080p")).toBeInTheDocument();expect(screen.getByText(/h264/i)).toBeInTheDocument()});
it("shows an upload error",async()=>{mocks.uploadVideo.mockReturnValue({promise:Promise.reject(new Error("Video is unreadable")),cancel:vi.fn()});render(<VideoUpload/>);await userEvent.upload(screen.getByLabelText(/choose/i),new File(["x"],"bad.mp4"));expect(await screen.findByRole("alert")).toHaveTextContent("Video is unreadable")});
it("removes an uploaded video",async()=>{render(<VideoUpload/>);fireEvent.change(screen.getByLabelText(/choose/i),{target:{files:[new File(["x"],"clip.mp4")]}});await userEvent.click(await screen.findByRole("button",{name:/remove video/i}));await waitFor(()=>expect(mocks.deleteVideo).toHaveBeenCalledWith("abc"));expect(await screen.findByText("Drop your video here")).toBeInTheDocument()})});
