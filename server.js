const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/extract', async (req, res) => {
    const vidUrl = req.query.url;
    if (!vidUrl) return res.json({ error: "Missing URL" });

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process'
            ]
        });

        const page = await browser.newPage();
        let foundM3u8 = null;

        // Bắt link m3u8 từ traffic
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.m3u8') || url.includes('bTN1OA==')) {
                foundM3u8 = url;
            }
            request.continue();
        });

        await page.goto(vidUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        if (foundM3u8) {
            res.json({ streamUrl: foundM3u8.replace(/\\\//g, '/') });
        } else {
            res.status(404).json({ error: "Not found m3u8" });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
