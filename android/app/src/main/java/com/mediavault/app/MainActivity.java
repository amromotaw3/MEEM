package com.mediavault.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity for MediaVault.
 *
 * Uses the internal HTML5 video player served via localhost
 * to bypass Android's file:// CORS restrictions.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register local server plugin for serving video files via http://localhost
        registerPlugin(LocalServerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
