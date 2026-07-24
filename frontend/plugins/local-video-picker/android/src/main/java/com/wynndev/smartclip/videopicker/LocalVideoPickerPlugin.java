package com.wynndev.smartclip.videopicker;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LocalVideoPicker")
public class LocalVideoPickerPlugin extends Plugin {
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
}
