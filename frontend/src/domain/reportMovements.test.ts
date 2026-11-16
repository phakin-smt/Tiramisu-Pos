import { describe, expect, it } from 'vitest';

import type { ReportMenuSummary } from '../types/reports';
import { movedMenus } from './reportMovements';

function menu(code: string, sold: number, giveaway = 0, waste = 0): ReportMenuSummary {
  return { code, name: code, category: 'Tiramisu', icon: '', active: true, sold, giveaway, waste, remaining: 5 };
}

describe('movedMenus', () => {
  it('drops menus that did nothing all day', () => {
    expect(movedMenus([menu('A', 0), menu('B', 2), menu('C', 0, 0, 0)]).map((item) => item.code)).toEqual(['B']);
  });

  it('keeps a menu that was only given away or written off', () => {
    expect(movedMenus([menu('GIFT', 0, 1), menu('WASTE', 0, 0, 2)]).map((item) => item.code)).toEqual(['GIFT', 'WASTE']);
  });

  it('puts the best seller first', () => {
    expect(movedMenus([menu('LOW', 1), menu('HIGH', 9), menu('MID', 4)]).map((item) => item.code)).toEqual(['HIGH', 'MID', 'LOW']);
  });

  it('leaves the list it was given alone', () => {
    const items = [menu('LOW', 1), menu('HIGH', 9)];
    movedMenus(items);
    expect(items.map((item) => item.code)).toEqual(['LOW', 'HIGH']);
  });
});
