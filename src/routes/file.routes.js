import { Router } from 'express';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { uploadSingleFile } from '../middlewares/upload.middleware.js';
import { uploadFile, listFiles, deleteFile } from '../controllers/file.controller.js';

const router = Router();

router.post('/upload', verifyJWT, (req, res, next) => {
  uploadSingleFile(req, res, function (err) {
    if (err) {
      return res.status(400).json({ data: null, message: err.message || 'Upload error' });
    }
    next();
  });
}, uploadFile);

router.get('/getAllFiles', verifyJWT, listFiles);
router.delete('/delete/:id', verifyJWT, deleteFile);

export default router;


