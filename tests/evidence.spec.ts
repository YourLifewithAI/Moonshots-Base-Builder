import { test, expect } from '@playwright/test';
import { EVIDENCE, EVIDENCE_MATURITY_LABEL } from '../src/data/evidence';
import { TECHS, type TechId } from '../src/data/techs';

// Editorial contract tests run offline: a link outage must not break gameplay CI.
test('research evidence has real tech IDs and complete, safe source metadata', () => {
  for (const [id, entry] of Object.entries(EVIDENCE)) {
    expect(TECHS, `${id} must remain a real research node`).toHaveProperty(id);
    for (const field of ['whatExists', 'lunarGap', 'abstraction'] as const) {
      expect(entry[field].trim().length, `${id}.${field}`).toBeGreaterThan(20);
    }
    expect(entry.sources.length, `${id} needs primary evidence`).toBeGreaterThan(0);
    const urls = new Set<string>();
    for (const source of entry.sources) {
      expect(source.company.trim().length, `${id}: company`).toBeGreaterThan(1);
      expect(source.country.trim().length, `${id}: country`).toBeGreaterThan(1);
      expect(source.title.trim().length, `${id}: source title`).toBeGreaterThan(5);
      expect(EVIDENCE_MATURITY_LABEL).toHaveProperty(source.maturity);
      expect(source.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const date = new Date(`${source.verified}T00:00:00Z`);
      expect(Number.isNaN(date.getTime()), `${id}: valid verification date`).toBe(false);
      expect(date.toISOString().slice(0, 10)).toBe(source.verified);
      const url = new URL(source.url);
      expect(url.protocol, `${id}: source link must use HTTPS`).toBe('https:');
      expect(url.hostname).toContain('.');
      expect(url.username + url.password, `${id}: no credentials in links`).toBe('');
      expect(urls.has(source.url), `${id}: duplicate source`).toBe(false);
      urls.add(source.url);
    }
  }
});

test('evidence spans the industrial chain and the new extraction progression', () => {
  expect(Object.keys(EVIDENCE).length).toBeGreaterThanOrEqual(15);
  const representative: TechId[] = [
    'regolithProcessing', 'autonomousHaulage', 'partsFabrication',
    'growLights', 'humanCohabitation', 'waferFab', 'lunarDataCenter', 'powerBeaming',
    'bayExtensions', 'hardfacedTeeth', 'waterReclamation', 'waterElectrolysis', 'deepCoring', 'depotHalls',
    'moltenElectrolysis', 'siliconRefining', 'foilManufacturing', 'orbitalProspector',
  ];
  for (const id of representative) expect(EVIDENCE[id], `${id} needs a real-world connection`).toBeDefined();
  const sources = Object.values(EVIDENCE).flatMap((entry) => entry.sources);
  expect(new Set(sources.map((s) => s.company)).size).toBeGreaterThanOrEqual(10);
  expect(new Set(sources.map((s) => s.country)).size).toBeGreaterThanOrEqual(5);
  // Preserve the distinction between an Earth product, a test and a future system.
  expect(new Set(sources.map((s) => s.maturity))).toEqual(new Set(['commercial', 'ground-demo', 'flight-demo', 'concept']));
});
