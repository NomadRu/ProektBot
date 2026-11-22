import fs from 'node:fs';
import path from 'node:path';
import type {
  BotSessionState,
  ProjectRecord,
  ProjectSummary,
  UserProfile,
} from './types.ts';

export const ADMIN_USERNAME = 'indproekt_help';
export const PROJECT_PRICE_RUB = 300;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const MAX_PROJECTS = 60;
const projects = new Map<string, ProjectRecord>();
const projectOrder: string[] = [];
const sessions = new Map<string, BotSessionState>();
const users = new Map<string, UserProfile>();

function loadUsersFromDisk(): void {
  try {
    if (!fs.existsSync(USERS_FILE)) return;
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as UserProfile[];
    if (Array.isArray(parsed)) {
      for (const u of parsed) {
        if (u && typeof u.userId === 'string') {
          users.set(u.userId, {
            ...u,
            credits: Number.isFinite(u.credits) && u.credits >= 0 ? Math.floor(u.credits) : 0,
            generatedCount:
              Number.isFinite(u.generatedCount) && u.generatedCount >= 0
                ? Math.floor(u.generatedCount)
                : 0,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Store] Не удалось прочитать data/users.json:', err);
  }
}

function persistUsersToDisk(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const list = Array.from(users.values());
    fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Store] Не удалось сохранить data/users.json:', err);
  }
}

loadUsersFromDisk();

export function isAdminUsername(username?: string | null): boolean {
  if (!username) return false;
  return username.trim().replace(/^@/, '').toLowerCase() === ADMIN_USERNAME;
}

export function ensureUserProfile(params: {
  userId: string;
  chatId?: string;
  username?: string;
  displayName?: string;
}): UserProfile {
  const now = new Date().toISOString();
  const cleanUsername = params.username?.trim().replace(/^@/, '') || undefined;
  const existing = users.get(params.userId);
  if (existing) {
    let changed = false;
    if (params.chatId && existing.chatId !== params.chatId) {
      existing.chatId = params.chatId;
      changed = true;
    }
    if (cleanUsername && existing.username !== cleanUsername) {
      existing.username = cleanUsername;
      changed = true;
    }
    if (params.displayName && existing.displayName !== params.displayName) {
      existing.displayName = params.displayName;
      changed = true;
    }
    existing.lastSeenAt = now;
    if (changed) {
      existing.updatedAt = now;
      persistUsersToDisk();
    }
    return existing;
  }

  const created: UserProfile = {
    userId: params.userId,
    chatId: params.chatId,
    username: cleanUsername,
    displayName: params.displayName?.trim() || (cleanUsername ? `@${cleanUsername}` : `Пользователь ${params.userId}`),
    credits: 0, // В начале у всех строго 0 генераций
    generatedCount: 0,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  };
  users.set(params.userId, created);
  persistUsersToDisk();
  return created;
}

export function getUserProfile(userId: string): UserProfile | undefined {
  return users.get(userId);
}

export function findUserByIdOrUsername(query: string): UserProfile | undefined {
  const clean = query.trim();
  if (!clean) return undefined;

  const byId = users.get(clean);
  if (byId) return byId;

  const noAt = clean.replace(/^@/, '').toLowerCase();
  for (const user of users.values()) {
    if (user.userId.toLowerCase() === noAt) return user;
    if (user.username && user.username.toLowerCase() === noAt) return user;
  }
  return undefined;
}

export function getOrProvisionTargetUser(query: string): UserProfile | undefined {
  const found = findUserByIdOrUsername(query);
  if (found) return found;

  const clean = query.trim();
  // Allow pre-crediting a numeric Telegram user ID even before they press /start
  if (/^\d{5,20}$/.test(clean)) {
    return ensureUserProfile({
      userId: clean,
      chatId: clean,
      displayName: `Telegram ID ${clean}`,
    });
  }
  return undefined;
}

export function adjustUserCredits(userId: string, delta: number): UserProfile | undefined {
  const user = users.get(userId);
  if (!user) return undefined;
  user.credits = Math.max(0, user.credits + Math.trunc(delta));
  user.updatedAt = new Date().toISOString();
  persistUsersToDisk();
  return user;
}

export function incrementUserGeneratedCount(userId: string): void {
  const user = users.get(userId);
  if (!user) return;
  user.generatedCount += 1;
  user.updatedAt = new Date().toISOString();
  persistUsersToDisk();
}

export function listRecentUsers(limit = 10): UserProfile[] {
  return Array.from(users.values())
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, limit);
}

export function getUsersStats(): {
  totalUsers: number;
  totalCreditsAvailable: number;
  totalGeneratedByUsers: number;
} {
  let totalCreditsAvailable = 0;
  let totalGeneratedByUsers = 0;
  for (const u of users.values()) {
    totalCreditsAvailable += u.credits;
    totalGeneratedByUsers += u.generatedCount;
  }
  return {
    totalUsers: users.size,
    totalCreditsAvailable,
    totalGeneratedByUsers,
  };
}

export function saveProject(record: ProjectRecord): void {
  if (!projects.has(record.id)) {
    projectOrder.unshift(record.id);
  }
  projects.set(record.id, record);

  while (projectOrder.length > MAX_PROJECTS) {
    const oldestId = projectOrder.pop();
    if (oldestId) {
      projects.delete(oldestId);
    }
  }
}

export function getProject(id: string): ProjectRecord | undefined {
  return projects.get(id);
}

export function listProjectSummaries(): ProjectSummary[] {
  const summaries: ProjectSummary[] = [];
  for (const id of projectOrder) {
    const rec = projects.get(id);
    if (!rec) continue;
    summaries.push({
      id: rec.id,
      createdAt: rec.createdAt,
      topic: rec.input.topic,
      subject: rec.input.subject,
      level: rec.input.level,
      projectType: rec.input.projectType,
      chaptersCount: rec.input.chaptersCount,
      targetPages: rec.input.targetPages,
      authorName: rec.input.authorName,
      institution: rec.input.institution,
      filename: rec.filename,
      pptxFilename: rec.pptxFilename,
      speechFilename: rec.speechFilename,
      wordCount: rec.wordCount,
      estimatedPages: rec.estimatedPages,
      source: rec.input.source ?? 'studio',
    });
  }
  return summaries;
}

export function getTotalProjectsCount(): number {
  return projects.size;
}

export function getOrCreateSession(chatKey: string): BotSessionState {
  const existing = sessions.get(chatKey);
  if (existing) {
    return existing;
  }
  const fresh: BotSessionState = {
    step: 'idle',
    draft: {},
    updatedAt: Date.now(),
  };
  sessions.set(chatKey, fresh);
  return fresh;
}

export function updateSession(
  chatKey: string,
  updater: (current: BotSessionState) => BotSessionState
): BotSessionState {
  const current = getOrCreateSession(chatKey);
  const next = updater(current);
  next.updatedAt = Date.now();
  sessions.set(chatKey, next);
  return next;
}

export function resetSession(chatKey: string): BotSessionState {
  const fresh: BotSessionState = {
    step: 'idle',
    draft: {},
    updatedAt: Date.now(),
  };
  sessions.set(chatKey, fresh);
  return fresh;
}
