// 檔案上傳共用設定。
// 兩個落地位置刻意分開：
//   uploads/          內部檔案（施工照片、報驗掃描件），/uploads 掛了登入驗證才讀得到；
//   public/web-media/ 官網素材（實績相片、商品圖），必須讓未登入的訪客也讀得到。
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const WEB_MEDIA_DIR = path.join(__dirname, '..', 'public', 'web-media');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(WEB_MEDIA_DIR, { recursive: true });

function makeUploader(dir, { images = true, maxMb = 12 } = {}) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, dir),
      filename: (req, file, cb) =>
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (req, file, cb) =>
      cb(null, images ? /^image\//.test(file.mimetype) : /^(image\/|application\/pdf)/.test(file.mimetype))
  });
}

// 內部檔案：報驗公文、證照掃描件等，允許 PDF
const upload = makeUploader(UPLOAD_DIR, { images: false });
// 官網素材：只收圖片
const webUpload = makeUploader(WEB_MEDIA_DIR, { images: true });

// 刪除官網素材（web-media 底下的檔案不經 deleteUpload，路徑前綴不同）
function deleteWebMedia(webPath) {
  if (!webPath || !String(webPath).startsWith('/web-media/')) return;
  fs.unlink(path.join(WEB_MEDIA_DIR, path.basename(webPath)), () => {});
}

module.exports = { upload, webUpload, deleteWebMedia, UPLOAD_DIR, WEB_MEDIA_DIR };
