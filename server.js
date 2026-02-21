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
        
        const iframeMatch = html.match(/id="player_iframe"\s+src="([^"]+)"/i) 
                         || html.match(/iframe\s+src="([^"]+vidsrc[^"]+)"/i);
                         
        if (!iframeMatch) return res.status(404).json({ error: "Lớp 1: Không tìm thấy Iframe nhúng" });

        let rcpUrl = iframeMatch[1];
        if (rcpUrl.startsWith('//')) rcpUrl = 'https:' + rcpUrl;

        // --- BƯỚC 2: TÌM PROVIDER (MEGACLOUD/RABBITSTREAM) ---
        const rcpRes = await axios.get(rcpUrl, { headers: { ...HEADERS, 'Referer': vidsrcUrl } });
        
        // Axios tự động follow redirect, nên URL cuối cùng nằm ở đây
        let providerUrl = rcpRes.request?.res?.responseUrl || rcpUrl; 
        
        // Nếu không tự redirect, ta đào trong mã HTML
        if (!providerUrl.includes('megacloud') && !providerUrl.includes('rabbitstream') && !providerUrl.includes('dokocloud')) {
            const providerMatch = rcpRes.data.match(/src="([^"]+(megacloud|rabbitstream|dokocloud)[^"]+)"/i);
            if (providerMatch) {
                providerUrl = providerMatch[1];
                if (providerUrl.startsWith('//')) providerUrl = 'https:' + providerUrl;
            }
        }

        if (!providerUrl.includes('megacloud') && !providerUrl.includes('rabbitstream') && !providerUrl.includes('dokocloud')) {
             return res.status(404).json({ error: "Lớp 2: Bị kẹt, không ra được link Megacloud/Rabbitstream", currentUrl: providerUrl });
        }

        // --- BƯỚC 3: TRÍCH XUẤT VIDEO ID & GỌI AJAX GETSOURCES ---
        const urlObj = new URL(providerUrl);
        // Quét cấu trúc URL: /embed-2/e-1/WXYZ1234
        const matchProvider = urlObj.pathname.match(/\/(embed-\d+)\/[a-zA-Z0-9-]+\/([^/]+)/);
        
        if (!matchProvider) return res.status(404).json({ error: "Lớp 3: Không bóc được ID Video từ: " + providerUrl });

        const embedPath = matchProvider[1]; 
        const videoId = matchProvider[2]; 

        // ĐÂY CHÍNH LÀ NƠI GIẤU MÃ HÓA AES HIỆN TẠI
        const ajaxUrl = `${urlObj.origin}/${embedPath}/ajax/e-1/getSources?id=${videoId}`;
        
        const ajaxRes = await axios.get(ajaxUrl, { 
            headers: { 
                ...HEADERS, 
                'Referer': providerUrl,
                'X-Requested-With': 'XMLHttpRequest' // Header bắt buộc để server không chặn
            } 
        });

        const sourcesData = ajaxRes.data.sources;
        if (!sourcesData) return res.status(404).json({ error: "Lớp 4: Lấy được getSources nhưng rỗng", data: ajaxRes.data });

        // Trường hợp hên: Nó không thèm mã hóa
        if (typeof sourcesData === 'object' && sourcesData[0]?.file) {
            return res.json({ streamUrl: sourcesData[0].file });
        }

        // --- BƯỚC 4: LẤY CHÌA KHÓA TỪ GITHUB & GIẢI MÃ ---
        const keysRes = await axios.get('https://raw.githubusercontent.com/theusaf/rabbitstream/master/keys.json');
        
        let decryptionKey = "";
        try {
            // Xác định xem mình đang ở host nào để lấy key chuẩn
            const hostName = urlObj.hostname.includes('rabbitstream') ? 'rabbitstream' : 'megacloud';
            const keyObj = Array.isArray(keysRes.data) 
                ? keysRes.data.find(k => k.name && k.name.toLowerCase() === hostName) || keysRes.data[0] 
                : keysRes.data;
            
            // Xử lý cả định dạng mảng hoặc chuỗi
            decryptionKey = typeof keyObj.key === 'string' ? keyObj.key : (Array.isArray(keyObj.key) ? keyObj.key[0] : keyObj);
        } catch (e) {
            return res.status(500).json({ error: "Lớp 4.5: Lỗi format key từ Github" });
        }

        // --- BƯỚC 5: DÙNG CRYPTO-JS ĐỂ "MỞ KHÓA" ---
        try {
            const bytes = CryptoJS.AES.decrypt(sourcesData, decryptionKey);
            const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
            
            if (!decryptedText) throw new Error("Key cũ/Dữ liệu rác");

            const jsonData = JSON.parse(decryptedText);
            const streamUrl = jsonData[0]?.file || (jsonData.sources && jsonData.sources[0]?.file);

            if (streamUrl) {
                res.json({ streamUrl: streamUrl });
            } else {
                res.status(404).json({ error: "Lớp 5: Giải mã xong nhưng không có link m3u8", data: jsonData });
            }
        } catch (decryptError) {
            return res.status(500).json({ error: "Lớp 5: Thuật toán/Khóa AES không khớp" });
        }

    } catch (e) {
        const errorMsg = e.response ? `HTTP ${e.response.status}` : e.message;
        res.status(500).json({ error: errorMsg });
    }
});

app.listen(PORT, () => console.log(`🚀 API Node.js Extractor (Bypass v4) đang chạy ở port ${PORT}`));
