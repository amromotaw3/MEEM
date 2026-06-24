const fs = require("fs");
const path = require("path");

async function upload() {
    try {
        const token = process.env.GH_TOKEN;
        if (!token) {
            console.error("❌ Error: GH_TOKEN is not set.");
            process.exit(1);
        }

        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
        const tagName = `v${pkg.version}`;
        const repoOwner = "amromotaw3";
        const repoName = "MediaVault-Landing"; 
        const apkPath = path.join(__dirname, "../android/app/build/outputs/bundle/release/release/app-release.apk");

        if (!fs.existsSync(apkPath)) {
            console.error("❌ Error: APK file not found at " + apkPath);
            process.exit(1);
        }

        console.log(`🚀 Finding release for tag ${tagName}...`);
        
        let release = null;
        for (let i = 0; i < 5; i++) {
            try {
                const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/releases/tags/${tagName}`, {
                    headers: { Authorization: `token ${token}` }
                });
                const data = await response.json();
                if (data.id) {
                    release = data;
                    break;
                }
                
                // Fallback: search in list of releases
                const listResponse = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/releases`, {
                    headers: { Authorization: `token ${token}` }
                });
                const releases = await listResponse.json();
                if (Array.isArray(releases)) {
                    release = releases.find(r => r.tag_name === tagName || r.name.includes(pkg.version));
                    if (release) break;
                }

                console.log(`⏳ Release not found yet, retrying in 3s... (${i+1}/5)`);
                await new Promise(r => setTimeout(r, 3000));
            } catch (err) {
                console.log("⚠️ Connection error, retrying...");
            }
        }

        if (!release || !release.id) {
            console.error("❌ Error: Could not find the release on GitHub after several attempts.");
            process.exit(1);
        }

        console.log(`📦 Found release: ${release.name} (ID: ${release.id})`);
        
        const fileName = `${pkg.productName || pkg.name}.apk`;
        console.log(`📤 Uploading APK as: ${fileName}...`);

        const stats = fs.statSync(apkPath);
        const uploadUrl = `https://uploads.github.com/repos/${repoOwner}/${repoName}/releases/${release.id}/assets?name=${fileName}`;

        const uploadResponse = await fetch(uploadUrl, {
            method: "POST",
            headers: {
                Authorization: `token ${token}`,
                "Content-Type": "application/vnd.android.package-archive",
                "Content-Length": stats.size
            },
            body: fs.createReadStream(apkPath)
        });

        const result = await uploadResponse.json();
        if (result.id) {
            console.log("✅ APK uploaded successfully!");
        } else {
            console.error("❌ Upload failed:", result);
        }
    } catch (error) {
        console.error("❌ Error during upload:", error);
    }
}

upload();
