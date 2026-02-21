const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/extract', async (req, res) => {
    const vidUrl = req.query.url;
    if (!vidUrl) return res.status(400).send("Missing URL parameter");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process',
                '--autoplay-policy=no-user-gesture-required',
                '--disable-web-security',
                '--window-size=1280,720'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let foundM3u8 = null;

        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.m3u8') || url.includes('bTN1OA==')) {
                foundM3u8 = url;
            }
            request.continue();
        });

        // Đi tới trang phim
        await page.goto(vidUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        await delay(3000);

        // 🔥 CHIẾN THUẬT "TRẤN LỘT": Ép Player phải chạy
        await page.evaluate(() => {
            try {
                // 1. Tìm và xóa cái lớp overlay "Fetching..." đang che màn hình
                const divs = document.querySelectorAll('div');
                divs.forEach(d => {
                    if (d.innerText && d.innerText.toUpperCase().includes('FETCHING')) {
                        d.style.display = 'none';
                    }
                });

                // 2. Tìm thẻ video: Tắt tiếng (để lách luật Chrome) và ép Play
                const videos = document.querySelectorAll('video');
                videos.forEach(v => {
                    v.muted = true; 
                    v.play().catch(e => console.log(e));
                });

                // 3. Bấm mù tất cả các nút hiển thị trên màn hình
                const buttons = document.querySelectorAll('button');
                buttons.forEach(b => b.click());
            } catch (e) {}
        });

        await delay(1000);

        // 4. Bồi thêm phím Space và Enter
        await page.keyboard.press('Space');
        await delay(500);
        await page.keyboard.press('Enter');

        // Chờ tối đa 15 giây để web giải mã
        let waitTime = 0;
        while (!foundM3u8 && waitTime < 15) {
            await delay(1000);
            waitTime++;
        }

        if (foundM3u8) {
            res.json({ streamUrl: foundM3u8.replace(/\\\//g, '/') });
        } else {
            const base64Screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
            const htmlResponse = `
                <html>
                    <body style="background-color: #222; color: white; text-align: center; font-family: sans-serif;">
                        <h2>Đã xóa lớp Fetching và ép Play nhưng vẫn kẹt!</h2>
                        <img src="data:image/png;base64,${base64Screenshot}" style="border: 2px solid #00ff00; max-width: 90%; margin-top: 20px;" />
                    </body>
                </html>
            `;
            res.status(404).send(htmlResponse);
        }
    } catch (e) {
        res.status(500).send(`Lỗi Server: ${e.message}`);
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`🚀 Server đang chạy ở port ${PORT}`));
