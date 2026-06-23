import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PlatformSession, PlatformSessionSchema } from "../basket/schema.js";
import { z } from "zod";

const DEFAULT_SESSIONS_DIR = ".crossmint-agent-basket";
const DEFAULT_SESSIONS_FILE = "sessions.json";

const SessionsFileSchema = z.record(PlatformSessionSchema);

type SessionsFile = Record<string, PlatformSession>;

export function resolveSessionStorePath(): string {
  return path.resolve(
    process.env.CROSSMINT_SESSIONS_STORE_PATH ||
      path.join(process.cwd(), DEFAULT_SESSIONS_DIR, DEFAULT_SESSIONS_FILE)
  );
}

export class SessionStore {
  constructor(private readonly filePath = resolveSessionStorePath()) {}

  path(): string {
    return this.filePath;
  }

  async load(): Promise<SessionsFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const json = JSON.parse(raw);
      return SessionsFileSchema.parse(json) as SessionsFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const empty: SessionsFile = {};
        await this.save(empty);
        return empty;
      }
      throw error;
    }
  }

  async save(sessions: SessionsFile): Promise<SessionsFile> {
    const parsed = SessionsFileSchema.parse(sessions) as SessionsFile;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.filePath);
    return parsed;
  }

  async getSession(domain: string): Promise<PlatformSession | null> {
    const sessions = await this.load();
    return sessions[domain] ?? null;
  }

  async setSession(
    domain: string,
    session: PlatformSession
  ): Promise<PlatformSession> {
    const sessions = await this.load();
    sessions[domain] = session;
    await this.save(sessions);
    return session;
  }

  async deleteSession(domain: string): Promise<boolean> {
    const sessions = await this.load();
    if (!(domain in sessions)) {
      return false;
    }
    delete sessions[domain];
    await this.save(sessions);
    return true;
  }

  async listSessions(): Promise<SessionsFile> {
    return this.load();
  }
}
