import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCmsBlocks } from '../src/cmsBlockValidation.js';
import {
  buildPersonalDataCmsBlocks,
  PERSONAL_DATA_CMS_PAGE,
} from '../src/cmsPersonalDataSeedContent.js';

describe('personal-data CMS seed', () => {
  it('builds blocks that pass CMS validation', () => {
    const blocks = buildPersonalDataCmsBlocks();
    const parsed = parseCmsBlocks(blocks);
    assert.ok(parsed);
    assert.equal(parsed.length, blocks.length);
    const table = parsed.find((block) => block.type === 'table');
    assert.ok(table && table.type === 'table');
    assert.deepEqual(table.columns, ['Čo', 'Na čo', 'Ako dlho']);
    assert.equal(table.rows.length, 7);
  });

  it('uses the stable system page id and Slovak title', () => {
    assert.equal(PERSONAL_DATA_CMS_PAGE.id, 'cms-page-personal-data');
    assert.equal(PERSONAL_DATA_CMS_PAGE.slug, 'personal-data');
    assert.match(PERSONAL_DATA_CMS_PAGE.title, /Osobné/);
  });
});
