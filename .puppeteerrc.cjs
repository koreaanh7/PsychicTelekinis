const {join} = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Ép thư mục cache của Puppeteer nằm ngay trong thư mục code
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
