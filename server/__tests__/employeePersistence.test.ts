import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolate ~/.pixel-agents/employees.json reads from the real home directory.
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

// Must import AFTER the os mock is set up.
const { readEmployees, writeEmployees } = await import('../src/employeePersistence.js');

function writeRoster(employees: unknown[]): string {
  const dir = path.join(tmpBase, '.pixel-agents');
  fs.mkdirSync(dir, { recursive: true });
  const rosterPath = path.join(dir, 'employees.json');
  fs.writeFileSync(rosterPath, JSON.stringify({ employees }, null, 2));
  return rosterPath;
}

describe('employeePersistence', () => {
  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-roster-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  describe('readEmployees normalizes legacy providers', () => {
    it('drops a legacy oauthToken provider so the employee follows the office default', () => {
      writeRoster([
        {
          name: '코더',
          cwd: '/work',
          role: 'staff',
          provider: { mode: 'oauthToken', oauthToken: 'x' },
        },
      ]);

      const [employee] = readEmployees();

      expect(employee.name).toBe('코더');
      expect(employee.provider).toBeUndefined();
    });

    it('leaves apiKey and subscription providers alone', () => {
      writeRoster([
        { name: '키', cwd: '/a', role: 'staff', provider: { mode: 'apiKey', apiKey: 'k' } },
        { name: '구독', cwd: '/b', role: 'staff', provider: { mode: 'subscription' } },
        { name: '기본', cwd: '/c', role: 'staff' },
      ]);

      const [withKey, withSub, withNothing] = readEmployees();

      expect(withKey.provider).toEqual({ mode: 'apiKey', apiKey: 'k' });
      expect(withSub.provider).toEqual({ mode: 'subscription' });
      expect(withNothing.provider).toBeUndefined();
    });

    it('the dead oauthToken field is gone from the file after the next save', () => {
      const rosterPath = writeRoster([
        {
          name: '코더',
          cwd: '/work',
          role: 'staff',
          provider: { mode: 'oauthToken', oauthToken: 'x' },
        },
      ]);

      writeEmployees(readEmployees());

      // JSON.stringify drops an undefined provider entirely, so the key itself is gone.
      const onDisk = fs.readFileSync(rosterPath, 'utf8');
      expect(onDisk).not.toContain('oauthToken');

      const saved = JSON.parse(onDisk).employees[0];
      expect(saved.name).toBe('코더');
      expect(saved).not.toHaveProperty('provider');
    });
  });

  describe('palette/hueShift round-trip', () => {
    it('보존한다: 저장한 palette/hueShift가 그대로 읽힌다', () => {
      writeEmployees([{ name: '코더', cwd: '/work', role: 'staff', palette: 2, hueShift: 90 }]);

      const [employee] = readEmployees();

      expect(employee.palette).toBe(2);
      expect(employee.hueShift).toBe(90);
    });

    it('palette가 없는 직원은 필드 자체가 없다 (undefined로 오염되지 않음)', () => {
      writeRoster([{ name: '코더', cwd: '/work', role: 'staff' }]);

      const [employee] = readEmployees();

      expect(employee).not.toHaveProperty('palette');
      expect(employee).not.toHaveProperty('hueShift');
    });
  });
});
