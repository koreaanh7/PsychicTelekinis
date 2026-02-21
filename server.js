const express = require('express');
const axios = require('axios');
const CryptoJS = require('crypto-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Fake User-Agent xịn để tránh bị Cloudflare 403
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
};

app.get('/extract', async (req, res) => {
    const imdbId = req.query.id; 
    const season = req.query.s || '';
    const episode = req.query.e || '';

    if (!imdbId) return res.status(400).json({ error: "Thiếu IMDB ID" });

    try {
        console.log(`[+] Đang bẻ khóa: ${imdbId} - S${season}E${episode}`);

        // --- BƯỚC 1: VÀO CỬA CHÍNH VIDSRC ---
        const vidsrcUrl = season && episode 
            ? `https://vidsrc.me/embed/tv/${imdbId}/${season}/${episode}`
            : `https://vidsrc.me/embed/movie/${imdbId}`;

        const pageRes = await axios.get(vidsrcUrl, { headers: HEADERS });
        const html = pageRes.data;
        
        // Tìm Iframe nội bộ của Vidsrc (chứa link rcp)
        const iframeMatch = html.match(/id="player_iframe"\s+src="([^"]+)"/i) 
                         || html.match(/iframe\s+src="([^"]+vidsrc[^"]+)"/i);
                         
        if (!iframeMatch) return res.status(404).json({ error: "Lớp 1: Không tìm thấy Iframe nhúng" });

        let rcpUrl = iframeMatch[1];
        if (rcpUrl.startsWith('//')) rcpUrl = 'https:' + rcpUrl;

        // --- BƯỚC 2: TÌM CỬA TRUNG CHUYỂN (PROVIDER) ---
        const rcpRes = await axios.get(rcpUrl, { headers: { ...HEADERS, 'Referer': vidsrcUrl } });
        
        // Bắt link sau khi bị chuyển hướng (Redirect)
        let providerUrl = rcpRes.request?.res?.responseUrl; 
        let rcpHtml = rcpRes.data;

        // Nếu server không chuyển hướng mà giấu link trong thẻ iframe hoặc script
        if (!providerUrl || providerUrl === rcpUrl) {
            // Regex cực mạnh: Quét mọi url có cấu trúc /embed-X/ hoặc /e-X/ bất chấp tên miền
            const urlMatch = rcpHtml.match(/(?:src=["']|href=["']|window\.location\.href\s*=\s*["'])((?:https?:)?\/\/[a-zA-Z0-9.-]+\/(?:embed-\d+|e-\d+|v)\/[a-zA-Z0-9_-]+)/i);

            if (urlMatch && urlMatch[1]) {
                providerUrl = urlMatch[1];
            } else {
                // TUYỆT CHIÊU DEBUG: Nhả mã HTML ra để xem Vidsrc giấu link kiểu gì
                const snippet = typeof rcpHtml === 'string' ? rcpHtml.substring(0, 500) : "Not HTML";
                return res.status(404).json({ error: "Lớp 2: Không tìm thấy link nhúng Provider", htmlSnippet: snippet });
            }
        }

        if (providerUrl.startsWith('//')) providerUrl = 'https:' + providerUrl;

        // --- BƯỚC 3: TRÍCH XUẤT VIDEO ID TỪ PROVIDER ---
        const urlObj = new URL(providerUrl);
        // Quét cấu trúc URL: /embed-2/e-1/WXYZ1234
        const matchProvider = urlObj.pathname.match(/\/(embed-\d+)\/(?:e-\d+\/)?([^/]+)/);
        
        if (!matchProvider) return res.status(404).json({ error: "Lớp 3: Cấu trúc URL lạ", url: providerUrl });

        const embedPath = matchProvider[1]; 
        const videoId = matchProvider[2]; 

        // --- BƯỚC 4: GỌI AJAX ĐỂ LẤY CỤC MÃ HÓA AES ---
        const ajaxUrl = `${urlObj.origin}/${embedPath}/ajax/e-1/getSources?id=${videoId}`;
        
        const ajaxRes = await axios.get(ajaxUrl, { 
            headers: { 
                ...HEADERS, 
                'Referer': providerUrl,
                'X-Requested-With': 'XMLHttpRequest' 
            } 
        });

        const sourcesData = ajaxRes.data.sources;
        if (!sourcesData) return res.status(404).json({ error: "Lớp 4: getSources bị rỗng", ajaxUrl: ajaxUrl, data: ajaxRes.data });

        // Nếu nhân phẩm tốt: Vidsrc thả cửa không thèm mã hóa
        if (typeof sourcesData === 'object' && sourcesData[0]?.file) {
            return res.json({ streamUrl: sourcesData[0].file });
        }

        // --- BƯỚC 5: LẤY CHÌA KHÓA VÀ GIẢI MÃ ---
        const keysRes = await axios.get('https://raw.githubusercontent.com/theusaf/rabbitstream/master/keys.json');
        
        let decryptionKey = "";
        try {
            // Lấy chìa khóa chuẩn nhất
            const keyObj = keysRes.data.find(k => k.name && k.name.toLowerCase() === 'megacloud') || keysRes.data[0];
            decryptionKey = typeof keyObj.key === 'string' ? keyObj.key : (Array.isArray(keyObj.key) ? keyObj.key[0] : keyObj.key);
        } catch (e) {
            return res.status(500).json({ error: "Lỗi format key từ Github" });
        }

        try {
            const bytes = CryptoJS.AES.decrypt(sourcesData, decryptionKey);
            const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
            
            if (!decryptedText) throw new Error("Khóa AES sai hoặc dữ liệu rác");

            const jsonData = JSON.parse(decryptedText);
            const streamUrl = jsonData[0]?.file || (jsonData.sources && jsonData.sources[0]?.file);

            if (streamUrl) {
                res.json({ streamUrl: streamUrl });
            } else {
                res.status(404).json({ error: "Lớp 5: Giải mã xong nhưng file rỗng", data: jsonData });
            }
        } catch (decryptError) {
            return res.status(500).json({ error: "Lớp 5: Thuật toán giải mã thất bại", encData: sourcesData });
        }

    } catch (e) {
        const errorMsg = e.response ? `HTTP ${e.response.status} - ${e.response.statusText}` : e.message;
        res.status(500).json({ error: "Lỗi kết nối mạng: " + errorMsg });
    }
});

app.listen(PORT, () => console.log(`🚀 API Node.js Extractor (Bypass v5) đang chạy ở port ${PORT}`));
