import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';

const FILES_DIR = path.join(process.cwd(), 'public', 'files');

if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

const allowedMimeTypes = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, FILES_DIR);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const safeBase = file.originalname
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .replace(/_+/g, '_');
    const ext = path.extname(safeBase) || (file.mimetype === 'text/csv' ? '.csv' : '');
    const baseName = path.basename(safeBase, path.extname(safeBase));
    const finalName = `${baseName}_${timestamp}${ext}`;
    cb(null, finalName);
  },
});

function fileFilter(_req, file, cb) {
  if (!allowedMimeTypes.has(file.mimetype)) {
    return cb(new Error('Only CSV or XLSX files are allowed'));
  }
  cb(null, true);
}

export const uploadSingleFile = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1,
  },
}).single('file');


