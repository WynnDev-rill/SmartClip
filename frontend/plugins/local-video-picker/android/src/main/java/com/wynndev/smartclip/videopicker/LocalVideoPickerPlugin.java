package com.wynndev.smartclip.videopicker;

import android.app.Activity;
import android.content.Intent;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.ContentValues;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.util.Log;
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
import java.io.IOException;
import java.io.OutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.ArrayList;
import java.util.Collections;
import androidx.media3.common.Effect;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.effect.Crop;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.Transformer;
import org.json.JSONObject;
import com.getcapacitor.JSArray;

@CapacitorPlugin(name = "LocalVideoPicker")
public class LocalVideoPickerPlugin extends Plugin {
    private static final String TAG = "SmartClipExport";
    private static final int DEFAULT_ANALYSIS_INTERVAL_MS = 1_000;
    private static final int MINIMUM_ANALYSIS_INTERVAL_MS = 500;
    private static final long DEFAULT_MAX_ANALYSIS_DURATION_MS = 3_600_000L;
    private static final int ANALYSIS_FRAME_WIDTH = 32;
    private static final int ANALYSIS_FRAME_HEIGHT = 18;
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private final AtomicBoolean analysisCancelled = new AtomicBoolean(false);
    private final AtomicBoolean downloadCancelled = new AtomicBoolean(false);
    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();
    private volatile HttpURLConnection activeDownload;
    private final ExecutorService exportExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService analysisExecutor = Executors.newSingleThreadExecutor();
    private Transformer compositionTransformer;

    @PluginMethod
    public void readClipboard(PluginCall call) {
        ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);
        CharSequence text = null;
        if (clipboard != null && clipboard.hasPrimaryClip()) {
            ClipData clip = clipboard.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) text = clip.getItemAt(0).coerceToText(getContext());
        }
        JSObject result = new JSObject(); result.put("value", text == null ? "" : text.toString()); call.resolve(result);
    }

    /** Native HTTPS transport keeps authenticated requests outside WebView CORS. */
    @PluginMethod
    public void backendRequest(PluginCall call) {
        String url = call.getString("url"), method = call.getString("method", "GET"), token = call.getString("token"), body = call.getString("body");
        Integer requestedTimeout = call.getInt("timeoutMs");
        if (url == null || !url.startsWith("https://")) { call.reject("Backend URL must use HTTPS.", "BACKEND_CONFIG"); return; }
        int timeout = Math.max(1_000, Math.min(120_000, requestedTimeout == null ? 75_000 : requestedTimeout));
        try { downloadExecutor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod(method); connection.setConnectTimeout(timeout); connection.setReadTimeout(timeout);
                connection.setRequestProperty("Accept", "application/json");
                if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
                if (body != null) { connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); try (OutputStream out = connection.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); } }
                int status = connection.getResponseCode(); InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String responseBody = ""; if (stream != null) { try (InputStream input = stream; java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) { byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count); responseBody = bytes.toString("UTF-8"); } }
                JSObject result = new JSObject(); result.put("status", status); result.put("body", responseBody); call.resolve(result);
            } catch (SocketTimeoutException error) { call.reject("Backend request timed out.", "TIMEOUT", error);
            } catch (java.net.UnknownHostException error) { call.reject("No internet connection.", "OFFLINE", error);
            } catch (Exception error) { call.reject("Native backend request failed.", "NATIVE_HTTP_FAILED", error);
            } finally { if (connection != null) connection.disconnect(); }
        }); } catch (RejectedExecutionException error) { call.reject("Native HTTP bridge is unavailable.", "NATIVE_HTTP_UNAVAILABLE", error); }
    }

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
        } finally { releaseMediaMetadataRetrieverSafely(retriever); }
    }

    private long parseLong(String value) { if (value == null) return 0; try { return Long.parseLong(value); } catch (NumberFormatException ignored) { return 0; } }

    /** Coarse, bounded analysis: downscaled frame luminance deltas plus audio packet energy. */
    @PluginMethod
    public void analyzeVideo(PluginCall call) {
        String source = call.getString("uri");
        Integer requestedIntervalMs = call.getInt("intervalMs");
        Long requestedMaximumDurationMs = call.getLong("maxDurationMs");
        int intervalMs = Math.max(
            MINIMUM_ANALYSIS_INTERVAL_MS,
            requestedIntervalMs == null ? DEFAULT_ANALYSIS_INTERVAL_MS : requestedIntervalMs
        );
        long maximumDurationMs = requestedMaximumDurationMs == null
            ? DEFAULT_MAX_ANALYSIS_DURATION_MS
            : requestedMaximumDurationMs;
        if (source == null) {
            call.reject("The source URI is unavailable.", "SOURCE_INACCESSIBLE");
            return;
        }
        if (maximumDurationMs <= 0) {
            call.reject("The analysis duration limit must be positive.", "INVALID_ANALYSIS_OPTIONS");
            return;
        }
        analysisCancelled.set(false);
        try {
            analysisExecutor.execute(() -> runAnalysis(call, Uri.parse(source), intervalMs, maximumDurationMs));
        } catch (RejectedExecutionException error) {
            call.reject("The analyzer is unavailable.", "ANALYZER_UNAVAILABLE", error);
        }
    }

    @PluginMethod
    public void cancelAnalysis(PluginCall call) {
        analysisCancelled.set(true);
        call.resolve();
    }

    private void analysisProgress(String state) {
        JSObject event = new JSObject();
        event.put("state", state);
        notifyListeners("analysisProgress", event);
    }

    private void checkAnalysisCancelled() throws InterruptedException {
        if (analysisCancelled.get()) {
            throw new InterruptedException();
        }
    }

    private void runAnalysis(PluginCall call, Uri uri, int intervalMs, long maximumDurationMs) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        MediaExtractor extractor = new MediaExtractor();
        try {
            analysisProgress("preparing");
            retriever.setDataSource(getContext(), uri);
            long durationMs = parseLong(
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
            );
            if (durationMs > maximumDurationMs) {
                call.reject("Video exceeds the 60-minute analysis limit.", "VIDEO_TOO_LONG");
                return;
            }

            int pointCount = (int) Math.ceil((double) durationMs / intervalMs) + 1;
            double[] audioEnergy = new double[pointCount];
            int[] audioSampleCounts = new int[pointCount];
            boolean hasAudio = false;

            analysisProgress("analyzing audio");
            extractor.setDataSource(getContext(), uri, null);
            for (int trackIndex = 0; trackIndex < extractor.getTrackCount(); trackIndex++) {
                MediaFormat format = extractor.getTrackFormat(trackIndex);
                String mimeType = format.getString(MediaFormat.KEY_MIME);
                if (mimeType != null && mimeType.startsWith("audio/")) {
                    extractor.selectTrack(trackIndex);
                    hasAudio = true;
                }
            }
            ByteBuffer packetBuffer = ByteBuffer.allocateDirect(256 * 1024);
            while (hasAudio) {
                checkAnalysisCancelled();
                long sampleTimeUs = extractor.getSampleTime();
                if (sampleTimeUs < 0) break;
                int pointIndex = (int) Math.min(
                    pointCount - 1,
                    sampleTimeUs / 1_000 / intervalMs
                );
                int sampleSize = extractor.readSampleData(packetBuffer, 0);
                if (sampleSize < 0) break;
                audioEnergy[pointIndex] += Math.log1p(sampleSize);
                audioSampleCounts[pointIndex]++;
                extractor.advance();
            }

            analysisProgress("analyzing motion");
            double[] motion = new double[pointCount];
            double[] scene = new double[pointCount];
            double previousLuminance = -1;
            boolean hasMotion = false;
            for (int pointIndex = 0; pointIndex < pointCount; pointIndex++) {
                checkAnalysisCancelled();
                long frameTimeUs = (long) pointIndex * intervalMs * 1_000;
                Bitmap frame = retriever.getFrameAtTime(
                    frameTimeUs,
                    MediaMetadataRetriever.OPTION_CLOSEST_SYNC
                );
                if (frame == null) continue;

                Bitmap thumbnail = null;
                try {
                    thumbnail = Bitmap.createScaledBitmap(
                        frame,
                        ANALYSIS_FRAME_WIDTH,
                        ANALYSIS_FRAME_HEIGHT,
                        true
                    );
                    hasMotion = true;
                    int[] pixels = new int[ANALYSIS_FRAME_WIDTH * ANALYSIS_FRAME_HEIGHT];
                    thumbnail.getPixels(
                        pixels,
                        0,
                        ANALYSIS_FRAME_WIDTH,
                        0,
                        0,
                        ANALYSIS_FRAME_WIDTH,
                        ANALYSIS_FRAME_HEIGHT
                    );
                    double luminance = averageLuminance(pixels);
                    if (previousLuminance >= 0) {
                        motion[pointIndex] = Math.abs(luminance - previousLuminance);
                        scene[pointIndex] = motion[pointIndex] > 0.18
                            ? motion[pointIndex]
                            : 0;
                    }
                    previousLuminance = luminance;
                } finally {
                    if (thumbnail != null && thumbnail != frame && !thumbnail.isRecycled()) {
                        recycleBitmapSafely(thumbnail);
                    }
                    if (!frame.isRecycled()) recycleBitmapSafely(frame);
                }
            }

            analysisProgress("finding boundaries");
            JSArray points = new JSArray();
            for (int pointIndex = 0; pointIndex < pointCount; pointIndex++) {
                checkAnalysisCancelled();
                JSObject point = new JSObject();
                point.put("timeMs", Math.min(durationMs, (long) pointIndex * intervalMs));
                point.put(
                    "audio",
                    audioSampleCounts[pointIndex] > 0
                        ? audioEnergy[pointIndex] / audioSampleCounts[pointIndex]
                        : 0
                );
                point.put("motion", motion[pointIndex]);
                point.put("scene", scene[pointIndex]);
                points.put(point);
            }

            checkAnalysisCancelled();
            analysisProgress("scoring candidates");
            JSObject availability = new JSObject();
            availability.put("audio", hasAudio);
            availability.put("motion", hasMotion);
            availability.put("scene", hasMotion);
            JSObject result = new JSObject();
            result.put("points", points);
            result.put("availability", availability);
            checkAnalysisCancelled();
            analysisProgress("completed");
            call.resolve(result);
        } catch (InterruptedException error) {
            analysisProgress("cancelled");
            call.reject("Analysis cancelled.", "CANCELLED");
        } catch (SecurityException error) {
            analysisProgress("failed");
            call.reject("The source URI is unavailable.", "SOURCE_INACCESSIBLE", error);
        } catch (Exception error) {
            analysisProgress("failed");
            call.reject(
                "The device decoder could not analyze this video.",
                "DECODER_FAILURE",
                error
            );
        } finally {
            releaseMediaExtractorSafely(extractor);
            releaseMediaMetadataRetrieverSafely(retriever);
        }
    }

    private void releaseMediaMetadataRetrieverSafely(MediaMetadataRetriever retriever) {
        try {
            retriever.release();
        } catch (IOException ignored) {
            // Cleanup must not replace an analysis result or an earlier decoder error.
        }
    }

    private void releaseMediaExtractorSafely(MediaExtractor extractor) {
        try {
            extractor.release();
        } catch (RuntimeException ignored) {
            // Continue releasing the remaining analysis resources.
        }
    }

    private void recycleBitmapSafely(Bitmap bitmap) {
        try {
            bitmap.recycle();
        } catch (RuntimeException ignored) {
            // A device bitmap cleanup failure must not abort analysis cleanup.
        }
    }

    private double averageLuminance(int[] pixels) {
        double luminance = 0;
        for (int pixel : pixels) {
            luminance += (
                0.2126 * ((pixel >> 16) & 255)
                + 0.7152 * ((pixel >> 8) & 255)
                + 0.0722 * (pixel & 255)
            ) / 255.0;
        }
        return luminance / pixels.length;
    }

    @PluginMethod
    public void exportClip(PluginCall call) {
        String source = call.getString("uri"); Long startMs = numberAsLong(call, "startMs"); Long endMs = numberAsLong(call, "endMs");
        TrimRange normalized = normalizeTrim(call, source, startMs, endMs); if (normalized == null) return;
        cancelled.set(false);
        try {
            exportExecutor.execute(() -> runExport(call, source, normalized.startMs, normalized.endMs));
        } catch (RejectedExecutionException error) {
            call.reject("The editor is shutting down.", "EDITOR_UNAVAILABLE", error);
        }
    }

    /** Hardware-accelerated decode/effect/encode path. Unlike exportClip, composition cannot stream-copy. */
    @PluginMethod
    public void exportComposition(PluginCall call) {
        String source = call.getString("uri"); Long startMs = numberAsLong(call, "startMs"); Long endMs = numberAsLong(call, "endMs");
        Integer width = call.getInt("outputWidth"); Integer height = call.getInt("outputHeight"); JSObject layout = call.getObject("layout");
        TrimRange normalized = normalizeTrim(call, source, startMs, endMs); if (normalized == null) return;
        final long effectiveStartMs = normalized.startMs; final long effectiveEndMs = normalized.endMs;
        if (width == null || width <= 0) { call.reject("Output width must be a positive number.", "INVALID_OUTPUT_WIDTH"); return; }
        if (height == null || height <= 0) { call.reject("Output height must be a positive number.", "INVALID_OUTPUT_HEIGHT"); return; }
        if (!((width == 720 && height == 1280) || (width == 1080 && height == 1920))) { call.reject("Output dimensions must be 720×1280 or 1080×1920.", "INVALID_OUTPUT_SIZE"); return; }
        if (layout == null) { call.reject("Layout settings are missing.", "INVALID_LAYOUT"); return; }
        JSONObject crop = layout.optJSONObject("gameplayCrop");
        String mode = layout.getString("mode", "smart-crop");
        if (!"smart-crop".equals(mode) && !"fit-background".equals(mode)) {
            call.reject("Split and manual facecam composition are not yet supported by the Android renderer.", "UNSUPPORTED_LAYOUT"); return;
        }
        if (!"fit-background".equals(mode) && !validRect(crop)) { call.reject("Gameplay crop must be a non-zero region inside the source.", "INVALID_GAMEPLAY_CROP"); return; }
        long estimated = (long) width * height * Math.max(1, effectiveEndMs - effectiveStartMs) / 1000;
        if (new StatFs(getContext().getCacheDir().getAbsolutePath()).getAvailableBytes() < Math.max(150_000_000L, estimated)) {
            call.reject("Insufficient storage for a local composition.", "INSUFFICIENT_STORAGE"); return;
        }
        cancelled.set(false); progress("preparing", null);
        File temporary;
        try { temporary = File.createTempFile("smartclip-vertical-", ".mp4", getContext().getCacheDir()); temporary.delete(); }
        catch (Exception error) { call.reject("Unable to prepare local output storage.", "INSUFFICIENT_STORAGE", error); return; }
        MediaItem item = new MediaItem.Builder().setUri(Uri.parse(source)).setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder().setStartPositionMs(effectiveStartMs).setEndPositionMs(effectiveEndMs).build()).build();
        ArrayList<Effect> videoEffects = new ArrayList<>();
        // Crop uses normalized device coordinates. Presentation performs scale-to-fit/crop without stretching.
        if (!"fit-background".equals(mode)) videoEffects.add(new Crop((float)(crop.optDouble("x") * 2 - 1), (float)((crop.optDouble("x") + crop.optDouble("width")) * 2 - 1), (float)(1 - (crop.optDouble("y") + crop.optDouble("height")) * 2), (float)(1 - crop.optDouble("y") * 2)));
        int presentationLayout = "fit-background".equals(mode) ? Presentation.LAYOUT_SCALE_TO_FIT : Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP;
        videoEffects.add(Presentation.createForWidthAndHeight(width, height, presentationLayout));
        EditedMediaItem edited = new EditedMediaItem.Builder(item).setEffects(new Effects(Collections.emptyList(), videoEffects)).build();
        Transformer.Listener listener = new Transformer.Listener() {
            @Override public void onCompleted(androidx.media3.transformer.Composition composition, ExportResult exportResult) {
                compositionTransformer = null; if (cancelled.get()) { temporary.delete(); call.reject("Export cancelled.", "CANCELLED"); return; }
                progress("saving", 0); exportExecutor.execute(() -> publishComposition(call, temporary, effectiveEndMs - effectiveStartMs, width, height));
            }
            @Override public void onError(androidx.media3.transformer.Composition composition, ExportResult exportResult, ExportException error) {
                compositionTransformer = null; temporary.delete();
                if (cancelled.get()) call.reject("Export cancelled.", "CANCELLED");
                else call.reject(error.errorCode == ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ? "The source codec is unsupported by this device." : "Local rendering failed. The device may be low on memory or not support this codec.", "RENDER_FAILED", error);
            }
        };
        compositionTransformer = new Transformer.Builder(getContext()).setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC).addListener(listener).build();
        progress("rendering", 0);
        try { compositionTransformer.start(edited, temporary.getAbsolutePath()); }
        catch (SecurityException error) { temporary.delete(); call.reject("The selected source is no longer accessible.", "SOURCE_INACCESSIBLE", error); }
        catch (RuntimeException error) { temporary.delete(); call.reject("The device could not start the local encoder.", "ENCODER_UNAVAILABLE", error); }
    }

    private Long numberAsLong(PluginCall call, String key) {
        Object value = call.getData().opt(key); return value instanceof Number ? ((Number) value).longValue() : null;
    }

    private TrimRange normalizeTrim(PluginCall call, String source, Long startMs, Long endMs) {
        if (source == null || source.isEmpty()) { rejectTrim(call, "source_unreadable", 0, startMs, endMs); return null; }
        long durationMs;
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try { retriever.setDataSource(getContext(), Uri.parse(source)); durationMs = parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)); }
        catch (SecurityException error) { rejectTrim(call, "uri_access_lost", 0, startMs, endMs); return null; }
        catch (Exception error) { rejectTrim(call, "source_unreadable", 0, startMs, endMs); return null; }
        finally { releaseMediaMetadataRetrieverSafely(retriever); }
        if (durationMs <= 0) { rejectTrim(call, "source_duration_unavailable", durationMs, startMs, endMs); return null; }
        String code = TrimRange.validationCode(startMs, endMs, durationMs);
        if (code != null) { rejectTrim(call, code, durationMs, startMs, endMs); return null; }
        long effectiveEnd = Math.min(endMs, durationMs);
        Log.i(TAG, "durationMs=" + durationMs + " startMs=" + startMs + " endMs=" + endMs + " nativeDurationMs=" + durationMs + " validation=ok");
        return new TrimRange(startMs, effectiveEnd);
    }

    private void rejectTrim(PluginCall call, String code, long durationMs, Long startMs, Long endMs) {
        Log.w(TAG, "durationMs=" + durationMs + " startMs=" + startMs + " endMs=" + endMs + " nativeDurationMs=" + durationMs + " validation=" + code);
        call.reject("Invalid local export range.", code.toUpperCase(Locale.US));
    }

    private boolean validRect(JSONObject rect) {
        if (rect == null) return false;
        double x=rect.optDouble("x", Double.NaN), y=rect.optDouble("y", Double.NaN), w=rect.optDouble("width", Double.NaN), h=rect.optDouble("height", Double.NaN);
        return Double.isFinite(x) && Double.isFinite(y) && Double.isFinite(w) && Double.isFinite(h) && x >= 0 && y >= 0 && w >= .02 && h >= .02 && x+w <= 1.000001 && y+h <= 1.000001;
    }

    private void publishComposition(PluginCall call, File temporary, long durationMs, int width, int height) {
        Uri output = null;
        try {
            checkCancelled(); String filename = "SmartClip_Vertical_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date()) + ".mp4";
            ContentValues values = new ContentValues(); values.put(MediaStore.Video.Media.DISPLAY_NAME, filename); values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4"); values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/SmartClip"); values.put(MediaStore.Video.Media.IS_PENDING, 1);
            output=getContext().getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,values); if(output==null)throw new IllegalStateException("Android could not create the gallery item.");
            long total=temporary.length(),copied=0;byte[] buffer=new byte[256*1024];int count;
            try(FileInputStream input=new FileInputStream(temporary);OutputStream out=getContext().getContentResolver().openOutputStream(output)){if(out==null)throw new IllegalStateException("Gallery output is inaccessible.");while((count=input.read(buffer))!=-1){checkCancelled();out.write(buffer,0,count);copied+=count;progress("saving",total==0?null:(int)(copied*100/total));}}
            values.clear();values.put(MediaStore.Video.Media.IS_PENDING,0);getContext().getContentResolver().update(output,values,null,null);progress("completed",100);
            JSObject result=new JSObject();result.put("filename",filename);result.put("duration",durationMs/1000.0);result.put("fileSize",total);result.put("uri",output.toString());result.put("location","Movies/SmartClip");result.put("width",width);result.put("height",height);call.resolve(result);
        } catch(InterruptedException error){if(output!=null)getContext().getContentResolver().delete(output,null,null);call.reject("Export cancelled.","CANCELLED");}
        catch(Exception error){if(output!=null)getContext().getContentResolver().delete(output,null,null);call.reject("Saving failed. Check available storage.","SAVE_FAILED",error);}
        finally{temporary.delete();}
    }

    private void runExport(PluginCall call, String source, long startMs, long endMs) {
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

    @Override
    protected void handleOnDestroy() {
        cancelled.set(true);
        exportExecutor.shutdownNow();
        analysisCancelled.set(true); analysisExecutor.shutdownNow();
        downloadCancelled.set(true); if (activeDownload != null) activeDownload.disconnect(); downloadExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void cancelExport(PluginCall call) {
        cancelled.set(true);
        if (compositionTransformer != null) { compositionTransformer.cancel(); compositionTransformer = null; }
        call.resolve();
    }

    @PluginMethod
    public void downloadUrlVideo(PluginCall call) {
        String url = call.getString("url"), token = call.getString("token"), requestedName = call.getString("filename");
        if (url == null || !url.startsWith("https://") || token == null || token.isEmpty()) { call.reject("The authenticated HTTPS download is not configured.", "DOWNLOAD_CONFIG"); return; }
        String safeName = sanitizeDownloadName(requestedName); downloadCancelled.set(false);
        try { downloadExecutor.execute(() -> runUrlDownload(call, url, token, safeName)); } catch (RejectedExecutionException error) { call.reject("The downloader is unavailable.", "DOWNLOAD_UNAVAILABLE", error); }
    }
    private String sanitizeDownloadName(String value) { String name = value == null ? "SmartClip.mp4" : value.replaceAll("[^A-Za-z0-9._-]", "_"); if (!name.toLowerCase(Locale.US).endsWith(".mp4")) name += ".mp4"; if (name.length() > 100) name = name.substring(0, 96) + ".mp4"; return name; }
    private void runUrlDownload(PluginCall call, String url, String token, String filename) {
        Uri output = null; HttpURLConnection connection = null;
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw new UnsupportedOperationException("Downloads require Android 10 or newer.");
            connection = (HttpURLConnection) new URL(url).openConnection(); activeDownload = connection; connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(60_000); connection.setReadTimeout(120_000); connection.setRequestProperty("Authorization", "Bearer " + token); connection.setRequestProperty("Accept", "video/mp4");
            int status = connection.getResponseCode(); if (status != 200) throw new IOException(status == 401 ? "Server authentication failed." : status == 410 ? "The temporary clip has expired." : "Download server returned HTTP " + status + "."); long total = connection.getContentLengthLong();
            ContentValues values = new ContentValues(); values.put(MediaStore.Video.Media.DISPLAY_NAME, filename); values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4"); values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/SmartClip"); values.put(MediaStore.Video.Media.IS_PENDING, 1); output = getContext().getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values); if (output == null) throw new IOException("Android could not create the gallery item.");
            long copied = 0; byte[] buffer = new byte[256 * 1024]; int count; try (InputStream input = connection.getInputStream(); OutputStream out = getContext().getContentResolver().openOutputStream(output)) { if (out == null) throw new IOException("Gallery output is inaccessible."); while ((count = input.read(buffer)) != -1) { if (downloadCancelled.get()) throw new InterruptedException(); out.write(buffer, 0, count); copied += count; JSObject event = new JSObject(); event.put("filename", filename); if (total > 0) event.put("progress", (int)(copied * 100 / total)); notifyListeners("downloadProgress", event); } }
            values.clear(); values.put(MediaStore.Video.Media.IS_PENDING, 0); getContext().getContentResolver().update(output, values, null, null); JSObject result = new JSObject(); result.put("filename", filename); result.put("fileSize", copied); result.put("uri", output.toString()); result.put("location", "Movies/SmartClip"); call.resolve(result);
        } catch (InterruptedException error) { if (output != null) getContext().getContentResolver().delete(output, null, null); call.reject("Download cancelled.", "CANCELLED"); } catch (Exception error) { if (output != null) getContext().getContentResolver().delete(output, null, null); call.reject(error.getMessage() == null ? "Download or MediaStore save failed. Check storage and retry." : error.getMessage(), "DOWNLOAD_FAILED", error); } finally { activeDownload = null; if (connection != null) connection.disconnect(); }
    }
    @PluginMethod public void cancelDownload(PluginCall call) { downloadCancelled.set(true); HttpURLConnection connection = activeDownload; if (connection != null) connection.disconnect(); call.resolve(); }

    @PluginMethod
    public void openMedia(PluginCall call) {
        launchMedia(call, false);
    }

    @PluginMethod
    public void shareMedia(PluginCall call) {
        launchMedia(call, true);
    }

    private void launchMedia(PluginCall call, boolean share) {
        Activity activity = getActivity();
        String uriValue = call.getString("uri");
        if (activity == null) {
            call.reject("SmartClip is not currently attached to an Android activity.", "ACTIVITY_UNAVAILABLE");
            return;
        }
        if (uriValue == null) {
            call.reject("The exported video URI is missing.", "INVALID_MEDIA_URI");
            return;
        }

        Uri uri = Uri.parse(uriValue);
        if (!"content".equals(uri.getScheme()) || uri.getAuthority() == null) {
            call.reject("The exported video URI is invalid.", "INVALID_MEDIA_URI");
            return;
        }

        Intent mediaIntent;
        if (share) {
            mediaIntent = new Intent(Intent.ACTION_SEND);
            mediaIntent.setType("video/mp4");
            mediaIntent.putExtra(Intent.EXTRA_STREAM, uri);
        } else {
            mediaIntent = new Intent(Intent.ACTION_VIEW);
            mediaIntent.setDataAndType(uri, "video/mp4");
        }
        mediaIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        if (mediaIntent.resolveActivity(activity.getPackageManager()) == null) {
            call.reject("No compatible app is available.", "NO_HANDLER");
            return;
        }

        try {
            Intent launchIntent = share
                ? Intent.createChooser(mediaIntent, "Share SmartClip")
                : mediaIntent;
            activity.startActivity(launchIntent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("No compatible app is available.", "NO_HANDLER", error);
        }
    }
}
