import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export const CONNECTION_COOKIE = 'sunday-espn-connection';
export const CONNECTION_MAX_AGE = 180 * 24 * 60 * 60;
export type ESPNConnection = {
  leagueId: string;
  season: number;
  espnS2: string;
  swid: string;
  expiresAt: number;
};
const directory = () =>
  process.env.ESPN_CONNECTION_DIR ||
  path.join(process.cwd(), 'data', 'espn-connections');
const filename = (token: string) =>
  path.join(
    directory(),
    createHash('sha256').update(token).digest('hex') + '.json',
  );
const validToken = (token?: string): token is string =>
  !!token && /^[a-f0-9]{64}$/.test(token);

async function encryptionKey() {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const file = path.join(directory(), '.key');
  try {
    await writeFile(file, randomBytes(32), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const key = await readFile(file);
  if (key.length !== 32) throw new Error('Invalid connection encryption key.');
  return key;
}

export async function saveConnection(
  connection: Omit<ESPNConnection, 'expiresAt'>,
) {
  const token = randomBytes(32).toString('hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify({
        ...connection,
        expiresAt: Date.now() + CONNECTION_MAX_AGE * 1000,
      }),
    ),
    cipher.final(),
  ]);
  const file = filename(token);
  const temporary = file + '.tmp';
  await writeFile(
    temporary,
    JSON.stringify({
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    }),
    { mode: 0o600 },
  );
  await rename(temporary, file);
  return token;
}

export async function loadConnection(
  token?: string,
): Promise<ESPNConnection | null> {
  if (!validToken(token)) return null;
  try {
    const stored = JSON.parse(await readFile(filename(token), 'utf8'));
    const decipher = createDecipheriv(
      'aes-256-gcm',
      await encryptionKey(),
      Buffer.from(stored.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    const connection = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(stored.data, 'base64')),
        decipher.final(),
      ]).toString(),
    ) as ESPNConnection;
    if (connection.expiresAt <= Date.now()) {
      await deleteConnection(token);
      return null;
    }
    return connection;
  } catch {
    return null;
  }
}

export async function deleteConnection(token?: string) {
  if (validToken(token)) await rm(filename(token), { force: true });
}
