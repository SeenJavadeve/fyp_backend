import path from 'node:path';
import fs from 'node:fs/promises';
import { parse as parseCsv } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { File } from '../models/file.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function extractColumnsFromCsv(buffer) {
  const content = buffer.toString('utf8');
  const records = parseCsv(content, { bom: true, skip_empty_lines: true });
  if (!records || records.length === 0) return [];
  // Use first row as header if strings; otherwise return unique keys
  const firstRow = records[0];
  if (Array.isArray(firstRow)) {
    return firstRow.map((h) => String(h));
  }
  return Object.keys(firstRow || {});
}

function extractColumnsFromXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (!json || json.length === 0) return [];
  const headers = json[0] || [];
  return headers.map((h) => String(h));
}

export const uploadFile = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(null, 'Unauthorized'));
  }

  if (!req.file) {
    return res.status(400).json(new ApiResponse(null, 'No file uploaded'));
  }

  const { originalname, filename, mimetype, size, destination } = req.file;
  const ext = path.extname(filename).replace('.', '').toLowerCase();

  if (!['csv', 'xlsx'].includes(ext)) {
    return res
      .status(400)
      .json(new ApiResponse(null, 'Invalid file type. Only .csv or .xlsx are allowed'));
  }

  const absolutePath = path.join(destination, filename);
  const buffer = await fs.readFile(absolutePath);

  let columns = [];
  if (ext === 'csv') {
    columns = extractColumnsFromCsv(buffer);
  } else if (ext === 'xlsx') {
    columns = extractColumnsFromXlsx(buffer);
  }

  const relativePublicPath = `/files/${filename}`; // served from express.static('public')

  const created = await File.create({
    userId,
    originalName: originalname,
    storedName: filename,
    extension: ext,
    mimeType: mimetype,
    size,
    path: relativePublicPath,
    columns,
  });

  return res.status(201).json(new ApiResponse(created, 'File uploaded successfully'));
});

export const listFiles = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(null, 'Unauthorized'));
  }

  const files = await File.find({ userId }).sort({ createdAt: -1 });
  return res.status(200).json(new ApiResponse(files, 'Files fetched successfully'));
});

export const deleteFile = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(null, 'Unauthorized'));
  }

  const { id } = req.params;
  if (!id) {
    return res.status(400).json(new ApiResponse(null, 'File id is required'));
  }

  const fileDoc = await File.findOne({ _id: id, userId });
  if (!fileDoc) {
    return res.status(404).json(new ApiResponse(null, 'File not found'));
  }

  const absolutePath = path.join(process.cwd(), 'public', fileDoc.path.replace(/^\/+/, ''));

  try {
    await fs.unlink(absolutePath);
  } catch (_err) {
    // If file missing on disk, continue to delete doc
  }

  await File.deleteOne({ _id: fileDoc._id });

  return res.status(200).json(new ApiResponse(null, 'File and document deleted successfully'));
});


