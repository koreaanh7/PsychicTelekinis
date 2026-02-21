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
                '--window-size=1280,720'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Lắng nghe lỗi từ chính trang web để bắt bệnh
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log('🔴 LỖI TỪ TRANG WEB:', msg.text());
            }
        });

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

        // Mô phỏng người dùng: Rê chuột từ từ thay vì click bùp một phát vào giữa
        await delay(3000); // Đợi nó load cái khung Fetching xong
        try {
            // Rê chuột lượn lờ vài vòng cho giống người
            await page.mouse.move(100, 100, { steps: 10 });
            await delay(500);
            await page.mouse.move(640, 360, { steps: 10 });
            await delay(500);
            await page.mouse.click(640, 360);
        } catch (e) { }

        // Chờ 15 giây để web giải mã (có lúc nó bắt đợi khá lâu)
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
                        <h2>Bot vẫn chưa bóc được link!</h2>
                        <img src="data:image/png;base64,${base64Screenshot}" style="border: 2px solid red; max-width: 90%; margin-top: 20px;" />
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
