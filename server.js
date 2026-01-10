// server.js
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const TorrentSearchApi = require("torrent-search-api");
const PikPakClient = require('./pikpak'); // Import file vừa tạo

// Lấy thông tin từ biến môi trường (Cấu hình trên Render sau)
const PIKPAK_USER = process.env.PIKPAK_USER;
const PIKPAK_PASS = process.env.PIKPAK_PASS;

if (!PIKPAK_USER || !PIKPAK_PASS) {
    console.error("❌ MISSING PIKPAK CREDENTIALS! Please set env variables.");
    process.exit(1);
}

// Khởi tạo PikPak Client
const pikpak = new PikPakClient(PIKPAK_USER, PIKPAK_PASS);

const builder = new addonBuilder({
    id: "org.stremio.pikpakstream",
    version: "1.0.0",
    name: "PikPak Fast Stream",
    description: "Preload torrents to PikPak and stream instantly",
    resources: ["stream"],
    types: ["movie", "series"],
    catalogs: []
});

TorrentSearchApi.enablePublicProviders();

builder.defineStreamHandler(async ({ type, id }) => {
    // 1. Xử lý ID (Demo đơn giản: Nếu ID là 'tt...' thì tìm tên phim)
    // Trong thực tế bạn nên dùng thư viện 'cinemeta' để lấy tên phim chuẩn
    let query = id; 
    if (id.startsWith("tt")) {
        query = id; // Tìm theo IMDB ID luôn nếu provider hỗ trợ
    }

    console.log(`🔍 Searching for: ${query}`);
    const torrents = await TorrentSearchApi.search(query, "Video", 1);

    if (!torrents || torrents.length === 0) {
        console.log("No torrents found.");
        return { streams: [] };
    }

    const bestTorrent = torrents[0];
    console.log(`🎯 Found Torrent: ${bestTorrent.title} | Size: ${bestTorrent.size}`);

    // 2. Gửi qua PikPak xử lý
    const fileData = await pikpak.addMagnetAndGetLink(bestTorrent.magnet);

    if (fileData) {
        return {
            streams: [
                {
                    title: `⚡ PikPak Cloud [No Buffer]\nFile: ${fileData.name}\nSize: ${bestTorrent.size}`,
                    url: fileData.url,
                    behaviorHints: {
                        notWebReady: false // PikPak link chạy tốt trên browser
                    }
                },
                {
                    // Fallback: Link torrent gốc nếu PikPak lỗi
                    title: `🐌 Original Torrent (P2P)`,
                    infoHash: bestTorrent.infoHash,
                }
            ]
        };
    }

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Add-on running on http://localhost:${port}`);
