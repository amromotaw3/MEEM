package com.meem.app.downloader;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * MEEM Android Native Downloader Plugin
 * Robust, non-blocking background downloading for mobile with real-time progress events
 */
@CapacitorPlugin(name = "MeemDownloader")
public class MeemDownloaderPlugin extends Plugin {

    private static final String TAG = "MeemDownloader";
    private static final String CHANNEL_ID = "meem_downloads_channel";

    private final ExecutorService executorService = Executors.newFixedThreadPool(4);
    private final ConcurrentHashMap<String, DownloadTask> activeTasks = new ConcurrentHashMap<>();
    private NotificationManager notificationManager;

    @Override
    public void load() {
        super.load();
        initNotificationChannel();
        Log.d(TAG, "MeemDownloaderPlugin loaded successfully.");
    }

    private void initNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Context context = getContext();
                notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "MEEM Downloads",
                        NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Background download progress for MEEM");
                channel.setShowBadge(false);
                if (notificationManager != null) {
                    notificationManager.createNotificationChannel(channel);
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to create notification channel: " + e.getMessage());
            }
        }
    }

    @PluginMethod
    public void startDownload(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            id = "dl_" + System.currentTimeMillis();
        }

        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL parameter is required");
            return;
        }

        String name = call.getString("name");
        if (name == null || name.isEmpty()) {
            name = call.getString("fileName");
            if (name == null || name.isEmpty()) {
                name = "download_" + System.currentTimeMillis();
            }
        }

        String type = call.getString("type", "direct");
        String format = call.getString("format", "video");

        // Magnet / Torrent Handler
        if ("torrent".equalsIgnoreCase(type) || url.startsWith("magnet:") || url.endsWith(".torrent")) {
            handleTorrentDownload(id, name, url, call);
            return;
        }

        // Direct / HTTP / Social Streams
        startDirectDownload(id, name, url, type, format, call);
    }

    private void handleTorrentDownload(String id, String name, String magnetUrl, PluginCall call) {
        try {
            // Emit starting progress
            emitProgress(id, name, "resolving", 5, 0, 0, "0 B/s", "--:--", "Opening Torrent Stream...");

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setData(Uri.parse(magnetUrl));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Context context = getContext();
            if (intent.resolveActivity(context.getPackageManager()) != null) {
                context.startActivity(intent);
                emitProgress(id, name, "completed", 100, 0, 0, "0 B/s", "00:00", "Torrent sent to Player");
            } else {
                emitProgress(id, name, "completed", 100, 0, 0, "0 B/s", "00:00", "Magnet ready");
            }

            JSObject res = new JSObject();
            res.put("id", id);
            res.put("status", "completed");
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "Torrent handling failed: " + e.getMessage());
            emitError(id, name, e.getMessage());
            call.reject("Failed to handle torrent link: " + e.getMessage());
        }
    }

    private void startDirectDownload(String id, String name, String downloadUrl, String type, String format, PluginCall call) {
        DownloadTask task = new DownloadTask(id, name, downloadUrl);
        activeTasks.put(id, task);

        Future<?> future = executorService.submit(() -> {
            executeDownload(task);
        });
        task.setFuture(future);

        JSObject res = new JSObject();
        res.put("id", id);
        res.put("status", "started");
        call.resolve(res);
    }

    private void executeDownload(DownloadTask task) {
        HttpURLConnection connection = null;
        InputStream input = null;
        OutputStream output = null;

        try {
            emitProgress(task.id, task.name, "resolving", 2, 0, 0, "0 B/s", "--:--", "Connecting to server...");

            URL url = new URL(task.url);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/124.0.0.0");

            int responseCode = connection.getResponseCode();
            // Handle redirects manually if needed (301, 302, 303, 307, 308)
            if (responseCode == HttpURLConnection.HTTP_MOVED_PERM ||
                responseCode == HttpURLConnection.HTTP_MOVED_TEMP ||
                responseCode == HttpURLConnection.HTTP_SEE_OTHER ||
                responseCode == 307 || responseCode == 308) {
                
                String newUrl = connection.getHeaderField("Location");
                if (newUrl != null && !newUrl.isEmpty()) {
                    connection.disconnect();
                    url = new URL(newUrl);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(30000);
                    connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/124.0.0.0");
                    responseCode = connection.getResponseCode();
                }
            }

            if (responseCode != HttpURLConnection.HTTP_OK && responseCode != HttpURLConnection.HTTP_PARTIAL) {
                throw new Exception("Server returned HTTP " + responseCode + " " + connection.getResponseMessage());
            }

            long totalBytes = connection.getContentLengthLong();
            if (totalBytes <= 0) {
                String cl = connection.getHeaderField("Content-Length");
                if (cl != null) {
                    try { totalBytes = Long.parseLong(cl); } catch (Exception ignored) {}
                }
            }

            // Target destination directory: Documents/MEEM/Downloads
            File baseDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
            File meemDir = new File(baseDir, "MEEM/Downloads");
            if (!meemDir.exists()) {
                meemDir.mkdirs();
            }

            // Sanitize file name
            String safeFileName = task.name.replaceAll("[\\\\/:*?\"<>|]", "_");
            if (!safeFileName.contains(".")) {
                String contentType = connection.getContentType();
                if (contentType != null) {
                    if (contentType.contains("audio") || contentType.contains("mp3")) safeFileName += ".mp3";
                    else if (contentType.contains("video/mp4")) safeFileName += ".mp4";
                    else if (contentType.contains("video/webm")) safeFileName += ".webm";
                    else safeFileName += ".mp4";
                } else {
                    safeFileName += ".mp4";
                }
            }

            File targetFile = new File(meemDir, safeFileName);
            task.setTargetFile(targetFile);

            input = new BufferedInputStream(connection.getInputStream(), 64 * 1024);
            output = new FileOutputStream(targetFile);

            byte[] buffer = new byte[64 * 1024];
            long downloadedBytes = 0;
            int count;
            long lastEmitTime = System.currentTimeMillis();
            long lastEmitBytes = 0;

            emitProgress(task.id, task.name, "downloading", 5, 0, totalBytes, "0 B/s", "--:--", "Downloading...");

            while ((count = input.read(buffer)) != -1) {
                if (task.isCancelled()) {
                    emitProgress(task.id, task.name, "cancelled", 0, downloadedBytes, totalBytes, "0 B/s", "00:00", "Cancelled");
                    try { if (targetFile.exists()) targetFile.delete(); } catch (Exception ignored) {}
                    return;
                }

                while (task.isPaused()) {
                    Thread.sleep(300);
                    if (task.isCancelled()) return;
                }

                output.write(buffer, 0, count);
                downloadedBytes += count;

                long now = System.currentTimeMillis();
                if (now - lastEmitTime >= 500) { // Emit throttled progress twice a second
                    double elapsedSec = Math.max(0.1, (now - lastEmitTime) / 1000.0);
                    long bytesDiff = downloadedBytes - lastEmitBytes;
                    double speedBytesPerSec = bytesDiff / elapsedSec;
                    String speedStr = formatBytes((long) speedBytesPerSec) + "/s";

                    float percent = totalBytes > 0 ? (downloadedBytes * 100.0f / totalBytes) : 50.0f;
                    String etaStr = "--:--";
                    if (totalBytes > downloadedBytes && speedBytesPerSec > 0) {
                        long remainingSeconds = (long) ((totalBytes - downloadedBytes) / speedBytesPerSec);
                        etaStr = String.format("%02d:%02d", remainingSeconds / 60, remainingSeconds % 60);
                    }

                    emitProgress(task.id, task.name, "downloading", percent, downloadedBytes, totalBytes, speedStr, etaStr, "Downloading...");
                    updateNotification(task.id, task.name, (int) percent);

                    lastEmitTime = now;
                    lastEmitBytes = downloadedBytes;
                }
            }

            output.flush();

            // Muxing/Finalizing stage notification
            emitProgress(task.id, task.name, "muxing", 99.5f, downloadedBytes, totalBytes, "Finalizing", "00:00", "Saving file...");
            Thread.sleep(200);

            // Completed!
            emitProgress(task.id, task.name, "completed", 100, downloadedBytes, totalBytes, "0 B/s", "00:00", "Download Complete");
            showCompleteNotification(task.name);

        } catch (Exception e) {
            Log.e(TAG, "Download execution failed for " + task.name + ": " + e.getMessage());
            if (!task.isCancelled()) {
                emitError(task.id, task.name, e.getMessage());
            }
        } finally {
            try { if (input != null) input.close(); } catch (Exception ignored) {}
            try { if (output != null) output.close(); } catch (Exception ignored) {}
            try { if (connection != null) connection.disconnect(); } catch (Exception ignored) {}
            activeTasks.remove(task.id);
        }
    }

    @PluginMethod
    public void pauseDownload(PluginCall call) {
        String id = call.getString("id");
        DownloadTask task = id != null ? activeTasks.get(id) : null;
        if (task != null) {
            task.setPaused(true);
            emitProgress(id, task.name, "paused", task.getLastPercent(), 0, 0, "0 B/s", "--:--", "Paused");
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        } else {
            call.reject("Download task not found");
        }
    }

    @PluginMethod
    public void resumeDownload(PluginCall call) {
        String id = call.getString("id");
        DownloadTask task = id != null ? activeTasks.get(id) : null;
        if (task != null) {
            task.setPaused(false);
            emitProgress(id, task.name, "downloading", task.getLastPercent(), 0, 0, "Resuming", "--:--", "Resuming...");
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        } else {
            call.reject("Download task not found");
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String id = call.getString("id");
        DownloadTask task = id != null ? activeTasks.get(id) : null;
        if (task != null) {
            task.setCancelled(true);
            activeTasks.remove(id);
            emitProgress(id, task.name, "cancelled", 0, 0, 0, "0 B/s", "00:00", "Cancelled");
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        } else {
            JSObject res = new JSObject();
            res.put("success", false);
            call.resolve(res);
        }
    }

    private void emitProgress(String id, String name, String status, float percent, long downloaded, long total, String speed, String eta, String phaseMessage) {
        JSObject data = new JSObject();
        data.put("id", id);
        data.put("name", name);
        data.put("status", status);
        data.put("percent", Math.round(percent * 10.0f) / 10.0f);
        data.put("downloaded", formatBytes(downloaded));
        data.put("downloadedBytes", downloaded);
        data.put("total", total > 0 ? formatBytes(total) : "...");
        data.put("totalBytes", total);
        data.put("speed", speed);
        data.put("eta", eta);
        data.put("phaseMessage", phaseMessage);
        data.put("statusText", phaseMessage + (speed != null && !speed.isEmpty() ? " (" + speed + ")" : ""));

        notifyListeners("downloadProgress", data);
    }

    private void emitError(String id, String name, String errorMsg) {
        JSObject data = new JSObject();
        data.put("id", id);
        data.put("name", name);
        data.put("status", "error");
        data.put("percent", 0);
        data.put("error", errorMsg);
        data.put("statusText", "Error: " + errorMsg);

        notifyListeners("downloadProgress", data);
    }

    private void updateNotification(String id, String title, int percent) {
        if (notificationManager == null) return;
        try {
            NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.stat_sys_download)
                    .setContentTitle("MEEM: Downloading")
                    .setContentText(title)
                    .setProgress(100, percent, false)
                    .setOngoing(true)
                    .setOnlyAlertOnce(true);

            notificationManager.notify(id.hashCode(), builder.build());
        } catch (Exception ignored) {}
    }

    private void showCompleteNotification(String title) {
        if (notificationManager == null) return;
        try {
            NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle("MEEM: Download Complete")
                    .setContentText(title)
                    .setAutoCancel(true);

            notificationManager.notify((int) System.currentTimeMillis(), builder.build());
        } catch (Exception ignored) {}
    }

    private static String formatBytes(long bytes) {
        if (bytes <= 0) return "0 B";
        final String[] units = new String[]{"B", "KB", "MB", "GB", "TB"};
        int digitGroups = (int) (Math.log10(bytes) / Math.log10(1024));
        if (digitGroups >= units.length) digitGroups = units.length - 1;
        return String.format("%.1f %s", bytes / Math.pow(1024, digitGroups), units[digitGroups]);
    }

    private static class DownloadTask {
        final String id;
        final String name;
        final String url;
        private volatile boolean isPaused = false;
        private volatile boolean isCancelled = false;
        private volatile float lastPercent = 0f;
        private Future<?> future;
        private File targetFile;

        DownloadTask(String id, String name, String url) {
            this.id = id;
            this.name = name;
            this.url = url;
        }

        void setFuture(Future<?> future) { this.future = future; }
        void setTargetFile(File file) { this.targetFile = file; }
        boolean isPaused() { return isPaused; }
        void setPaused(boolean paused) { this.isPaused = paused; }
        boolean isCancelled() { return isCancelled; }
        void setCancelled(boolean cancelled) {
            this.isCancelled = cancelled;
            if (future != null) future.cancel(true);
        }
        float getLastPercent() { return lastPercent; }
    }
}
