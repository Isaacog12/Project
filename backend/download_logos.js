const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Mapping of University Names to Logo URLs
// Using Clearbit and direct EDU links where available
const universityLogos = {
    "Veritas University, Abuja (VUNA)": "https://vuna.edu.ng/wp-content/uploads/2021/04/vuna-logo.png",
    "Ahmadu Bello University (ABU)": "https://abu.edu.ng/wp-content/uploads/2020/07/abu_logo_new.png",
    "University of Lagos (UNILAG)": "https://unilag.edu.ng/wp-content/uploads/unilag-logo.png",
    "University of Ibadan (UI)": "https://ui.edu.ng/sites/default/files/ui-logo_0.png",
    "Covenant University": "https://covenantuniversity.edu.ng/wp-content/uploads/2020/07/cu-logo.png",
    "Obafemi Awolowo University (OAU)": "https://oauife.edu.ng/wp-content/uploads/2018/06/oau_logo.png",
    "University of Nigeria Nsukka (UNN)": "https://www.unn.edu.ng/wp-content/uploads/2015/06/unn-logo.png",
    "Babcock University": "https://www.babcock.edu.ng/assets/img/logo.png",
    "Nile University of Nigeria": "https://www.nileuniversity.edu.ng/wp-content/uploads/2020/06/logo-nile.png",
    "Baze University": "https://bazeuniversity.edu.ng/assets/img/logo.png",
    "Federal University of Technology Akure (FUTA)": "https://www.futa.edu.ng/assets/img/logo.png",
    "University of Benin (UNIBEN)": "https://uniben.edu/wp-content/uploads/2020/06/uniben-logo.png",
    "Lagos State University (LASU)": "https://www.lasu.edu.ng/home/images/logo.png"
};

const assetsDir = path.join(__dirname, 'assets');

if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
}

async function downloadLogo(name, url) {
    const filePath = path.join(assetsDir, `${name}.png`);
    
    // Skip if already exists
    if (fs.existsSync(filePath)) {
        console.log(`✅ ${name} logo already exists.`);
        return;
    }

    try {
        console.log(`⏳ Downloading logo for ${name}...`);
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`✨ Successfully downloaded ${name} logo.`);
                resolve();
            });
            writer.on('error', reject);
        });
    } catch (error) {
        console.error(`❌ Failed to download logo for ${name}: ${error.message}`);
    }
}

async function run() {
    console.log("🚀 Starting University Logo Downloader...");
    for (const [name, url] of Object.entries(universityLogos)) {
        await downloadLogo(name, url);
    }
    console.log("🏁 Download process complete!");
}

run();
