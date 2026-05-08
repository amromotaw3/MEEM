package com.mediavault.app;

import android.content.Context;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

@CapacitorPlugin(name = "LocalServer")
public class LocalServerPlugin extends Plugin {

    private static final int DEFAULT_PORT = 8976;
    private VideoServer server;
    private int activePort = DEFAULT_PORT;

    @PluginMethod
    public void start(PluginCall call) {
        int port = call.getInt("port", DEFAULT_PORT);

        if (server != null && server.isAlive()) {
            JSObject ret = new JSObject();
            ret.put("url", "http://localhost:" + activePort);
            ret.put("port", activePort);
            ret.put("running", true);
            call.resolve(ret);
            return;
        }

        try {
            activePort = port;
            server = new VideoServer(port, getContext());
            server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);

            JSObject ret = new JSObject();
            ret.put("url", "http://localhost:" + port);
            ret.put("port", port);
            ret.put("running", true);
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("Failed to start local server: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (server != null) {
            server.stop();
            server = null;
        }
        JSObject ret = new JSObject();
        ret.put("running", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void serveFile(PluginCall call) {
        String filePath = call.getString("path");
        if (filePath == null || filePath.isEmpty()) {
            call.reject("Must provide a file path");
            return;
        }

        long fileSize = 0;
        String mimeType = "video/mp4";
        String resolvedName = "video.mp4";

        boolean isContentUri = filePath.startsWith("content://");

        if (isContentUri) {
            Uri uri = Uri.parse(filePath);
            try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (sizeIndex != -1) fileSize = cursor.getLong(sizeIndex);
                    if (nameIndex != -1) resolvedName = cursor.getString(nameIndex);
                }
            } catch (Exception e) {
                call.reject("Failed to read content URI: " + e.getMessage());
                return;
            }
            mimeType = getContext().getContentResolver().getType(uri);
            if (mimeType == null) mimeType = guessMimeType(resolvedName);
        } else {
            // It's a file:// or absolute path
            if (filePath.startsWith("file://")) {
                filePath = filePath.substring(7);
            }
            try {
                filePath = URLDecoder.decode(filePath, "UTF-8");
            } catch (Exception e) {
                // Ignore fallback
            }

            File file = new File(filePath);
            if (!file.exists()) {
                call.reject("File not found: " + filePath, "FILE_NOT_FOUND");
                return;
            }
            if (!file.canRead()) {
                call.reject("File not readable: " + filePath, "FILE_NOT_READABLE");
                return;
            }

            fileSize = file.length();
            resolvedName = file.getName();
            mimeType = guessMimeType(resolvedName);
        }

        if (server == null || !server.isAlive()) {
            try {
                server = new VideoServer(activePort, getContext());
                server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
            } catch (IOException e) {
                call.reject("Failed to start server: " + e.getMessage(), e);
                return;
            }
        }

        server.setActiveMedia(filePath, isContentUri, fileSize, mimeType);

        JSObject ret = new JSObject();
        ret.put("url", "http://localhost:" + activePort + "/video");
        ret.put("path", filePath);
        ret.put("size", fileSize);
        ret.put("mimeType", mimeType);
        ret.put("running", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", server != null && server.isAlive());
        ret.put("port", activePort);
        call.resolve(ret);
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Must provide a URL");
            return;
        }

        android.util.Log.d("LocalServer", "Opening URL: " + url);
        final Context context = getContext();
        
        try {
            android.net.Uri uri = android.net.Uri.parse(url);
            final android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW, uri);
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            
            // For magnets, ensure CATEGORY_BROWSABLE is present
            if (url.startsWith("magnet:")) {
                intent.addCategory(android.content.Intent.CATEGORY_BROWSABLE);
            } else if (url.startsWith("http") && (url.contains(".mkv") || url.contains(".mp4") || url.contains(".m3u8") || url.contains("stream"))) {
                // If it looks like a video stream, hint the OS to show video players
                intent.setDataAndType(uri, "video/*");
            }

            getActivity().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        android.content.Intent chooser = android.content.Intent.createChooser(intent, "Open Torrent with...");
                        chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(chooser);
                        call.resolve();
                    } catch (Exception ex) {
                        android.util.Log.e("LocalServer", "Chooser failed, trying direct", ex);
                        try {
                            context.startActivity(intent);
                            call.resolve();
                        } catch (Exception ex2) {
                            call.reject("No app found to handle this link. Please install a torrent client.");
                        }
                    }
                }
            });
        } catch (Exception e) {
            android.util.Log.e("LocalServer", "Failed to prepare intent", e);
            call.reject("Failed to open URL: " + e.getMessage());
        }
    }

    private String guessMimeType(String filename) {
        if (filename == null) return "video/mp4";
        String ext = MimeTypeMap.getFileExtensionFromUrl(filename.replace(" ", "%20"));
        if (ext == null || ext.isEmpty()) {
            int dot = filename.lastIndexOf('.');
            if (dot >= 0) ext = filename.substring(dot + 1).toLowerCase();
        }
        if (ext != null) {
            switch (ext.toLowerCase()) {
                case "mkv": return "video/x-matroska";
                case "avi": return "video/x-msvideo";
                case "wmv": return "video/x-ms-wmv";
                case "flv": return "video/x-flv";
                case "ts":  return "video/mp2t";
                case "m4v": return "video/mp4";
                case "3gp": return "video/3gpp";
                case "opus": return "audio/opus";
                case "flac": return "audio/flac";
                case "wma": return "audio/x-ms-wma";
            }
            String mapped = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (mapped != null) return mapped;
        }
        return "video/mp4";
    }

    @Override
    protected void handleOnDestroy() {
        if (server != null) {
            server.stop();
            server = null;
        }
        super.handleOnDestroy();
    }

    private static class VideoServer extends NanoHTTPD {
        private String activePath;
        private boolean isContentUri;
        private long activeSize;
        private String activeMime;
        private Context context;

        VideoServer(int port, Context context) {
            super(port);
            this.context = context;
        }

        void setActiveMedia(String path, boolean isContent, long size, String mime) {
            this.activePath = path;
            this.isContentUri = isContent;
            this.activeSize = size;
            this.activeMime = mime;
        }

        @Override
        public Response serve(IHTTPSession session) {
            Map<String, String> corsHeaders = new HashMap<>();
            corsHeaders.put("Access-Control-Allow-Origin", "*");
            corsHeaders.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            corsHeaders.put("Access-Control-Allow-Headers", "Range");
            corsHeaders.put("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

            if (Method.OPTIONS.equals(session.getMethod())) {
                Response resp = newFixedLengthResponse(Response.Status.OK, "text/plain", "");
                for (Map.Entry<String, String> h : corsHeaders.entrySet()) {
                    resp.addHeader(h.getKey(), h.getValue());
                }
                return resp;
            }

            if (activePath == null) {
                return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "No active media");
            }

            String rangeHeader = session.getHeaders().get("range");

            try {
                if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                    return servePartial(rangeHeader, corsHeaders);
                } else {
                    return serveFull(corsHeaders);
                }
            } catch (Exception e) {
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "Error: " + e.getMessage());
            }
        }

        private InputStream getInputStream() throws IOException {
            if (isContentUri) {
                return context.getContentResolver().openInputStream(Uri.parse(activePath));
            } else {
                return new FileInputStream(new File(activePath));
            }
        }

        private Response serveFull(Map<String, String> corsHeaders) throws IOException {
            InputStream is = getInputStream();
            Response resp = newFixedLengthResponse(Response.Status.OK, activeMime, is, activeSize);
            resp.addHeader("Accept-Ranges", "bytes");
            resp.addHeader("Content-Length", String.valueOf(activeSize));
            for (Map.Entry<String, String> h : corsHeaders.entrySet()) {
                resp.addHeader(h.getKey(), h.getValue());
            }
            return resp;
        }

        private Response servePartial(String rangeHeader, Map<String, String> corsHeaders) throws IOException {
            String rangeValue = rangeHeader.substring("bytes=".length()).trim();
            String[] parts = rangeValue.split("-", 2);

            long start = 0;
            long end = activeSize - 1;

            if (!parts[0].isEmpty()) start = Long.parseLong(parts[0]);
            if (parts.length > 1 && !parts[1].isEmpty()) end = Long.parseLong(parts[1]);

            if (start < 0) start = 0;
            if (end >= activeSize) end = activeSize - 1;
            if (start > end) start = end;

            long contentLength = end - start + 1;
            InputStream is = getInputStream();
            is.skip(start);

            Response resp = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, activeMime, is, contentLength);
            resp.addHeader("Accept-Ranges", "bytes");
            resp.addHeader("Content-Length", String.valueOf(contentLength));
            resp.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + activeSize);
            for (Map.Entry<String, String> h : corsHeaders.entrySet()) {
                resp.addHeader(h.getKey(), h.getValue());
            }
            return resp;
        }
    }
}
