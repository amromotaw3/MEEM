const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// وظيفة لتحميل ملف .env يدوياً
function loadEnv() {
    const envPath = path.join(__dirname, "../.env");
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, "utf8");
        envConfig.split("\n").forEach(line => {
            const [key, value] = line.split("=");
            if (key && value) {
                process.env[key.trim()] = value.trim();
            }
        });
        console.log("✅ Loaded GH_TOKEN from .env file");
    }
}

loadEnv();

if (!process.env.GH_TOKEN) {
    console.error("❌ Error: GH_TOKEN not found in .env or environment variables.");
    process.exit(1);
}

function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { 
            stdio: "inherit", 
            shell: true,
            env: process.env 
        });
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command failed with code ${code}`));
        });
    });
}

const https = require("https");
const pkg = require("../package.json");

async function publishDraftRelease(version) {
    const token = process.env.GH_TOKEN;
    const tag = `v${version}`;
    
    return new Promise((resolve) => {
        const options = {
            hostname: "api.github.com",
            path: "/repos/amromotaw3/MEEM-Landing/releases",
            method: "GET",
            headers: {
                "User-Agent": "MEEM-Release-Script",
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github+json"
            }
        };

        const req = https.request(options, (res) => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
                try {
                    const releases = JSON.parse(body);
                    if (Array.isArray(releases)) {
                        const release = releases.find(r => r.tag_name === tag || r.name?.includes(version));
                        if (release && release.draft) {
                            console.log(`🚀 Publishing draft release ID ${release.id} (tag: ${tag}) to LIVE...`);
                            const patchData = JSON.stringify({ draft: false, tag_name: tag });
                            const patchReq = https.request({
                                hostname: "api.github.com",
                                path: `/repos/amromotaw3/MEEM-Landing/releases/${release.id}`,
                                method: "PATCH",
                                headers: {
                                    "User-Agent": "MEEM-Release-Script",
                                    "Authorization": `Bearer ${token}`,
                                    "Accept": "application/vnd.github+json",
                                    "Content-Type": "application/json",
                                    "Content-Length": Buffer.byteLength(patchData)
                                }
                            }, () => {
                                console.log(`✅ Release ${tag} is now LIVE on GitHub Releases!`);
                                resolve();
                            });
                            patchReq.on("error", () => resolve());
                            patchReq.write(patchData);
                            patchReq.end();
                            return;
                        }
                    }
                    resolve();
                } catch (e) {
                    resolve();
                }
            });
        });
        req.on("error", () => resolve());
        req.end();
    });
}

async function start() {
    try {
        console.log(`🛠️ Starting Windows Build & Publish for v${pkg.version}...`);
        await runCommand("npx", ["electron-builder", "--win", "nsis", "-p", "always"]);
        await publishDraftRelease(pkg.version);

        console.log("🎉 Windows Release completed successfully!");
    } catch (error) {
        console.error(`❌ Release process failed: ${error.message}`);
        process.exit(1);
    }
}

start();
