const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const manifest = require("./manifest");
const streamHandler = require("./streamHandler");

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(streamHandler);

// Dùng cho Render/Local
serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });

// Nếu deploy Serverless (Vercel), cần export handler khác (xem phần dưới)
