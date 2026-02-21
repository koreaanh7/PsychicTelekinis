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
                '--window-size=1280,720',
                // Kích hoạt giả lập Card màn hình (GPU) bằng phần mềm
                '--use-gl=swiftshader',
                '--ignore-gpu-blocklist',
                '--disable-web-security'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // 🔥 TUYỆT CHIÊU CUỐI: GIẢ LẬP PHẦN CỨNG & BỘ GIẢI MÃ VIDEO
        await page.evaluateOnNewDocument(() => {
            // 1. Xóa dấu vết WebDriver
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            
            // 2. Giả lập có danh sách Plugin (Bot thường có mảng này rỗng)
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });

            // 3. Đánh lừa bộ kiểm tra Video Codec (Báo cho web biết máy này hỗ trợ mp4/m3u8)
            const originalCanPlayType = window.HTMLMediaElement.prototype.canPlayType;
            window.HTMLMediaElement.prototype.canPlayType = function(type) {
                if (type && (type.includes('mp4') || type.includes('m3u8') || type.includes('avc1') || type.includes('hls'))) {
                    return 'probably';
                }
                return originalCanPlayType.apply(this, arguments);
            };
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

        // Đợi khung video xuất hiện
        await delay(3000);
        
        // Mô phỏng người dùng click vào giữa
        try {
            await page.mouse.move(640, 360, { steps: 5 });
            await page.mouse.click(640, 360, { delay: 100 });
            await delay(1000);
            await page.mouse.click(640, 360, { delay: 100 }); 
        } catch (e) { }

        // Chờ 15 giây xem phép màu có xảy ra không
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
                        <h2>Đã fake GPU nhưng vẫn kẹt!</h2>
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
