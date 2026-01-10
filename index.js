const express = require("express");
const WebTorrent = require("webtorrent");
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const pump = require("pump");
const rangeParser = require("range-parser");

const client = new WebTorrent();
const app = express();
const port = process.env.PORT || 3000;

// 1. Tích hợp giao diện Stremio Addon
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

// 2. Endpoint xử lý Stream (/stream/:magnet)
app.get("/stream/:magnet", (req, res) => {
    const magnetLink = decodeURIComponent(req.params.magnet);

    // Kiểm tra xem torrent đã add chưa, nếu chưa thì add
    let torrent = client.get(magnetLink);
    if (!torrent) {
        torrent = client.add(magnetLink, { path: '/tmp' }); // Lưu tạm vào /tmp
    }

    // Khi có metadata, tìm file video lớn nhất
    torrent.on('ready', () => {
        const file = torrent.files.reduce((a, b) => (a.length > b.length ? a : b));
        
        console.log(`Đang tải: ${file.name}`);

        // Xử lý Range Request (Stremio thường yêu cầu tua đi tua lại)
        const ranges = rangeParser(file.length, req.headers.range || "");
        
        if (ranges === -1) return res.sendStatus(416); // Unsatisfiable range

        // Mặc định stream cả file nếu không có range cụ thể
        let start = 0;
        let end = file.length - 1;

        if (Array.isArray(ranges)) {
            start = ranges[0].start;
            end = ranges[0].end;
            res.statusCode = 206; // Partial Content
            res.setHeader("Content-Range", `bytes ${start}-${end}/${file.length}`);
            res.setHeader("Content-Length", end - start + 1);
        } else {
            res.setHeader("Content-Length", file.length);
        }

        res.setHeader("Content-Type", "video/mp4"); // Hoặc check đuôi file để set type
        res.setHeader("Accept-Ranges", "bytes");

        // Tạo luồng đọc từ file torrent và bơm (pump) vào response
        const stream = file.createReadStream({ start, end });
        
        // Pump giúp tự động đóng stream khi client ngắt kết nối
        pump(stream, res, (err) => {
            if (err) console.error("Stream lỗi hoặc client đóng kết nối");
        });
    });

    torrent.on('error', (err) => {
        console.error("Lỗi Torrent:", err);
        res.status(500).send("Lỗi tải torrent");
    });
});

app.listen(port, () => {
    console.log(`Add-on đang chạy tại http://localhost:${port}`);
});
