const NAME_HEADERS = new Set(['name', 'full name', 'staff name']);
const EMAIL_HEADERS = new Set(['email', 'e-mail', 'email address']);
const PASSWORD_HEADERS = new Set(['password', 'temp password', 'temporary password']);
export const MAX_BULK_STAFF = 100;

export const SAMPLE_CSV = [
  'name,email,password',
  'Ada Cleaner,ada.cleaner@example.com,password123',
  'Ben Cleaner,ben.cleaner@example.com,',
].join('\n');

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value !== ''));
}

function headerIndex(headers, names) {
  return headers.findIndex((header) => names.has(header));
}

export function rowsFromMatrix(matrix) {
  if (!matrix?.length) return { error: 'The file is empty.', rows: [] };
  const headers = matrix[0].map((header) => String(header || '').trim().toLowerCase());
  const nameIdx = headerIndex(headers, NAME_HEADERS);
  const emailIdx = headerIndex(headers, EMAIL_HEADERS);
  const passwordIdx = headerIndex(headers, PASSWORD_HEADERS);
  if (nameIdx < 0 || emailIdx < 0) {
    return { error: 'The first row must include name and email columns.', rows: [] };
  }

  const rows = [];
  const seen = new Set();
  for (let i = 1; i < matrix.length; i += 1) {
    const line = matrix[i] || [];
    const name = String(line[nameIdx] ?? '').trim();
    const email = String(line[emailIdx] ?? '').trim().toLowerCase();
    const password = passwordIdx >= 0 ? String(line[passwordIdx] ?? '').trim() : '';
    if (!name && !email && !password) continue;
    const problems = [];
    if (!name) problems.push('Name is missing.');
    if (!email.includes('@')) problems.push('Email is missing or not valid.');
    if (email && seen.has(email)) problems.push('This email is repeated in the file.');
    if (email) seen.add(email);
    rows.push({
      line: i + 1,
      name,
      email,
      password,
      problems,
    });
  }

  if (!rows.length) return { error: 'No staff rows were found under the headings.', rows: [] };
  if (rows.length > MAX_BULK_STAFF) {
    return {
      error: `A file can hold at most ${MAX_BULK_STAFF} staff. Split the file and upload again.`,
      rows: [],
    };
  }
  return { error: '', rows };
}

export function withSharedPassword(rows, sharedPassword) {
  const shared = String(sharedPassword || '').trim();
  return rows.map((row) => {
    const problems = row.problems.filter((problem) => !problem.startsWith('Password'));
    const finalPassword = row.password || shared;
    if (finalPassword.length < 8) {
      problems.push('Password must be at least 8 characters. Add one in the file or above.');
    }
    return {
      ...row,
      finalPassword,
      passwordSource: row.password ? 'In the file' : shared ? 'Shared password' : 'Missing',
      problems,
      ready: problems.length === 0,
    };
  });
}
