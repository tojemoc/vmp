export type CsvUserImportRow = {
  email: string
  purchaseId: string | null
}

const EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

const PURCHASE_ID_HEADER_ALIASES = new Set([
  'purchaseid',
  'purchase_id',
  'clientid',
  'client_id',
  'id',
  'externalid',
  'external_id',
])

function normalizeHeaderToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current.trim())
  return cells
}

function isEmailHeader(token: string): boolean {
  const normalized = normalizeHeaderToken(token)
  return normalized === 'email' || normalized === 'e_mail' || normalized === 'mail'
}

function isPurchaseIdHeader(token: string): boolean {
  return PURCHASE_ID_HEADER_ALIASES.has(normalizeHeaderToken(token))
}

function parseStructuredCsvRows(csvText: string, maxRows: number): CsvUserImportRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return []

  const firstCells = parseCsvLine(lines[0])
  const emailIndex = firstCells.findIndex((cell) => isEmailHeader(cell))
  const purchaseIdIndex = firstCells.findIndex((cell) => isPurchaseIdHeader(cell))
  const hasHeader = emailIndex >= 0
  const dataLines = hasHeader ? lines.slice(1) : lines
  const resolvedEmailIndex = hasHeader ? emailIndex : 0
  const resolvedPurchaseIdIndex = hasHeader
    ? purchaseIdIndex
    : (firstCells.length > 1 ? 1 : -1)

  if (!hasHeader && firstCells.length === 1 && !EMAIL_REGEX.test(firstCells[0])) {
    return []
  }

  const rows: CsvUserImportRow[] = []
  const seenEmails = new Set<string>()

  for (const line of dataLines) {
    if (rows.length >= maxRows) break
    const cells = parseCsvLine(line)
    const emailRaw = String(cells[resolvedEmailIndex] ?? '').trim().toLowerCase()
    if (!EMAIL_REGEX.test(emailRaw)) continue
    if (seenEmails.has(emailRaw)) continue
    seenEmails.add(emailRaw)

    const purchaseIdRaw = resolvedPurchaseIdIndex >= 0
      ? String(cells[resolvedPurchaseIdIndex] ?? '').trim()
      : ''
    rows.push({
      email: emailRaw,
      purchaseId: purchaseIdRaw || null,
    })
  }

  return rows
}

function parseUnstructuredCsvEmails(csvText: string, maxRows: number): CsvUserImportRow[] {
  const emails = new Set<string>()
  const emailRegex = /(?:^|[\s,;'"<>()[\]{}])([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})(?=$|[\s,;'"<>()[\]{}])/gi
  const matches = csvText.matchAll(emailRegex)
  const rows: CsvUserImportRow[] = []
  for (const match of matches) {
    if (rows.length >= maxRows) break
    const lower = (match[1] || '').toLowerCase()
    if (!lower || emails.has(lower)) continue
    emails.add(lower)
    rows.push({ email: lower, purchaseId: null })
  }
  return rows
}

export function parseCsvUserRows(csvText: string, maxRows = 10000): CsvUserImportRow[] {
  const safeMaxRows = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 10000
  const structured = parseStructuredCsvRows(csvText, safeMaxRows)
  if (structured.length) return structured
  return parseUnstructuredCsvEmails(csvText, safeMaxRows)
}
