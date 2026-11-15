'use strict';

const http = require('node:http');
const students = require('./student.json');

const EXPECTED_STUDENT_COUNT = 5000;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 80;
const REQUIRED_FIELDS = ['id', 'name', 'class', 'rollNumber', 'school', 'district', 'state'];

if (!Array.isArray(students) || students.length !== EXPECTED_STUDENT_COUNT) {
  throw new Error(`student.json must contain exactly ${EXPECTED_STUDENT_COUNT} student records.`);
}

const seenIds = new Set();
for (const [index, student] of students.entries()) {
  if (!student || typeof student !== 'object' || REQUIRED_FIELDS.some((field) => typeof student[field] !== 'string')) {
    throw new Error(`student.json record ${index + 1} is missing a required string field.`);
  }
  const match = /^STU(\d{4})$/.exec(student.id);
  const ordinal = match && match[1];
  if (!ordinal || seenIds.has(student.id)) {
    throw new Error(`student.json record ${index + 1} has an invalid or duplicate ID.`);
  }
  if (
    student.name !== `Demo Student ${ordinal}` ||
    student.rollNumber !== String(((Number(ordinal) - 1) % 100) + 1).padStart(3, '0') ||
    !/^Demo School \d+$/.test(student.school) ||
    !/^Demo District \d+$/.test(student.district) ||
    !/^(6|7|8|9|10|11|12)$/.test(student.class) ||
    student.state !== 'Demo State'
  ) {
    throw new Error(`student.json record ${index + 1} must contain synthetic demo data only.`);
  }
  seenIds.add(student.id);
}

const TOTAL_STUDENTS = students.length;
const DISTRICTS = [...new Set(students.map((student) => student.district))];
const byClass = {};
const byDistrict = {};
for (const student of students) {
  byClass[student.class] = (byClass[student.class] || 0) + 1;
  byDistrict[student.district] = (byDistrict[student.district] || 0) + 1;
}

function responseHeaders() {
  const allowedOrigin = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.trim();
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowedOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, { ...responseHeaders(), ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function badRequest(res, message) {
  return sendJson(res, 400, { success: false, message });
}

function getRoute(url) {
  const forcedRoute = url.searchParams.get('__apiRoute');
  if (forcedRoute) {
    return { name: forcedRoute, id: url.searchParams.get('__studentId') };
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path.toLowerCase() === '/api') return { name: 'home' };
  if (path.toLowerCase() === '/stats' || path.toLowerCase() === '/api/stats') return { name: 'stats' };
  if (path.toLowerCase() === '/students' || path.toLowerCase() === '/api/students') return { name: 'students' };
  const match = path.match(/^\/(?:api\/)?students\/([^/]+)$/i);
  if (match) {
    try {
      return { name: 'student', id: decodeURIComponent(match[1]) };
    } catch {
      return { name: 'invalid-id' };
    }
  }
  return { name: 'not-found' };
}

function parsePositiveInteger(raw, fallback, label) {
  if (raw === null) return { value: fallback };
  if (!/^[1-9]\d*$/.test(raw)) return { error: `${label} must be a positive whole number.` };
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return { error: `${label} is too large.` };
  return { value };
}

function listStudents(url, res) {
  const classFilter = url.searchParams.get('class');
  const districtFilter = url.searchParams.get('district');
  const search = (url.searchParams.get('search') || '').trim().toLowerCase();

  if (classFilter && !/^(6|7|8|9|10|11|12)$/.test(classFilter)) {
    return badRequest(res, 'class must be a value from 6 through 12.');
  }
  if (districtFilter && !DISTRICTS.some((district) => district.toLowerCase() === districtFilter.toLowerCase())) {
    return badRequest(res, `district must be Demo District 1 through ${DISTRICTS.length}.`);
  }
  if (search.length > MAX_SEARCH_LENGTH) {
    return badRequest(res, `search must be ${MAX_SEARCH_LENGTH} characters or fewer.`);
  }

  const pageResult = parsePositiveInteger(url.searchParams.get('page'), 1, 'page');
  if (pageResult.error) return badRequest(res, pageResult.error);
  const limitResult = parsePositiveInteger(url.searchParams.get('limit'), 50, 'limit');
  if (limitResult.error) return badRequest(res, limitResult.error);
  if (limitResult.value > MAX_PAGE_SIZE) {
    return badRequest(res, `limit must be between 1 and ${MAX_PAGE_SIZE}.`);
  }

  let result = students;
  if (classFilter) result = result.filter((student) => student.class === classFilter);
  if (districtFilter) {
    const normalizedDistrict = districtFilter.toLowerCase();
    result = result.filter((student) => student.district.toLowerCase() === normalizedDistrict);
  }
  if (search) {
    result = result.filter((student) =>
      [student.id, student.name, student.school, student.district, student.class]
        .some((value) => value.toLowerCase().includes(search)),
    );
  }

  const total = result.length;
  const page = pageResult.value;
  const limit = limitResult.value;
  const start = (page - 1) * limit;
  if (!Number.isSafeInteger(start)) return badRequest(res, 'page is too large.');
  return sendJson(res, 200, {
    success: true,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    data: result.slice(start, start + limit),
  });
}

function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, responseHeaders());
    return res.end();
  }
  if (req.method !== 'GET') {
    return sendJson(
      res,
      405,
      { success: false, message: 'Only GET requests are supported.' },
      { Allow: 'GET, OPTIONS' },
    );
  }

  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return badRequest(res, 'Invalid request URL.');
  }

  const route = getRoute(url);
  switch (route.name) {
    case 'home':
      return sendJson(res, 200, {
        success: true,
        message: 'Demo Student API is running.',
        privacyNotice: 'All records are generated demo data. No real student or family records are used.',
        totalStudents: TOTAL_STUDENTS,
        endpoints: [
          'GET /students?page=1&limit=50',
          'GET /students?class=6&district=Demo%20District%201&search=demo',
          'GET /students/STU0001',
          'GET /stats',
        ],
      });
    case 'students':
      return listStudents(url, res);
    case 'student': {
      if (!route.id || !/^STU\d{4}$/i.test(route.id)) {
        return badRequest(res, 'Student ID must use the format STU0001.');
      }
      const student = students.find((item) => item.id === route.id.toUpperCase());
      if (!student) return sendJson(res, 404, { success: false, message: 'Demo student not found.' });
      return sendJson(res, 200, { success: true, data: student });
    }
    case 'stats':
      return sendJson(res, 200, {
        success: true,
        totalStudents: TOTAL_STUDENTS,
        byClass: { ...byClass },
        byDistrict: { ...byDistrict },
      });
    default:
      return sendJson(res, 404, {
        success: false,
        message: 'Endpoint not found. Visit / for API information.',
      });
  }
}

async function selfTest() {
  const assert = require('node:assert/strict');
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  async function get(path, options) {
    const response = await fetch(`${baseUrl}${path}`, options);
    return { response, body: response.status === 204 ? null : await response.json() };
  }
  try {
    let result = await get('/');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.totalStudents, EXPECTED_STUDENT_COUNT);
    result = await get('/students?page=2&limit=10');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data[0].id, 'STU0011');
    result = await get('/students?class=6&district=Demo%20District%201&search=demo');
    assert.equal(result.response.status, 200);
    assert.ok(result.body.data.length > 0);
    result = await get('/students/stu0001');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.name, 'Demo Student 0001');
    result = await get('/stats');
    assert.equal(result.body.totalStudents, EXPECTED_STUDENT_COUNT);
    assert.equal(Object.values(result.body.byClass).reduce((sum, count) => sum + count, 0), EXPECTED_STUDENT_COUNT);
    result = await get('/students?limit=101');
    assert.equal(result.response.status, 400);
    result = await get('/students/STU9999');
    assert.equal(result.response.status, 404);
    result = await get('/students', { method: 'OPTIONS' });
    assert.equal(result.response.status, 204);
    result = await get('/not-a-route');
    assert.equal(result.response.status, 404);
    console.log('Self-test passed: 5,000 dummy records, routes, filters, pagination, stats, errors, and CORS preflight.');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

module.exports = handler;

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    selfTest().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  } else {
    const port = Number(process.env.PORT) || 3000;
    http.createServer(handler).listen(port, () => {
      console.log(`Demo Student API listening on http://localhost:${port}`);
    });
  }
}
