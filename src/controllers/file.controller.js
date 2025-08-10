import path from 'node:path';
import fs from 'node:fs/promises';
import { parse as parseCsv } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { File } from '../models/file.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { analyzeWithAI } from '../services/aiAgent.js';
import mongoose from 'mongoose';

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


// Helper utilities for analysis
function isLikelyNumber(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return false;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed);
  }
  return false;
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : NaN;
}

function isLikelyDate(value) {
  if (value === null || value === undefined) return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function quantiles(sortedNumbers) {
  const n = sortedNumbers.length;
  if (n === 0) return { p25: null, p50: null, p75: null };
  const q = (p) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedNumbers[lo];
    return sortedNumbers[lo] * (hi - idx) + sortedNumbers[hi] * (idx - lo);
  };
  return { p25: q(0.25), p50: q(0.5), p75: q(0.75) };
}

function computeNumericStats(values) {
  const nums = values.map(toNumber).filter((v) => Number.isFinite(v));
  const count = nums.length;
  if (count === 0) {
    return { count: 0, mean: null, std: null, min: null, max: null, p25: null, p50: null, p75: null };
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / count;
  const variance = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / count;
  const std = Math.sqrt(variance);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const sorted = [...nums].sort((a, b) => a - b);
  const { p25, p50, p75 } = quantiles(sorted);
  return { count, mean, std, min, max, p25, p50, p75 };
}

function valueFrequency(values, maxCategories = 50) {
  const freq = new Map();
  for (const v of values) {
    const key = v === null || v === undefined || v === '' ? '(missing)' : String(v);
    freq.set(key, (freq.get(key) || 0) + 1);
    if (freq.size > maxCategories) break;
  }
  const entries = Array.from(freq.entries()).map(([value, count]) => ({ value, count }));
  entries.sort((a, b) => b.count - a.count);
  return entries;
}

function pearsonCorrelation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0, k = 0;
  for (let i = 0; i < n; i++) {
    const x = toNumber(xs[i]);
    const y = toNumber(ys[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    k++;
    sumX += x; sumY += y;
    sumXX += x * x; sumYY += y * y; sumXY += x * y;
  }
  if (k < 3) return null;
  const num = k * sumXY - sumX * sumY;
  const den = Math.sqrt((k * sumXX - sumX * sumX) * (k * sumYY - sumY * sumY));
  if (den === 0) return null;
  return num / den;
}

function linearRegressionFit(yValues) {
  const ys = yValues.map(toNumber).filter((v) => Number.isFinite(v));
  const n = ys.length;
  if (n < 3) return null;
  const xs = Array.from({ length: n }, (_, i) => i);
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) * (xs[i] - meanX);
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept, n };
}

function forecastLinear(model, horizon) {
  if (!model) return [];
  const { slope, intercept, n } = model;
  const points = [];
  for (let step = 1; step <= horizon; step++) {
    const x = n - 1 + step;
    points.push({ step, value: intercept + slope * x });
  }
  return points;
}

async function loadRowsFromFile(fileDoc) {
  const absolutePath = path.join(process.cwd(), 'public', fileDoc.path.replace(/^\/+/, ''));
  const buffer = await fs.readFile(absolutePath);
  if (fileDoc.extension === 'csv') {
    const content = buffer.toString('utf8');
    const rows = parseCsv(content, { bom: true, skip_empty_lines: true, columns: true });
    return rows;
  }
  if (fileDoc.extension === 'xlsx') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    return rows;
  }
  return [];
}

function resolveAbsolutePublicPath(input) {
  if (!input) return null;
  let normalized = String(input).replaceAll('\\', '/').trim();
  if (normalized.startsWith('/')) normalized = normalized.slice(1);
  // Accept 'files/xyz.csv' or '/files/xyz.csv' or just 'xyz.csv'
  let filename = normalized;
  if (normalized.includes('/')) {
    // Take only the basename to avoid traversal
    filename = path.posix.basename(normalized);
  }
  // Ensure it lands in public/files
  const rel = path.join('files', filename).replaceAll('\\', '/');
  const abs = path.join(process.cwd(), 'public', rel);
  return { abs, rel: `/${rel}` };
}

export const analyzeFile = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(null, 'Unauthorized'));
  }

  const { id } = req.params;
  if (!id) {
    return res.status(400).json(new ApiResponse(null, 'File id is required'));
  }

  let fileDoc = null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    fileDoc = await File.findOne({ _id: id, userId });
  }

  if (!fileDoc) {
    // Fallback: treat id as a stored filename or path under public/files
    const ref = resolveAbsolutePublicPath(id);
    if (!ref) {
      return res.status(404).json(new ApiResponse(null, 'File not found'));
    }
    try {
      await fs.access(ref.abs);
      const ext = path.extname(ref.abs).replace('.', '').toLowerCase();
      fileDoc = {
        _id: id,
        originalName: path.basename(ref.abs),
        extension: ext,
        path: ref.rel,
      };
    } catch (_err) {
      return res.status(404).json(new ApiResponse(null, 'File not found'));
    }
  }

  const rows = await loadRowsFromFile(fileDoc);
  if (!rows || rows.length === 0) {
    return res.status(200).json(new ApiResponse({
      file: { id: fileDoc._id, originalName: fileDoc.originalName, extension: fileDoc.extension, rowsAnalyzed: 0 },
      schema: { columns: (fileDoc.columns || []).map((name) => ({ name, inferredType: 'unknown' })) },
      stats: { numeric: {}, categorical: {} },
      correlations: [],
      chartRecommendations: [],
      forecasts: []
    }, 'File has no data rows'));
  }

  // Sampling to keep performance reasonable
  const SAMPLE_LIMIT = 5000;
  const sample = rows.slice(0, SAMPLE_LIMIT);
  const columnNames = fileDoc.columns && fileDoc.columns.length > 0
    ? fileDoc.columns
    : Object.keys(sample[0] || {});

  // Infer types
  const inferred = {};
  for (const col of columnNames) {
    let numHits = 0, dateHits = 0, total = 0;
    for (const row of sample) {
      const v = row[col];
      if (v === null || v === undefined || v === '') continue;
      total++;
      if (isLikelyNumber(v)) numHits++;
      else if (isLikelyDate(v)) dateHits++;
    }
    const numericRatio = total ? numHits / total : 0;
    const dateRatio = total ? dateHits / total : 0;
    let type = 'string';
    if (numericRatio >= 0.6) type = 'number';
    else if (dateRatio >= 0.6) type = 'date';
    inferred[col] = type;
  }

  // Stats by type
  const numericStats = {};
  const categoricalStats = {};
  const numericCols = columnNames.filter((c) => inferred[c] === 'number');
  const dateCols = columnNames.filter((c) => inferred[c] === 'date');

  for (const col of numericCols) {
    const values = sample.map((r) => r[col]);
    numericStats[col] = computeNumericStats(values);
  }
  for (const col of columnNames.filter((c) => inferred[c] === 'string')) {
    const values = sample.map((r) => r[col]);
    const freq = valueFrequency(values, 50);
    categoricalStats[col] = {
      count: values.length,
      unique: freq.length,
      top: freq.slice(0, 10),
    };
  }

  // Correlations for numeric pairs
  const correlations = [];
  for (let i = 0; i < numericCols.length; i++) {
    for (let j = i + 1; j < numericCols.length; j++) {
      const a = numericCols[i];
      const b = numericCols[j];
      const r = pearsonCorrelation(sample.map((r) => r[a]), sample.map((r) => r[b]));
      if (r !== null) correlations.push({ colX: a, colY: b, pearson: r });
    }
  }
  correlations.sort((x, y) => Math.abs(y.pearson) - Math.abs(x.pearson));

  // Chart recommendations
  const chartRecommendations = [];
  // Histograms for numeric columns
  for (const col of numericCols) {
    chartRecommendations.push({
      title: `Distribution of ${col}`,
      type: 'histogram',
      x: col,
      y: null,
      description: 'Shows the distribution of values'
    });
  }
  // Scatter plots for highly correlated pairs
  for (const corr of correlations.filter((c) => Math.abs(c.pearson) >= 0.5).slice(0, 10)) {
    chartRecommendations.push({
      title: `Relationship: ${corr.colX} vs ${corr.colY}`,
      type: 'scatter',
      x: corr.colX,
      y: corr.colY,
      description: `Strong ${corr.pearson >= 0 ? 'positive' : 'negative'} correlation`
    });
  }
  // Line charts for date + numeric
  if (dateCols.length > 0) {
    const dateCol = dateCols[0];
    for (const col of numericCols) {
      chartRecommendations.push({
        title: `${col} over time`,
        type: 'line',
        x: dateCol,
        y: col,
        description: 'Trend over time'
      });
    }
  }
  // Bar charts for categorical vs numeric (aggregate mean)
  const categoricalCols = columnNames.filter((c) => inferred[c] === 'string');
  if (categoricalCols.length > 0 && numericCols.length > 0) {
    const cat = categoricalCols[0];
    const num = numericCols[0];
    chartRecommendations.push({
      title: `${num} by ${cat}`,
      type: 'bar',
      x: cat,
      y: num,
      agg: 'mean',
      description: 'Compare averages across categories'
    });
  }

  // Forecasts using linear regression on index over time/date if available
  const forecasts = [];
  if (numericCols.length > 0) {
    // Determine ordering by date if available
    let orderedSample = sample;
    let horizonLabels = null;
    if (dateCols.length > 0) {
      const dateCol = dateCols[0];
      orderedSample = [...sample].filter((r) => isLikelyDate(r[dateCol])).sort((a, b) => new Date(a[dateCol]) - new Date(b[dateCol]));
      // Estimate frequency
      const times = orderedSample.map((r) => new Date(r[dateCols[0]]).getTime());
      const deltas = [];
      for (let i = 1; i < times.length; i++) {
        const d = times[i] - times[i - 1];
        if (Number.isFinite(d) && d > 0) deltas.push(d);
      }
      deltas.sort((a, b) => a - b);
      const freq = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 24 * 3600 * 1000; // default 1 day
      const lastTime = times.length ? times[times.length - 1] : Date.now();
      horizonLabels = Array.from({ length: 5 }, (_, i) => new Date(lastTime + freq * (i + 1)).toISOString());
    } else {
      horizonLabels = Array.from({ length: 5 }, (_, i) => `t+${i + 1}`);
    }

    for (const col of numericCols.slice(0, 3)) {
      const ySeries = orderedSample.map((r) => r[col]);
      const model = linearRegressionFit(ySeries);
      const points = forecastLinear(model, 5);
      forecasts.push({
        target: col,
        horizon: 5,
        model: model ? { type: 'linear_regression', slope: model.slope, intercept: model.intercept } : null,
        points: points.map((p, idx) => ({ label: horizonLabels[idx], value: p.value }))
      });
    }
  }

  return res.status(200).json(
    new ApiResponse(
      {
        file: { id: fileDoc._id, originalName: fileDoc.originalName, extension: fileDoc.extension, rowsAnalyzed: sample.length },
        schema: { columns: columnNames.map((name) => ({ name, inferredType: inferred[name] })) },
        stats: { numeric: numericStats, categorical: categoricalStats },
        correlations,
        chartRecommendations,
        forecasts,
      },
      'Analysis completed'
    )
  );
});

export const analyzeFileAI = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(null, 'Unauthorized'));
  }

  const { id } = req.params;
  if (!id) {
    return res.status(400).json(new ApiResponse(null, 'File id is required'));
  }

  let fileDoc = null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    fileDoc = await File.findOne({ _id: id, userId });
  }
  if (!fileDoc) {
    const ref = resolveAbsolutePublicPath(id);
    if (!ref) {
      return res.status(404).json(new ApiResponse(null, 'File not found'));
    }
    try {
      await fs.access(ref.abs);
      const ext = path.extname(ref.abs).replace('.', '').toLowerCase();
      fileDoc = {
        _id: id,
        originalName: path.basename(ref.abs),
        extension: ext,
        path: ref.rel,
      };
    } catch (_err) {
      return res.status(404).json(new ApiResponse(null, 'File not found'));
    }
  }

  const rows = await loadRowsFromFile(fileDoc);
  const sample = rows.slice(0, 200);
  const columnNames = fileDoc.columns && fileDoc.columns.length > 0
    ? fileDoc.columns
    : Object.keys(sample[0] || {});

  // Minimal numeric stats and correlations for context
  const inferred = {};
  for (const col of columnNames) {
    let numHits = 0, dateHits = 0, total = 0;
    for (const row of sample) {
      const v = row[col];
      if (v === null || v === undefined || v === '') continue;
      total++;
      if (isLikelyNumber(v)) numHits++;
      else if (isLikelyDate(v)) dateHits++;
    }
    const numericRatio = total ? numHits / total : 0;
    const dateRatio = total ? dateHits / total : 0;
    let type = 'string';
    if (numericRatio >= 0.6) type = 'number';
    else if (dateRatio >= 0.6) type = 'date';
    inferred[col] = type;
  }
  const numericCols = columnNames.filter((c) => inferred[c] === 'number');
  const numericStats = {};
  for (const col of numericCols) {
    numericStats[col] = computeNumericStats(sample.map((r) => r[col]));
  }
  const correlations = [];
  for (let i = 0; i < numericCols.length; i++) {
    for (let j = i + 1; j < numericCols.length; j++) {
      const a = numericCols[i];
      const b = numericCols[j];
      const r = pearsonCorrelation(sample.map((r) => r[a]), sample.map((r) => r[b]));
      if (r !== null) correlations.push({ colX: a, colY: b, pearson: r });
    }
  }

  const schema = { columns: columnNames.map((name) => ({ name, inferredType: inferred[name] })) };
  const context = { schema, numericStats, correlations, sampleRows: sample };

  const preferred = req.query.provider || null; // ollama | gemini | openai | huggingface
  const result = await analyzeWithAI(context, preferred);
  if (!result) {
    return res.status(503).json(new ApiResponse({ context }, 'AI provider unavailable or returned invalid JSON'));
  }

  return res.status(200).json(new ApiResponse({
    provider: result.provider,
    model: result.model,
    ai: result.output,
  }, 'AI analysis completed'));
});

export const analyzeFileByPath = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(null, 'Unauthorized'));
  }
  const { path: p, name } = req.query;
  const refInput = p || name;
  if (!refInput) {
    return res.status(400).json(new ApiResponse(null, 'Provide query `path` or `name`'));
  }
  const ref = resolveAbsolutePublicPath(refInput);
  try {
    await fs.access(ref.abs);
  } catch (_err) {
    return res.status(404).json(new ApiResponse(null, 'File not found at public/files'));
  }
  const ext = path.extname(ref.abs).replace('.', '').toLowerCase();
  const pseudoDoc = { _id: refInput, originalName: path.basename(ref.abs), extension: ext, path: ref.rel };
  const rows = await loadRowsFromFile(pseudoDoc);

  if (!rows || rows.length === 0) {
    return res.status(200).json(new ApiResponse({
      file: { id: pseudoDoc._id, originalName: pseudoDoc.originalName, extension: pseudoDoc.extension, rowsAnalyzed: 0 },
      schema: { columns: [] },
      stats: { numeric: {}, categorical: {} },
      correlations: [],
      chartRecommendations: [],
      forecasts: []
    }, 'File has no data rows'));
  }

  const sample = rows.slice(0, 5000);
  const columnNames = Object.keys(sample[0] || {});

  const inferred = {};
  for (const col of columnNames) {
    let numHits = 0, dateHits = 0, total = 0;
    for (const row of sample) {
      const v = row[col];
      if (v === null || v === undefined || v === '') continue;
      total++;
      if (isLikelyNumber(v)) numHits++;
      else if (isLikelyDate(v)) dateHits++;
    }
    const numericRatio = total ? numHits / total : 0;
    const dateRatio = total ? dateHits / total : 0;
    let type = 'string';
    if (numericRatio >= 0.6) type = 'number';
    else if (dateRatio >= 0.6) type = 'date';
    inferred[col] = type;
  }

  const numericStats = {};
  const categoricalStats = {};
  const numericCols = columnNames.filter((c) => inferred[c] === 'number');
  const dateCols = columnNames.filter((c) => inferred[c] === 'date');
  for (const col of numericCols) {
    numericStats[col] = computeNumericStats(sample.map((r) => r[col]));
  }
  for (const col of columnNames.filter((c) => inferred[c] === 'string')) {
    const values = sample.map((r) => r[col]);
    const freq = valueFrequency(values, 50);
    categoricalStats[col] = { count: values.length, unique: freq.length, top: freq.slice(0, 10) };
  }
  const correlations = [];
  for (let i = 0; i < numericCols.length; i++) {
    for (let j = i + 1; j < numericCols.length; j++) {
      const a = numericCols[i];
      const b = numericCols[j];
      const r = pearsonCorrelation(sample.map((r) => r[a]), sample.map((r) => r[b]));
      if (r !== null) correlations.push({ colX: a, colY: b, pearson: r });
    }
  }
  correlations.sort((x, y) => Math.abs(y.pearson) - Math.abs(x.pearson));

  const chartRecommendations = [];
  for (const col of numericCols) {
    chartRecommendations.push({ title: `Distribution of ${col}`, type: 'histogram', x: col, y: null, description: 'Shows the distribution of values' });
  }
  for (const corr of correlations.filter((c) => Math.abs(c.pearson) >= 0.5).slice(0, 10)) {
    chartRecommendations.push({ title: `Relationship: ${corr.colX} vs ${corr.colY}`, type: 'scatter', x: corr.colX, y: corr.colY, description: `Strong ${corr.pearson >= 0 ? 'positive' : 'negative'} correlation` });
  }
  if (dateCols.length > 0) {
    const dateCol = dateCols[0];
    for (const col of numericCols) {
      chartRecommendations.push({ title: `${col} over time`, type: 'line', x: dateCol, y: col, description: 'Trend over time' });
    }
  }

  return res.status(200).json(new ApiResponse({
    file: { id: pseudoDoc._id, originalName: pseudoDoc.originalName, extension: pseudoDoc.extension, rowsAnalyzed: sample.length },
    schema: { columns: columnNames.map((name) => ({ name, inferredType: inferred[name] })) },
    stats: { numeric: numericStats, categorical: categoricalStats },
    correlations,
    chartRecommendations,
    forecasts: [],
  }, 'Analysis completed'));
});

