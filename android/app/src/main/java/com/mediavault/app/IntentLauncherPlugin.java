package com.mediavault.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * IntentLauncherPlugin — Custom Capacitor plugin for MediaVault.
 *
 * Provides native Android Intent capabilities that are impossible
 * via Capacitor's standard AppLauncher:
 *
 * 1. launchUrl:  Fire an ACTION_VIEW intent for any URI scheme
 *                (magnet:, http:, file:, content:, etc.)
 *                with proper flags (FLAG_ACTIVITY_NEW_TASK,
 *                FLAG_GRANT_READ_URI_PERMISSION).
 *
 * 2. openFile:   Open a local file via FileProvider content:// URI
 *                with the correct MIME type and read permissions
 *                so external players (VLC, MX Player) can read it.
 */
@CapacitorPlugin(name = "IntentLauncher")
public class IntentLauncherPlugin extends Plugin {

    /**
     * Launch an ACTION_VIEW intent for any URL/URI.
     * Works with magnet:, http:, https:, file:, content:// etc.
     *
     * JS usage:
     *   const { IntentLauncher } = window.Capacitor.Plugins;
     *   await IntentLauncher.launchUrl({ url: 'magnet:?xt=...' });
     */
    @PluginMethod
    public void launchUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Must provide a url");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            // For magnet: links, add the torrent MIME type hint
            if (url.startsWith("magnet:")) {
                // Don't set a MIME type for magnets — it causes issues
                // The torrent client will handle the magnet URI directly
            }

            getActivity().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("completed", true);
            call.resolve(ret);
        } catch (ActivityNotFoundException e) {
            JSObject ret = new JSObject();
            ret.put("completed", false);
            ret.put("error", "No app found to handle this link");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to launch intent: " + e.getMessage(), e);
        }
    }

    /**
     * Open a local file in an external app using FileProvider.
     * Automatically generates a content:// URI with read permission
     * so external players can access the file.
     *
     * JS usage:
     *   const { IntentLauncher } = window.Capacitor.Plugins;
     *   await IntentLauncher.openFile({
     *       filePath: '/storage/emulated/0/Documents/MediaVault/movie.mp4',
     *       contentType: 'video/mp4'
     *   });
     */
    @PluginMethod
    public void openFile(PluginCall call) {
        String filePath = call.getString("filePath");
        String contentType = call.getString("contentType", "video/*");

        if (filePath == null || filePath.isEmpty()) {
            call.reject("Must provide a filePath");
            return;
        }

        // Strip file:// prefix if present
        if (filePath.startsWith("file://")) {
            filePath = filePath.substring(7);
        }

        // Handle content:// URIs directly (already a sharable URI)
        if (filePath.startsWith("content://")) {
            try {
                Uri contentUri = Uri.parse(filePath);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(contentUri, contentType);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);

                JSObject ret = new JSObject();
                ret.put("completed", true);
                call.resolve(ret);
                return;
            } catch (Exception e) {
                call.reject("Failed to open content URI: " + e.getMessage(), e);
                return;
            }
        }

        File file = new File(filePath);
        if (!file.exists()) {
            call.reject("File not found: " + filePath, "FILE_NOT_FOUND");
            return;
        }

        try {
            Context context = getActivity().getApplicationContext();

            // Try the app's main FileProvider first, then the file-opener provider
            Uri contentUri = null;
            String[] authorities = {
                getActivity().getPackageName() + ".fileprovider",
                getActivity().getPackageName() + ".file.opener.provider"
            };

            for (String authority : authorities) {
                try {
                    contentUri = FileProvider.getUriForFile(context, authority, file);
                    break;
                } catch (IllegalArgumentException e) {
                    // This authority doesn't cover the file path, try next
                }
            }

            if (contentUri == null) {
                call.reject("Could not generate content URI for: " + filePath);
                return;
            }

            // Auto-detect MIME type if not provided or generic
            if (contentType == null || contentType.equals("video/*") || contentType.equals("*/*")) {
                String ext = MimeTypeMap.getFileExtensionFromUrl(
                    Uri.fromFile(file).toString()
                );
                if (ext != null) {
                    String detectedType = MimeTypeMap.getSingleton()
                        .getMimeTypeFromExtension(ext.toLowerCase());
                    if (detectedType != null) {
                        contentType = detectedType;
                    }
                }
            }

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, contentType);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getActivity().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("completed", true);
            call.resolve(ret);
        } catch (ActivityNotFoundException e) {
            JSObject ret = new JSObject();
            ret.put("completed", false);
            ret.put("error", "No app found to open this file type");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to open file: " + e.getMessage(), e);
        }
    }
}
