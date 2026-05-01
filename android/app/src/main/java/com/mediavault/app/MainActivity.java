package com.mediavault.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;

/**
 * MainActivity for MediaVault.
 *
 * Registers the custom IntentLauncher plugin and configures the
 * WebView to handle non-standard URL schemes (magnet:, intent://)
 * by delegating to the OS intent resolver.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom plugins BEFORE super.onCreate (Capacitor 5+ requirement)
        registerPlugin(IntentLauncherPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
