// Pure helpers for the database tab (no Node or Electron imports: the renderer imports them too).

export interface DbInfo {
  engine: string
  version: string
  host: string
  port: string
  publishedPort: string
  database: string
  username: string
  password: string
}

export interface DescribeResult {
  info: DbInfo | null
  phpmyadminUrl: string
}

/** Finds the JSON object with a `raw` field in `ddev describe -j` output (one JSON per line). */
export function parseDescribe(stdout: string): DescribeResult {
  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim()
    if (!text.startsWith('{')) continue
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      continue
    }
    const raw = data?.raw
    if (!raw || typeof raw !== 'object') continue
    const db = raw.dbinfo
    const info: DbInfo | null = db
      ? {
          engine: String(db.database_type ?? ''),
          version: String(db.database_version ?? ''),
          host: String(db.host ?? 'db'),
          port: String(db.dbPort ?? db.port ?? (db.database_type === 'postgres' ? '5432' : '3306')),
          publishedPort: db.published_port ? String(db.published_port) : '',
          database: String(db.dbname ?? 'db'),
          username: String(db.username ?? 'db'),
          password: String(db.password ?? 'db')
        }
      : null
    return { info, phpmyadminUrl: phpmyadminUrl(String(raw.httpsurl ?? ''), String(raw.httpurl ?? '')) }
  }
  return { info: null, phpmyadminUrl: '' }
}

/** phpMyAdmin add-on listens on the project host at 8036 (http) / 8037 (https). */
export function phpmyadminUrl(httpsUrl: string, httpUrl: string): string {
  const [base, port, scheme] = httpsUrl ? [httpsUrl, '8037', 'https'] : [httpUrl, '8036', 'http']
  if (!base) return ''
  try {
    return `${scheme}://${new URL(base).hostname}:${port}`
  } catch {
    return ''
  }
}

const SQL_NAME = /^[A-Za-z0-9_]+$/
export const IMPORT_EXTENSIONS = ['sql', 'gz', 'bz2', 'xz', 'zip', 'tgz']

export function validDatabaseName(name: string): boolean {
  return name === '' || SQL_NAME.test(name)
}

/** Whether an export file should be gzipped (by its extension); plain .sql is not. */
export function exportGzip(file: string): boolean {
  return !/\.sql$/i.test(file)
}

export function importArgs(file: string, database: string): string[] {
  const args = ['import-db', `--file=${file}`]
  if (database) args.push(`--database=${database}`)
  return args
}

export function exportArgs(file: string): string[] {
  return ['export-db', `--file=${file}`, `--gzip=${exportGzip(file)}`]
}

export function defaultExportName(project: string, now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
  return `${project}-${stamp}.sql.gz`
}
