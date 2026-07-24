package com.wynndev.smartclip.videopicker;

import android.app.Activity;
import android.content.Intent;
import android.content.ContentValues;
import android.database.Cursor;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "LocalVideoPicker")
public class LocalVideoPickerPlugin extends Plugin {
    private final AtomicBoolean cancelled = new AtomicBoolean(false);

    @PluginMethod
    public void chooseVideo(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("video/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "video/mp4", "video/quicktime", "video/x-matroska", "video/webm" });
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "videoPicked");
    }

    @ActivityCallback
    private void videoPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Video selection was cancelled.", "PICKER_CANCELLED"); return;
        }
        Uri uri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // Some providers grant session access but do not support persistable grants.
        }
        try {
            JSObject data = readMetadata(uri);
            call.resolve(data);
        } catch (SecurityException error) {
            call.reject("Permission denied while reading the selected video.", "PERMISSION_DENIED", error);
        } catch (Exception error) {
            call.reject("The selected video is unreadable or is missing metadata.", "METADATA_ERROR", error);
        }
    }

    private JSObject readMetadata(Uri uri) throws Exception {
        String name = null; long size = -1;
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME); int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameIndex >= 0) name = cursor.getString(nameIndex); if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex);
            }
        }
        String mime = getContext().getContentResolver().getType(uri);
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(getContext(), uri);
            long durationMs = parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            int width = (int) parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            int height = (int) parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
            int rotation = (int) parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION));
            if (rotation == 90 || rotation == 270) { int swap = width; width = height; height = swap; }
            if (name == null || size < 0 || durationMs <= 0 || width <= 0 || height <= 0) throw new IllegalStateException("Required metadata unavailable");
            JSObject value = new JSObject(); value.put("filename", name); value.put("fileSize", size); value.put("duration", durationMs / 1000.0);
            value.put("width", width); value.put("height", height); value.put("resolution", width + " × " + height); value.put("mimeType", mime == null ? "Unknown" : mime); value.put("uri", uri.toString()); return value;
        } finally { retriever.release(); }
    }

    private long parseLong(String value) { if (value == null) return 0; try { return Long.parseLong(value); } catch (NumberFormatException ignored) { return 0; } }

    @PluginMethod
    public void exportClip(PluginCall call) {
        String source = call.getString("uri"); Long startMs = call.getLong("startMs"); Long endMs = call.getLong("endMs");
        if (source == null || startMs == null || endMs == null || startMs < 0 || endMs - startMs < 1000) { call.reject("Invalid trim range.", "INVALID_RANGE"); return; }
        cancelled.set(false);
        getBridge().executeOnThreadPool(() -> {
            File temporary = null; Uri output = null;
            try {
                progress("preparing", null);
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw new UnsupportedOperationException("Gallery export requires Android 10 or newer.");
                temporary = File.createTempFile("smartclip-", ".mp4", getContext().getCacheDir());
                long actualDurationMs = remux(Uri.parse(source), temporary, startMs, endMs);
                checkCancelled(); progress("saving", 0);
                String filename = "SmartClip_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date()) + ".mp4";
                ContentValues values = new ContentValues(); values.put(MediaStore.Video.Media.DISPLAY_NAME, filename); values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
                values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/SmartClip"); values.put(MediaStore.Video.Media.IS_PENDING, 1);
                output = getContext().getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
                if (output == null) throw new IllegalStateException("Android could not create the gallery item.");
                long total = temporary.length(), copied = 0; byte[] buffer = new byte[256 * 1024]; int count;
                try (FileInputStream input = new FileInputStream(temporary); OutputStream out = getContext().getContentResolver().openOutputStream(output)) {
                    if (out == null) throw new IllegalStateException("Gallery output is inaccessible.");
                    while ((count = input.read(buffer)) != -1) { checkCancelled(); out.write(buffer, 0, count); copied += count; progress("saving", total == 0 ? null : (int)(copied * 100 / total)); }
                }
                values.clear(); values.put(MediaStore.Video.Media.IS_PENDING, 0); getContext().getContentResolver().update(output, values, null, null);
                progress("completed", 100); JSObject result = new JSObject(); result.put("filename", filename); result.put("duration", actualDurationMs / 1000.0);
                result.put("fileSize", total); result.put("uri", output.toString()); result.put("location", "Movies/SmartClip"); call.resolve(result);
            } catch (InterruptedException error) {
                if (output != null) getContext().getContentResolver().delete(output, null, null); call.reject("Export cancelled.", "CANCELLED");
            } catch (SecurityException error) { call.reject("The selected source is no longer accessible.", "SOURCE_INACCESSIBLE", error);
            } catch (UnsupportedOperationException error) { call.reject(error.getMessage(), "UNSUPPORTED_CODEC", error);
            } catch (Exception error) { if (output != null) getContext().getContentResolver().delete(output, null, null); call.reject("Local export failed. Check available storage and source compatibility.", "EXPORT_FAILED", error);
            } finally { if (temporary != null) temporary.delete(); }
        });
    }

    private long remux(Uri source, File destination, long startMs, long endMs) throws Exception {
        MediaExtractor extractor = new MediaExtractor(); MediaMuxer muxer = null;
        try {
            extractor.setDataSource(getContext(), source, null); int tracks = extractor.getTrackCount(); int[] map = new int[tracks]; int maxSize = 1024 * 1024; boolean video = false;
            muxer = new MediaMuxer(destination.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            for (int index = 0; index < tracks; index++) {
                MediaFormat format = extractor.getTrackFormat(index); String mime = format.getString(MediaFormat.KEY_MIME); map[index] = -1;
                if (mime == null || (!mime.equals("video/avc") && !mime.equals("audio/mp4a-latm"))) {
                    if (mime != null && (mime.startsWith("video/") || mime.startsWith("audio/"))) throw new UnsupportedOperationException("Stream copy supports H.264 video and AAC audio sources.");
                    continue;
                }
                video |= mime.startsWith("video/"); extractor.selectTrack(index); map[index] = muxer.addTrack(format);
                if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) maxSize = Math.max(maxSize, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE));
            }
            if (!video) throw new UnsupportedOperationException("No supported H.264 video track was found.");
            MediaMetadataRetriever metadata = new MediaMetadataRetriever(); try { metadata.setDataSource(getContext(), source); muxer.setOrientationHint((int) parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION))); } finally { metadata.release(); }
            muxer.start(); extractor.seekTo(startMs * 1000, MediaExtractor.SEEK_TO_NEXT_SYNC); ByteBuffer data = ByteBuffer.allocateDirect(maxSize); MediaCodec.BufferInfo info = new MediaCodec.BufferInfo(); long firstUs = -1, endUs = endMs * 1000, lastUs = 0;
            progress("trimming", 0);
            while (true) {
                checkCancelled(); int track = extractor.getSampleTrackIndex(); long sampleUs = extractor.getSampleTime();
                if (track < 0 || sampleUs < 0 || sampleUs > endUs) break;
                if (firstUs < 0) firstUs = sampleUs; info.offset = 0; info.size = extractor.readSampleData(data, 0); if (info.size < 0) break;
                info.presentationTimeUs = sampleUs - firstUs; info.flags = extractor.getSampleFlags(); muxer.writeSampleData(map[track], data, info); lastUs = Math.max(lastUs, info.presentationTimeUs);
                int percent = (int)Math.min(100, Math.max(0, (sampleUs - startMs * 1000) * 100 / Math.max(1, (endMs - startMs) * 1000))); progress("trimming", percent); extractor.advance();
            }
            if (firstUs < 0) throw new IllegalStateException("No media samples exist in this range."); return lastUs / 1000;
        } finally { extractor.release(); if (muxer != null) { try { muxer.stop(); } catch (Exception ignored) {} muxer.release(); } }
    }

    private void checkCancelled() throws InterruptedException { if (cancelled.get()) throw new InterruptedException(); }
    private void progress(String state, Integer percent) { JSObject value = new JSObject(); value.put("state", state); if (percent != null) value.put("progress", percent); notifyListeners("exportProgress", value); }

    @PluginMethod public void cancelExport(PluginCall call) { cancelled.set(true); call.resolve(); }
    @PluginMethod public void openMedia(PluginCall call) { launchMedia(call, false); }
    @PluginMethod public void shareMedia(PluginCall call) { launchMedia(call, true); }
    private void launchMedia(PluginCall call, boolean share) {
        try { Uri uri = Uri.parse(call.getString("uri")); Intent intent = share ? new Intent(Intent.ACTION_SEND) : new Intent(Intent.ACTION_VIEW); intent.setType("video/mp4");
            if (share) intent.putExtra(Intent.EXTRA_STREAM, uri); else intent.setDataAndType(uri, "video/mp4"); intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); getActivity().startActivity(share ? Intent.createChooser(intent, "Share SmartClip") : intent); call.resolve();
        } catch (Exception error) { call.reject("No compatible app is available.", "NO_HANDLER", error); }
    }
}
