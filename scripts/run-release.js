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

async function start() {
    try {
        console.log("🛠️ Starting Windows Build & Publish...");
        await runCommand("npx", ["electron-builder", "--win", "nsis", "-p", "always"]);

        console.log("🎉 Windows Release completed successfully!");
    } catch (error) {
        console.error(`❌ Release process failed: ${error.message}`);
        process.exit(1);
    }
}

start();
