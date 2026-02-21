const express = require('express');
const axios = require('axios');
const CryptoJS = require('crypto-js');

const app = express();
const PORT = process.env.PORT || 3000;

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': '*/*'
};

// Hàm quét siêu tốc qua các cửa phụ
async function findProviderUrl(imdbId, season, episode) {
    const isTv = season && episode;
    
    // Danh sách các máy chủ gương (Mirrors)
    const endpoints = [
        isTv ? `https://vidsrc.cc/v2/embed/tv/${imdbId}/${season}/${episode}` : `https://vidsrc.cc/v2/embed/movie/${imdbId}`,
        isTv ? `https://vidsrc.me/embed/tv/${imdbId}/${season}/${episode}` : `https://vidsrc.me/embed/movie/${imdbId}`,
        isTv ? `https://vidsrc.net/embed/tv?imdb=${imdbId}&season=${season}&episode=${episode}` : `https://vidsrc.net/embed/movie?imdb=${imdbId}`
    ];

    for (let target of endpoints) {
        try {
            console.log(`Đang dò tìm tại: ${target}`);
            const res = await axios.get(target, { headers: HEADERS });
            
            // Lấy Iframe
            const iframeMatch = res.data.match(/iframe\s+id="player_iframe"\s+src="([^"]+)"/i) 
                             || res.data.match(/iframe\s+src="([^"]+vidsrc[^"]+)"/i);
            
            if (!iframeMatch) continue;

            let rcpUrl = iframeMatch[1];
            if (rcpUrl.startsWith('//')) rcpUrl = 'https:' + rcpUrl;

            const rcpRes = await axios.get(rcpUrl, { headers: { ...HEADERS, 'Referer': target } });
            const rcpHtml = rcpRes.data;
            const responseUrl = rcpRes.request?.res?.responseUrl || rcpUrl;

            // 1. Kiểm tra xem có bị redirect thẳng tới Megacloud không
            if (responseUrl.match(/megacloud|rabbitstream|dokocloud/i)) return responseUrl;

            // 2. Kiểm tra Iframe lộ thiên
            const providerMatch = rcpHtml.match(/src=["']([^"']+(megacloud|rabbitstream|dokocloud)[^"']+)["']/i) ||
                                  rcpHtml.match(/window\.location\.href\s*=\s*["']([^"']+(megacloud|rabbitstream|dokocloud)[^"']+)["']/i);
            if (providerMatch) {
                let finalUrl = providerMatch[1];
                if (finalUrl.startsWith('//')) finalUrl = 'https:' + finalUrl;
                return finalUrl;
            }

            // 3. Tuyệt chiêu: Quét bạo lực (Brute-force) giải mã Base64 ẩn trong mã HTML
            const b64Matches = rcpHtml.match(/[A-Za-z0-9+/]{40,}/g);
            if (b64Matches) {
                for (let b64 of b64Matches) {
                    try {
                        const decoded = Buffer.from(b64, 'base64').toString('utf8');
                        if (decoded.match(/megacloud|rabbitstream|dokocloud/i)) {
                            const urlExtract = decoded.match(/(https:\/\/[^"'\s\\]+)/);
                            if (urlExtract) return urlExtract[1];
                        }
                    } catch(e) {}
                }
            }
        } catch (e) {
            console.log(`Bỏ qua ${target} vì lỗi kết nối.`);
        }
    }
    return null;
}

app.get('/extract', async (req, res) => {
    const imdbId = req.query.id; 
    const season = req.query.s || '';
    const episode = req.query.e || '';

    if (!imdbId) return res.status(400).json({ error: "Thiếu IMDB ID" });

    try {
        console.log(`[+] Bắt đầu bẻ khóa: ${imdbId} - S${season}E${episode}`);

        // --- BƯỚC 1 & 2: DÙNG ĐA LUỒNG TÌM LINK MEGACLOUD ---
        const providerUrl = await findProviderUrl(imdbId, season, episode);

        if (!providerUrl) {
            return res.status(404).json({ error: "Lớp 2: Thử tất cả server nhưng không tìm thấy Megacloud" });
        }
        
        console.log(`[+] Tìm thấy Megacloud: ${providerUrl}`);

        // --- BƯỚC 3: TRÍCH XUẤT VIDEO ID & GỌI AJAX GETSOURCES ---
        const urlObj = new URL(providerUrl);
        const matchProvider = urlObj.pathname.match(/\/(embed-\d+)\/(?:e-\d+\/)?([^/]+)/);
        
        if (!matchProvider) return res.status(404).json({ error: "Lớp 3: Không bóc được ID Video", url: providerUrl });

        const embedPath = matchProvider[1]; 
        const videoId = matchProvider[2]; 

        const ajaxUrl = `${urlObj.origin}/${embedPath}/ajax/e-1/getSources?id=${videoId}`;
        const ajaxRes = await axios.get(ajaxUrl, { 
            headers: { 
                ...HEADERS, 
                'Referer': providerUrl,
                'X-Requested-With': 'XMLHttpRequest' 
            } 
        });

        const sourcesData = ajaxRes.data.sources;
        if (!sourcesData) return res.status(404).json({ error: "Lớp 4: getSources bị rỗng" });

        if (typeof sourcesData === 'object' && sourcesData[0]?.file) {
            return res.json({ streamUrl: sourcesData[0].file });
        }

        // --- BƯỚC 4 & 5: LẤY KHÓA GITHUB VÀ GIẢI MÃ ---
        const keysRes = await axios.get('https://raw.githubusercontent.com/theusaf/rabbitstream/master/keys.json');
        
        let decryptionKey = "";
        try {
            const keyObj = keysRes.data.find(k => k.name && k.name.toLowerCase() === 'megacloud') || keysRes.data[0];
            decryptionKey = typeof keyObj.key === 'string' ? keyObj.key : (Array.isArray(keyObj.key) ? keyObj.key[0] : keyObj.key);
        } catch (e) {
            return res.status(500).json({ error: "Lỗi format key từ Github" });
        }

        try {
            const bytes = CryptoJS.AES.decrypt(sourcesData, decryptionKey);
            const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
            
            if (!decryptedText) throw new Error("Khóa sai");

            const jsonData = JSON.parse(decryptedText);
            const streamUrl = jsonData[0]?.file || (jsonData.sources && jsonData.sources[0]?.file);

            if (streamUrl) {
                res.json({ streamUrl: streamUrl });
            } else {
                res.status(404).json({ error: "Lớp 5: Giải mã xong file rỗng" });
            }
        } catch (decryptError) {
            return res.status(500).json({ error: "Lớp 5: Thuật toán giải mã thất bại" });
        }

    } catch (e) {
        res.status(500).json({ error: "Lỗi kết nối Server API gốc: " + e.message });
    }
});

app.listen(PORT, () => console.log(`🚀 API Bypass v6 (Multi-Source) đang chạy ở port ${PORT}`));
